-- ============================================================
-- 질문 큐 (008) — message_queue (t_344e047a, 대표님 9/28 ②)
-- "캐치를 못 해도 큐라인에 넣고, 대답했는지 안 했는지 체크포인트처럼 눈에 보이게"
--
-- 배경: 실행 중(running run)에 끼어든 사용자 발화가 유실되지 않게 세션 큐에 적재하고,
--   run 완료 후 워커가 순차 답변한다. 상태(pending|answered|skipped)가 체크포인트 UI의
--   데이터원(대기=빈 원 / 답변됨=초록 체크 / 스킵=회색 대시).
-- 실DB 적용은 김비서(감독)가 수행한다 (002~007과 동일 절차:
--   supabase db push 또는 SQL Editor 실행 → 아래 §3 read-back 프루브).
--
-- 설계 결정 (즐겨찾기 003/첨부 007과 같은 판정 — 개인 상태는 경량 전용 테이블):
--   messages에 컬럼을 얹지 않는다. 큐 행은 발화 원문(content) + 로케일 + 상태를 가진다.
--   세션 삭제는 CASCADE (대화 파기와 동일 운명). 회원탈퇴도 user_id FK CASCADE로 즉시 파기.
--   position은 세션 내 단조 증가 정수 (drain 순서 = position 오름차순).
--   쓰기는 service_role(백엔드) 전용, RLS SELECT은 자기 소유만 — 007와 동일 패턴.
-- ============================================================

-- ------------------------------------------------------------
-- 1. message_queue — 세션 질문 큐
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    -- 소유자 직접 참조: 탈퇴 즉시 파기(FK CASCADE) + 세션 경유 조회 없이 own-filter 가능
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    locale CHAR(2) NOT NULL DEFAULT 'ko' CHECK (locale IN ('ko', 'en')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'skipped')),
    -- 세션 내 단조 증가 — 워커 drain 순서이자 체크포인트 정렬 키
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_at TIMESTAMPTZ
);

COMMENT ON TABLE message_queue IS '질문 큐(t_344e047a) — 실행 중 끼어든 발화의 유실 방지 대기열. 쓰기 service_role 전용';
-- 세션별 position 유일 (동시 enqueue 이중 방지 — 라우트는 withSessionLock로 직렬화하지만 방패)
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_queue_session_position ON message_queue(session_id, position);
-- drain 조회: 세션의 pending을 position 순서로
CREATE INDEX IF NOT EXISTS idx_message_queue_drain ON message_queue(session_id, status, position);
CREATE INDEX IF NOT EXISTS idx_message_queue_user ON message_queue(user_id, created_at DESC);

-- ------------------------------------------------------------
-- 2. RLS (002/007 패턴: authenticated/anon은 SELECT 전용(자기 소유), 쓰기는 service_role)
-- ------------------------------------------------------------
ALTER TABLE message_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "queue_owner_read" ON message_queue;
CREATE POLICY "queue_owner_read" ON message_queue FOR SELECT USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 3. 검증 read-back 프루브 (db push 후 SQL Editor에서 실행)
-- ------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'message_queue' ORDER BY ordinal_position;
-- → id/session_id/user_id/content/locale/status/position/created_at/answered_at 9행
-- SELECT contname FROM pg_constraint WHERE conrelid = 'message_queue'::regclass;
--   (CHECK status 3값 / CHECK locale 2값 / FK CASCADE 2개)
