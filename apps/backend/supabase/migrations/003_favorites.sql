-- ============================================================
-- 에이전트톡(AgentTalk) 마이그레이션 003 — 즐겨찾기 영속화
-- 작성일: 2026-09-26
-- 카드: t_219c4d36 (대표님 지시 — "즐겨찾기로 등록한 카드를 즐겨찾기 카드로 찾아볼 수 있도록")
-- ============================================================
-- 배경: 프론트 즐겨찾기(⭐)가 useCardActions 로컬 상태뿐이라 재접속 시 유실.
-- messages 행에 favorite 컬럼으로 영속화한다.
-- 설계 결정: 별도 favorites 테이블이 아니라 메시지 컬럼 →
--   메시지 삭제·세션 삭제·회원탈퇴 시 기존 FK ON DELETE CASCADE
--   (messages.session_id → sessions, sessions.user_id → users, 001부터)를
--   그대로 따르며 고아 즐겨찾기 행이 구조적으로 발생할 수 없다.

-- 1) messages.favorite 컬럼
ALTER TABLE messages ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN messages.favorite IS '사용자 즐겨찾기(⭐) — 개인 상태. 크로스 디바이스 동기화는 재접속 시 GET /api/favorites (WS 브로드캐스트 없음, MVP)';

-- 2) 인덱스 — 즐겨찾기 목록 조회 경로에 맞춤
--    API 쿼리: WHERE favorite = true AND session_id IN (내 세션들) ORDER BY created_at DESC
--    (백엔드는 service_role + 라우트 수준 소유권 필터를 쓰므로 user_id는 sessions 조인으로 해결 —
--     002 확립 원칙: 모든 쓰기는 백엔드 경유, 읽기도 라우트에서 user_id 필터 명시)
--    부분 인덱스: favorite = true 행만 색인 → 통상 전체 메시지의 소수라 크기가 최소.
CREATE INDEX IF NOT EXISTS idx_messages_favorite ON messages(session_id, created_at DESC) WHERE favorite = true;

-- 3) RLS — "본인 세션 메시지만 update 가능" 보장 방식 (002 쓰기 주체 분리 원칙 유지)
--    002에서 authenticated/anon은 messages에 SELECT 전용 정책만 갖고
--    모든 쓰기는 백엔드 service_role(RLS bypass)을 경유한다.
--    favorite 갱신도 동일 경로: PATCH /api/messages/:id/favorite가
--    라우트 수준 소유권 검증(getOwnedMessage — messages.session_id → sessions.user_id = 요청자,
--    불일치/부재 시 404로 존재 자체를 숨김)을 통과한 행만 UPDATE 한다.
--    → RLS(사용자 직접 쓰기 정책 부재) + 라우트 소유권 검증 이중 방어로
--      "본인 세션 메시지만 update 가능"이 성립. 신규 UPDATE 정책은 의도적으로 추가하지 않는다
--      (추가 시 002의 읽기 전용 원칙이 깨져 클라이언트가 임의 컬럼을 직접 수정 가능해짐).
