-- ============================================================
-- 결정 인박스 (019) — decision_items (t_6d208fb5, 대표님 10/21)
-- "유저가 결정해야 할 사항"만 모아 채팅 옆 패널에 표시
--
-- 배경: 에이전트가 던진 질문이 채팅 스크롤에 묻혀 미답변 누락 방지.
--   구조화 결정카드({type:"decision_request", question, options}) 자동 등록,
--   답변/보류/해제까지 영속. 세션 종료·재접속 무관 유지.
-- 전체 스펙: /home/holysky87/.hermes/obsidian-vault/2026-10-21-김비서-마에톡-결정인박스-기획.md
--
-- 설계:
--   - 008 question_queue 패턴 재사용: RLS SELECT 전용, service_role 쓰기
--   - 한 메시지의 질문 N개 → 항목 N개 (각각 개별 대기/답변)
--   - 상태: pending → answered / deferred / dismissed
--   - CASCADE: 세션 삭제·회원탈퇴 시 즉시 파기
-- ============================================================

-- ------------------------------------------------------------
-- 1. decision_items — 결정 인박스
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decision_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    -- 소유자 직접 참조: 탈퇴 즉시 파기(FK CASCADE) + 세션 경유 조회 없이 own-filter 가능
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 원본 메시지 (에이전트가 결정을 요청한 메시지)
    source_message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    -- 에이전트 ID (어느 에이전트가 질문했는지)
    agent_id VARCHAR(255) NOT NULL,
    -- 질문 텍스트
    question TEXT NOT NULL,
    -- 선택지 배열 (JSON)
    options JSONB DEFAULT '[]'::jsonb,
    -- 상태: pending(대기) / answered(답변됨) / deferred(보류) / dismissed(해제)
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'deferred', 'dismissed')),
    -- 유저 답변 (answered 상태일 때)
    answer TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

COMMENT ON TABLE decision_items IS '결정 인박스(t_6d208fb5) — 에이전트→유저 결정 요청 항목. 쓰기 service_role 전용';

-- 세션별 조회 인덱스 (상태별 필터링)
CREATE INDEX IF NOT EXISTS idx_decision_items_session ON decision_items(session_id, status, created_at DESC);
-- 유저별 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_decision_items_user ON decision_items(user_id, created_at DESC);
-- 원본 메시지별 조회 (한 메시지의 질문 N개)
CREATE INDEX IF NOT EXISTS idx_decision_items_source ON decision_items(source_message_id, created_at);

-- ------------------------------------------------------------
-- 2. RLS (008 패턴: authenticated/anon은 SELECT 전용(자기 소유), 쓰기는 service_role)
-- ------------------------------------------------------------
ALTER TABLE decision_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decision_owner_read" ON decision_items;
CREATE POLICY "decision_owner_read" ON decision_items FOR SELECT USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 3. 검증 read-back 프루브 (db push 후 SQL Editor에서 실행)
-- ------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'decision_items' ORDER BY ordinal_position;
-- → id/session_id/user_id/source_message_id/agent_id/question/options/status/answer/created_at/resolved_at 11행
-- SELECT conname FROM pg_constraint WHERE conrelid = 'decision_items'::regclass;
--   (CHECK status 4값 / FK CASCADE 3개)
