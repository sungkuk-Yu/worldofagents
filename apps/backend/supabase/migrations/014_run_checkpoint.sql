-- ============================================================
-- 내구성 실행 (014) — graph_runs / graph_checkpoints / graph_checkpoint_writes
--     (t_7182aa8f, 자비스 오케스트레이션 [4] 반영 — LangGraph 2.0 + checkpointer)
--
-- 목적: run(턴 실행)의 그래프 상태를 슈퍼스텝 단위로 Postgres에 직렬화하고, 재구성
--   레시피를 한 행에 둔다. 백엔드 재시작·재배포로 죽은 run은 부팅 시
--   graph_runs.status='running' + 최신 체크포인트로 이어 실행된다(answerNode 미완료
--   재실행→완성, 완료 노드는 쓰기 캐시로 스킵 — 재시작에도 답변이 나온다).
--   대표님 통증 '화면 조용해짐 / 재시작 후 답변 유실'(9/28) 계열의 구조적 차단.
--
-- 저장 모델 (PostgresSaver v1 스키마를 Supabase transport에 맞춰 이식 — 카드 [2]
--   'Supabase PG 재사용, 추가 인프라 0'; 커스텀 saver=src/lib/runCheckpoint.ts가
--   이 3테이블만读写, thread_id=run_id(run 단위 스레드)):
--   graph_runs               : run 레시피+ 멱등 저장 포인터(user/empathy/answer id,
--                              tail_persisted). resume의 승격 대상은 'run map'뿐 —
--                              디바이스 presence 등 연결 상태는 휘발 유지(카드 [3]).
--   graph_checkpoints        : 스냅샷. checkpoint=serde(json) 페이로드, writes 테이블과
--                              함께 crash-window(노드 완료→superstep 저장 사이) 복구.
--   graph_checkpoint_writes  : 태스크별 채널 쓰기 (task_id,idx) 유일 — 완료 노드 재실행 방지.
--
-- flag: LANGGRAPH_CHECKPOINT=true 에서만 동작 (기본 false = 현행 무영속 1:1 유지 — 롤백
--   게이트, 대표님 9/29 전보드 지시). 미적용 환경은 첫 PGRST205에서 백엔드 래치가 조용히
--   끈다(008/011/013 관례) — 이 테이블 없이도 기존 배포 무영향.
-- 실DB 적용은 김비서(감독)가 수행 (supabase db push → §4 read-back 프루브).
-- 보존: 완료 행은 디버그 이력. 파기 cron Phase 3, 회원탈퇴는 user FK CASCADE 즉시 파기,
--   세션 삭제는 session FK CASCADE.
-- ============================================================

-- ------------------------------------------------------------
-- 1. graph_runs — 실행 레시피 (멱등 복구의 기준 행)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graph_runs (
    run_id UUID PRIMARY KEY,                       -- turn_id = 스레드 ID (run 단위)
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'abandoned')),
    -- 재구성에 필요한 최소 발화 정보 (processTurn opts 사본 — 과잉 영속화 금지)
    content TEXT NOT NULL,
    locale CHAR(2) NOT NULL DEFAULT 'ko' CHECK (locale IN ('ko', 'en')),
    stt_metadata JSONB,                             -- 음성 턴 재구성 (transcript 메타)
    thread JSONB,                                   -- {parentMessageId, rootMessageId} | null
    attachment_ids JSONB,                           -- string[] | null
    reply_to_id UUID,                              -- 답글 원문 (FK 없음 — 012와 무관, 조회만)
    engine TEXT CHECK (engine IN ('langgraph', 'simple')), -- 실행 엔진 (resume 재구성 정보)
    -- 멱등 저장 포인터: 크래시 구간별 재시작이 행 복제를 내지 않게 각 저장 후 갱신
    user_message_id UUID,
    empathy_message_id UUID,
    answer_message_id UUID,
    tail_persisted BOOLEAN NOT NULL DEFAULT false,  -- context_patches/usage 기록 완료
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE graph_runs IS '내구성 실행 레시피(t_7182aa8f) — 재시작 후 미완 run resume의 최소 정보. 쓰기 service_role 전용';
-- 부팅 스캔: 미완 running을 생성 순으로 (cap: config.runCheckpoint.maxResumePerBoot)
CREATE INDEX IF NOT EXISTS idx_graph_runs_open ON graph_runs(status, created_at) WHERE status = 'running';
-- 세션 단위 정리(삭제/탈퇴)·디버그 조회
CREATE INDEX IF NOT EXISTS idx_graph_runs_session ON graph_runs(session_id, created_at DESC);

