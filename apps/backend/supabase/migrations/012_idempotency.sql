-- ============================================================
-- random_id 멱등 전송 (012) — messages.client_req_id (t_3486b1d7 ①, 대표님 9/29)
-- 텔레그램 core.telegram.org/method/messages.sendMessage의 random_id 이식:
-- 클라이언트가 발송마다 붙이는 고유 ID를 서버가 user 행 삽입 전 조회하여
-- 재연결·재전송으로 같은 ID가 다시 들어오면 기존 행을 돌려주고 이중 생성을 차단.
--
-- 계층:
-- 1. 사전 조회 (chatTurn findExistingByClientReqId) — 빠른 중복 탐지
-- 2. 유니크 인덱스 (아래) — 레이스 조건으로 동시 insert된 2건 중 후발 reject
-- 3. graph insert CONFLICT 응답 — 프론트는 같은 카드 in-place 유지 (이중 렌더 방지)
--
-- 설계: 세션별 유일 — 다른 세션에 같은 ID 보내도 충돌 없음 (랜덤 충돌 방지 책임은
--   클라이언트, 추천 uuid v4). 에이전트 답변(role=agent)은 컬럼 NULL —
--   서버가 생성하므로 멱등 식별자가 없다.
-- 번호: 012 — 011은 t_811e176c(답변 대기).
-- 실DB 적용은 김비서(감독)가 수행한다 (002~011 절차:
--   supabase db push 또는 SQL Editor 실행 → 아래 §3 read-back 프루브).
-- 미적용 환경 안전판: 백엔드 래치(011 PGRST204/42703 관례)로 컬럼 생략 폴백 —
--   멱등만 조용히 꺼지고 기존 대화 경로는 무영향.
-- ============================================================

-- ------------------------------------------------------------
-- 1. messages additive 컬럼 (003 favorite / 011 awaiting_reply 패턴)
-- ------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_req_id TEXT;
COMMENT ON COLUMN messages.client_req_id IS '텔레그램 random_id 이식(t_3486b1d7) — 클라이언트 발송 고유 ID. 재전송 중복 차단 (세션별 유일)';

-- 세션별 유일 인덱스: 사전 조회를 뚫은 레이스 insert의 2차 방패.
-- NULL은 인덱스 제외(UNIQUE 제약에 걸리지 않음) — role=agent 답변 행은 값 없이 삽입 가능.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_client_req ON messages(session_id, client_req_id) WHERE client_req_id IS NOT NULL;

-- 사전 조회 색인 (findExistingByClientReqId)
CREATE INDEX IF NOT EXISTS idx_messages_client_req ON messages(session_id, client_req_id) WHERE client_req_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. RLS — messages 기존 정책(001/002)이 컬럼 단위 필터링을 하지 않으므로 변경 불필요.
--    쓰기는 service_role 전용(백엔드)이며 인증 사용자는 messages SELECT만 한다.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 3. 검증 read-back 프루브 (db push 후 SQL Editor에서 실행, 011 §3 관례):
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'messages' AND column_name = 'client_req_id';
--   → 1행 (text)
--   SELECT indexname FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'uq_messages_client_req';
--   → 1행
-- ------------------------------------------------------------
