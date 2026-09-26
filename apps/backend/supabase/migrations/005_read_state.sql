-- ============================================================
-- 크로스 디바이스 연속성 (005) — 세션별 읽기 커서 (세션 이어보기)
-- 작업: t_d75ca81c (대표님 9/26 야간 지시 — PC 웹을 모바일과 자연스럽게 연속적으로)
-- 실DB 적용은 김비서(감독)가 수행한다 (002/003/004와 동일 절차).
-- ============================================================
-- 배경: 모바일에서 대화하던 세션을 PC 웹에서 열면 "어디까지 읽었는지"가 없어
--   마지막 메시지만 보인다. 기기 간 이어보려면 세션별 최종 열람 turn_index가
--   서버(공유 DB)에 있어야 한다 — localStorage로는 크로스 디바이스가 불가.
-- 설계 결정: 세션 테이블 컬럼이 아니라 분리 테이블 —
--   sessions는 (user_id, agent_id) 유니크 관계 마스터이고 포크가 갈라지는 단위라
--   열람 상태(고빈도 갱신, 개인 상태)를 얹으면 세션 행 쓰기가 무거워진다.
--   즐겨찾기(003)와 같은 판정: 개인 상태는 경량 전용 테이블 + 백엔드 쓰기.
-- 사용 경로:
--   PUT  /api/sessions/:id/read-state  { last_read_turn_index }  (UPSERT, 프론트가 화면에 보일 때 호출)
--   GET  /api/sessions/resume         → 최근 활동 세션 + 읽지 않은 메시지 수/첫 미읽음 turn
--   messages는 세션 ON DELETE CASCADE / sessions는 users ON DELETE CASCADE라 회원탈퇴 시 자동 파기.

CREATE TABLE IF NOT EXISTS session_read_state (
    session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    -- 사용자가 마지막으로 열람한 메시지의 turn_index. 미기록 세션은 -1(전부 미읽음)로 취급.
    last_read_turn_index INTEGER NOT NULL DEFAULT -1,
    -- 최근 열람 디바이스(진단/통계용 — 'pc-web' | 'mobile-web' | 'ios' | 'android' 등 클라이언트 문자열)
    last_device TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE session_read_state IS '세션별 읽기 커서 — 크로스 디바이스 이어보기용 개인 상태. 백엔드 service_role 경유만 쓰기.';
CREATE INDEX IF NOT EXISTS idx_session_read_state_updated ON session_read_state(updated_at DESC);

-- RLS: 002 원칙 유지 — authenticated는 SELECT 전용(자기 세션 경유), 쓰기는 백엔드 service_role.
ALTER TABLE session_read_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_state_via_session_read" ON session_read_state;
CREATE POLICY "read_state_via_session_read" ON session_read_state FOR SELECT USING (
        session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
    );
