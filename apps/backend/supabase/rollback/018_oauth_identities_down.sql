-- 롤백 018 — oauth_identities 파기 [DRAFT — 018 미적용 상태에서는 실행할 것이 없다]
-- 카드: t_7e25c65b (DRAFT — 배포는 프론트 연동 후 별도 카드, 김비서 게이트)
-- 주의: 매핑 행은 재로그인 시 session/exchange가 재생성하지만 삭제 시점~재로그인 사이
--       동일 OAuth 계정의 bind 이력이 사라진다 — 운영 데이터가 된 뒤에는 신중히.
BEGIN;
DROP TRIGGER IF EXISTS trg_oauth_identities_updated ON oauth_identities;
DROP POLICY IF EXISTS "oauth_identities_self_read" ON oauth_identities;
DROP TABLE IF EXISTS oauth_identities;
COMMIT;