-- ------------------------------------------------------------
-- 2. graph_checkpoints — 슈퍼스텝 스냅샷 (thread = run_id)
--    PostgresSaver v1 'checkpoints'의 transport 변형: serde가 json 타입으로 준 페이로드를
--    JSONB에 그대로 담는다 (우리 상태 채널은 전부 plain JSON 계약 — Binary 계열 미사용).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graph_checkpoints (
    run_id UUID NOT NULL REFERENCES graph_runs(run_id) ON DELETE CASCADE,
    checkpoint_ns TEXT NOT NULL DEFAULT '',         -- 루트 그래프 전용('')
    checkpoint_id TEXT NOT NULL,                    -- UUIDv6 = 시간순 (lex 정렬 = 최신)
    parent_checkpoint_id TEXT,
    ts TEXT NOT NULL,                               -- Checkpoint.ts ISO 문자열
    type TEXT NOT NULL DEFAULT 'json',              -- serde payload 타입 (json 계열만 사용)
    checkpoint JSONB NOT NULL,                      -- serde.dumpsTyped(Checkpoint) → json 객체
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {step, source, ...}
    step INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, checkpoint_ns, checkpoint_id)
);

COMMENT ON TABLE graph_checkpoints IS 'LangGraph 체크포인터(t_7182aa8f) — run당 superstep 스냅샷. resume은 최신 checkpoint_id 행+writes 사용';
-- 최신 조회: run의 내림차순 (getTuple가 사전순 최대를 골라 쓴다)
CREATE INDEX IF NOT EXISTS idx_graph_checkpoints_run_latest ON graph_checkpoints(run_id, checkpoint_id DESC);

-- ------------------------------------------------------------
-- 3. graph_checkpoint_writes — 태스크 채널 쓰기 (crash-window dedup)
--    idx: WRITES_IDX_MAP 특수 채널(-1..-4) 아니면 순번. (task,idx) 유일로
--    재put幂등 — 완료된 노드의 출력이 다음 resume superstep에 스킵된다.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graph_checkpoint_writes (
    run_id UUID NOT NULL REFERENCES graph_runs(run_id) ON DELETE CASCADE,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'json',
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

COMMENT ON TABLE graph_checkpoint_writes IS 'LangGraph 태스크 쓰기(t_7182aa8f) — superstep 미반영 완료 작업. 노드 재실행(이중 LLM 비용) 방지';

-- ------------------------------------------------------------
-- 4. RLS (002/007/008 패턴: 인증 사용자는 SELECT만(자기 소유), 쓰기는 service_role)
-- ------------------------------------------------------------
ALTER TABLE graph_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_checkpoint_writes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "graph_runs_owner_read" ON graph_runs;
CREATE POLICY "graph_runs_owner_read" ON graph_runs
    FOR SELECT USING (user_id = auth.uid());

-- checkpoints/writes는 user 칼럼이 없다 — graph_runs 경유 소유자만 조회 가능.
-- (내부 백로그: run 레시피는 발화 원문(content)을 담으므로 사용자 열람 가능이 원칙 —
--  service_role 전용이면 백엔드 디버그 API는 별도 라우트로.)
DROP POLICY IF EXISTS "graph_checkpoints_owner_read" ON graph_checkpoints;
CREATE POLICY "graph_checkpoints_owner_read" ON graph_checkpoints
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM graph_runs r WHERE r.run_id = graph_checkpoints.run_id AND r.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "graph_writes_owner_read" ON graph_checkpoint_writes;
CREATE POLICY "graph_writes_owner_read" ON graph_checkpoint_writes
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM graph_runs r WHERE r.run_id = graph_checkpoint_writes.run_id AND r.user_id = auth.uid()
    ));

-- ------------------------------------------------------------
-- 5. 검증 read-back 프루브 (db push 후 SQL Editor 실행 — 007/011 관례):
--   SELECT table_name, count(*) FROM information_schema.columns
--    WHERE table_name IN ('graph_runs','graph_checkpoints','graph_checkpoint_writes')
--    GROUP BY table_name;                    -- 17 / 9 / 8
--   SELECT conname FROM pg_constraint
--    WHERE conrelid IN ('graph_runs'::regclass,'graph_checkpoints'::regclass,'graph_checkpoint_writes'::regclass);
--   → status CHECK 4값 / locale CHECK 2값 / engine CHECK 2값 / FK CASCADE 4개
--   SELECT indexname FROM pg_indexes WHERE tablename LIKE 'graph_%';  -- 5
-- 역방향: supabase/rollback/014_run_checkpoint_down.sql (수동 실행, 롤백 게이트)
-- ============================================================
