-- ============================================================
-- 마이그레이션 016 — context_patch_archives (context_patches 콜드 아카이브 인덱스 테이블)
-- 작성일: 2026-10-01 | 작성: 백개발 (직접 작성 — Codex 미경유)
-- 카드: t_848d0c3b (① 016 DDL + 016_down)
-- ============================================================
-- 근거: 볼트 설계 정본 [[2026-10-01-백개발-context_patches-Storage콜드아카이브-설계]] §1
--   (경로·포맷·인덱스 컬럼 목록) — D1 종결판. 번로 확정 기록(설계 §2, t_58d08ab7):
--   v3(9/30)가 015 후보로 잡았던 아카이브 DDL은 015가 시드 baseline에 선점돼 016으로
--   이관 — 본 파일이 그 예약을 실체화한다. 017 이후 미예약.
--
-- 목적: hot 테이블 context_patches(9/30 실측 312행, +78행/일)에서 90일 경과 행을
--   Supabase Storage private 버킷 `context-archive`의 NDJSON+gzip 객체로 이관할 때,
--   '어떤 세션·어떤 월·어떤 객체에 몇 행이 있는지'의 검색 인덱스. 원본 파기(DELETE)는
--   verified_at(read-back 검증 완료)가 박힌 배치만 가능 — 이 컬럼이 안전문이다.
--   (파이프라인 자체는 scripts/contextArchiveJob.ts, 후속 3단계: 회수 API.)
--
-- 범위(카드 ②): DDL만. context_patches 원본에는 무건드림 — CREATE TABLE/INDEX/RLS/GRANT
--   외 어떤 데이터 작업도 없음(additive-only). 015와 달리 신규 환경에서도 실데이터 무영향.
-- 파기(TTL) 없음 — 대표님 9/26 '전생 기억' 원칙: cold 객체 무기한 보존.
--
-- 실DB 적용은 김비서(감독) 승인 게이트 후 수행 (008~015 관례:
--   supabase db push --include-all(pooler) 또는 psql -f) → 아래 §검증 read-back 프루브.
-- 롤백: supabase/rollback/016_context_patch_archives_down.sql (DROP TABLE, 9/29 지시 관례).
-- ============================================================

-- ------------------------------------------------------------
-- 1. 인덱스 테이블
-- ------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS context_patch_archives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 어떤 세션의 패치인지 — 세션 삭제/탈퇴 시 객체 인덱스 행도 함께 정리(FK CASCADE).
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    -- 세션×월 파티션 키 ('2026-07' 등, created_at의 UTC 월). 객체 경로와 1:1 대응.
    period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
    -- 버킷명 — 설계 고정값이나 future-proof로 컬럼화(버킷 마이그레이션 여지).
    bucket TEXT NOT NULL DEFAULT 'context-archive' CHECK (bucket = 'context-archive'),
    -- Storage 오브젝트 경로: {year}/{month}/session={session_id}.ndjson.gz
    -- (설계 §1 — 버킷 루트로부터의 상대 경로). UNIQUE: 재시도 배치가 같은 객체를
    -- 중복 등록하지 않는 멱등 키(upsert on_conflict 대상).
    object_path TEXT NOT NULL,
    -- 객체 NDJSON 행 수 = 이관된 context_patches 행 수 (DELETE 전 대조, 후 사후 검증).
    -- > 0: 빈 배치(0행)는 잡이 만들지 않는 상태 — 0행 객체가 인덱스에 들어오면 그건 버그다.
    patch_count INTEGER NOT NULL CHECK (patch_count > 0),
    -- 이 객체에 담긴 패치들의 created_at 범위 — hot 창/안전 지연 경계 감사용.
    min_created_at TIMESTAMPTZ NOT NULL,
    max_created_at TIMESTAMPTZ NOT NULL CHECK (max_created_at >= min_created_at),
    -- gzip 후 바이트 수 (cost/bloat 감사용 원값). gzip 스트림 최소 크기(≈20B)보다 항상 크므로 > 0.
    bytes_compressed BIGINT NOT NULL CHECK (bytes_compressed > 0),
    -- gzip 객체 전체의 sha256 hex (64) — read-back 무결성 대조 기준(설계 §3 파이프라인).
    checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
    -- 업로드 시각.
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 안전문: read-back 검증(sha 대조+행 수+샘플 delta) 통과 시각.
    -- NULL = 미검증 — 이 행의 객체에 대응하는 원본 패치 DELETE는 절대 금지.
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT context_patch_archives_object_path_key UNIQUE (object_path)
);

COMMENT ON TABLE context_patch_archives IS 'context_patches 콜드 아카이브 인덱스(t_848d0c3b, 설계 016) — Storage 객체 1개 = 1행. 원본 DELETE는 verified_at NOT NULL 배치만. 쓰기 service_role 전용';

-- ------------------------------------------------------------
-- 2. 인덱스
-- ------------------------------------------------------------
-- 회수 경로(설계 §3 GET /sessions/:id/context/archives + cold 폴백): 세션 단위 목록.
CREATE INDEX IF NOT EXISTS idx_cpa_session ON context_patch_archives(session_id, period);
-- 잡 스케줄러 감사·모니터링: 미검증(verified_at NULL) 객체 스캔.
CREATE INDEX IF NOT EXISTS idx_cpa_unverified ON context_patch_archives(object_path) WHERE verified_at IS NULL;

-- ------------------------------------------------------------
-- 3. RLS + GRANT (002/014 원칙 동일 계층)
-- ------------------------------------------------------------
-- MVP 원칙: authenticated/anon 읽기 전용, 모든 쓰기는 백엔드 service_role(RLS bypass).
-- 사용자열람은 백엔드 API 경유가 정경로지만, owner SELECT 정책은 002 context_patches와
-- 동일 형태로 걸어 두는 것이 방어 깊이에 유리(직접 PostgREST 노출 실수 시에도 자기 세션만).
ALTER TABLE context_patch_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "context_patch_archives_owner_read" ON context_patch_archives;
CREATE POLICY "context_patch_archives_owner_read" ON context_patch_archives
    FOR SELECT USING (session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid()));

-- GRANT (014 관례 — Supabase가 신규 테이블에 기본 권한을 주지 않으므로 명시 필요).
GRANT SELECT ON context_patch_archives TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON context_patch_archives TO service_role;

COMMIT;

-- ------------------------------------------------------------
-- 4. 검증 read-back (실DB 적용 시 주석 해제하고 수행 — 007/011/014 관례):
--   SELECT count(*) FROM information_schema.columns WHERE table_name='context_patch_archives';  -- 14 (카드 최소 10 + period(세션×월 파티션 키) + id·created_at·updated_at)
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='context_patch_archives'::regclass;
--   → PRIMARY KEY / FK CASCADE / object_path UNIQUE / CHECK 6 (period·bucket·count·range·bytes·checksum)
--   SELECT indexname FROM pg_indexes WHERE tablename='context_patch_archives';  -- 4 (PK·UNIQUE·idx_cpa_session·idx_cpa_unverified)
--   SELECT relrowsecurity FROM pg_class WHERE relname='context_patch_archives'; -- t
--   SELECT policyname FROM pg_policies WHERE tablename='context_patch_archives'; -- 1 (owner_read)
-- 로컬 하네스: scripts/verify_016_local_pg.py (pgserver) — 001→016 순차 적용,
--   제약 위반 6케이스 거부, 부분 인덱스·멱등 재실행 검증.
-- ============================================================
