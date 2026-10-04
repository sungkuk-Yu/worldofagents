-- ============================================================
-- 마이그레이션 018 — oauth_identities (Supabase Auth OAuth 신원 매핑) [DRAFT — 미적용]
-- 작성일: 2026-10-04 | 작성: 백개발 (카드 t_7e25c65b §4 — '신규 DDL은 초안까지만, 실DB push는 김비서 게이트')
-- ============================================================
-- 상태: 초안. 실DB push 금지 — 배포(018 예약 포함)는 프론트 연동 완료 후 별도 카드로
--       김비서 게이트를 거친다. 이 파일의 존재 자체가 백엔드 준비 완료 표시.
--
-- 근거: 카드 t_7e25c65b §4 (대표님 10/4 지시 '구글/깃허브/카카오/네이버 로그인 준비'의 백엔드
--   세션 통합 설계) — Supabase Auth는 구글 웹 OAuth 클라이언트를 가지되 애플리케이션 DB에
--   provider별 신원 매핑 테이블이 없다. (provider, provider_user_id) → auth.users.id
--   매핑을 만들어야 동일 구글/깃허브/카카오 계정의 재로그인을 같은 사용자로 bind 할 수 있다.
--   판단서: 볼트 [[2026-10-04-백개발-supabase-oauth-세션통합-1단계]]
--
-- 1단계 관계 (t_7e25c65b, 이미 코드 반영):
--   백엔드 requireAuth가 Supabase access token(Bearer)을 폴백 검증(getUser)하고,
--   POST /api/auth/session/exchange가 신원 확정 시 이 테이블에
--   (provider, provider_user_id, user_id, email)를 upsert한다(018 미적용 환경에서는
--   매핑 실패를 경고로 삼고 세션 발급은 속행 — 라우트가 PGRST42P01 등을 견딘다).
--
-- 설계 결정 (김비서 배정 본문 요구: UNIQUE(provider, provider_user_id), user_id FK):
--   * PK는 surrogate UUID — provider_user_id 형식(Google numeric, Kakao int64, GitHub
--     integer→text)이 provider마다 달라 TEXT 정규화 후 복합 UNIQUE로 둔다.
--   * user_id ON DELETE CASCADE: 001 users.id → auth.users(id) CASCADE와 사슬을 맞춰
--     탈퇴 시 매핑 자동 파기(개인정보 보존 원칙, config.retention 코멘트 관례).
--   * RLS: 002 관례 — authenticated/anon SELECT(자기 매핑만), 쓰기 불가(service_role 전용).
--     매핑에는 email/PII가 있으므로 자기 행만 보이는 정책.
--   * updated_at 트리거: 001 update_updated_at() 재사용(004 관례).
--   * created_at 기본 now(): 001 컬럼 선언 관례와 동일.
--
-- 시드/마이그레이션 경주: 번호 예약 — 017(설치카운터) 이후 첫 슬롯. 경주 방지는 git 로그로
--   확인(018_* 파일 없음). 실DB 적용 시 아래 §검증 read-back 수행.
-- 롤백: supabase/rollback/018_oauth_identities_down.sql (DROP TABLE — 데이터 파기,
--   매핑은 재로그인 시 exchange가 재생성하므로 무손실 강등은 아님. 적용 전까지 무효).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS oauth_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,               -- 'google' | 'github' | 'kakao' (GoTrue identities.provider)
    provider_user_id TEXT NOT NULL,       -- GoTrue가 provider에서 받아 저장한 신원 ID (TEXT 정규화)
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    email TEXT,                           -- 스냅샷(최신 로그인 기준) — 재시도/감사용, NULL 허용
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oauth_identities_provider_uid UNIQUE (provider, provider_user_id)
);

COMMENT ON TABLE oauth_identities IS 'OAuth 신원 매핑 — (provider, provider_user_id) → users.id. 쓰기 주체: 백엔드 exchange 라우트(service_role). [t_7e25c65b DRAFT]';

-- ------------------------------------------------------------
-- 1. RLS (002 관례: 읽기 자기-행만, 쓰기 service_role 전용)
-- ------------------------------------------------------------
ALTER TABLE oauth_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oauth_identities_self_read" ON oauth_identities;
CREATE POLICY "oauth_identities_self_read" ON oauth_identities
    FOR SELECT USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 2. updated_at 트리거 (004 관례: 001 update_updated_at() 재사용)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_oauth_identities_updated ON oauth_identities;
CREATE TRIGGER trg_oauth_identities_updated BEFORE UPDATE ON oauth_identities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 3. 인덱스 — UNIQUE 제약이 (provider, provider_user_id)를 커버.
--    user_id 역방향 조회(탈퇴 감사·연락용)는 FK 인덱스 필요:
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS oauth_identities_user_idx ON oauth_identities (user_id);

COMMIT;

-- ------------------------------------------------------------
-- 검증 read-back 프루브 (db push 후 SQL Editor에서 실행, 011/013/017 §검증 관례):
--   SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='oauth_identities';   -- 1
--   SELECT count(*) FROM pg_constraint WHERE conname='oauth_identities_provider_uid';                              -- 1
--   SELECT count(*) FROM pg_trigger WHERE tgname='trg_oauth_identities_updated';                                   -- 1
--   SELECT count(*) FROM pg_policies WHERE tablename='oauth_identities' AND policyname='oauth_identities_self_read'; -- 1
--   INSERT 시나이프(롤백 트랜잭션, service_role 세션에서):
--     BEGIN; INSERT INTO oauth_identities(provider, provider_user_id, user_id, email)
--       VALUES ('google','1234',(SELECT id FROM public.users LIMIT 1),'x@y.z');
--       -- 중복 INSERT 재시도 → 23505 (UNIQUE 봉인 확인) 후 ROLLBACK;
-- ------------------------------------------------------------
