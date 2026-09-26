-- ============================================================
-- 첨부 업로드 재구축 (007) — messages_attachments + 일일 업로드 쿼터 (t_401c5bd1, B안)
-- 작업: 백개발 9/26. 실DB 적용은 김비서(감독)가 수행한다 (002~006과 동일 절차:
--   supabase db push 또는 SQL Editor 실행 → 아래 §4 read-back 프루브).
-- 배경: frontdev t_4497cfce Wave 2 전제 자산. POST /api/upload → Supabase Storage
--   버킷 'attachments'(공개+난수 경로, 코드에서 service key로 생성 — 신규 서비스 가입 없음).
--   파일 바이트는 Storage에, 메타 행은 이 테이블에. messages.attachments JSONB(001)는
--   {id,url,mime,size,name} 요약 배열로 동기화(레거시 렌더 경로 호환).
-- 설계 결정 (즐겨찾기 003/읽기커서 005와 같은 판정 — 개인 상태는 경량 전용 테이블):
--   첨부 메타를 messages 행에 컬럼으로 얹지 않는다. 업로드 시점에는 메시지가 아직 없다
--   (upload → sendMessage 순서) 이므로 message_id는 NULLABLE이고, 전송 시 링크된다.
--   message 삭제(세션 cascade 포함)는 행을 지우지 않고 message_id를 SET NULL + 트리거가
--   deleted_at 마킹 → 파기 큐로 남긴다(Storage 오브젝트 추적 유지). 크론(90일 경계)이
--   Storage 파기 후 행을 삭제한다. 회원탈퇴는 반대 방향: uploader_id FK CASCADE로 행 즉시
--   삭제 + /api/me가 deleteUser 직전 Storage 바이트를 선파기(개인정보보호법 제21조 즉시성).
-- ============================================================

-- ------------------------------------------------------------
-- 1. messages_attachments — 첨부 메타 (Storage object_path의 DB 그림자)
--    재시도 업로드에서 object_path가 겹치면 안 되므로 UNIQUE —
--    /api/attachments/link의 ON CONFLICT 재링크를 idempotent하게 만드는 키.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 전송과제: 첨부 먼저 업로드 후 sendMessage에서 링크 (미링크 = 아직 미전송)
    -- message 삭제(세션 cascade 포함) 시 행은 남고 SET NULL + 트리거가 deleted_at 마킹 →
    -- 파기 큐. 여기가 CASCADE면 행이 함께 사라져 Storage 오브젝트 추적이 불가능해진다.
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    -- 업로드 주체. 탈퇴 = 개인정보 즉시 파기 원칙 → 행은 FK CASCADE로 즉시 삭제되고,
    -- Storage 바이트는 DELETE /api/me가 deleteUser 직전 deleteFromAttachmentsBucket으로 선파기한다.
    uploader_id UUID REFERENCES users(id) ON DELETE CASCADE,
    -- Storage 퍼블릭 URL (버킷 attachments, 난수 uuid 파일명 = capability URL)
    url TEXT NOT NULL,
    object_path TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    size BIGINT NOT NULL CHECK (size >= 0),
    sha256 CHAR(64) NOT NULL,
    -- 파일원명 (화면 표시용. 저장만 하고 검증에는 쓰지 않는다)
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 파기 추적: 세션 cascade 시 트리거가 마킹 → 크론이 Storage 오브젝트 삭제 후 행 삭제.
    deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE messages_attachments IS '첨부 메타 — Supabase Storage(attachments 버킷) 행 단위 그림자. 쓰기 service_role 전용, deleted_at=파기 큐';
CREATE INDEX IF NOT EXISTS idx_messages_attachments_message ON messages_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_attachments_uploader ON messages_attachments(uploader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_pending_purge ON messages_attachments(deleted_at) WHERE message_id IS NULL OR deleted_at IS NOT NULL;

-- ------------------------------------------------------------
-- 2. upload_quota_daily — 사용자당 일일 업로드 쿼터 (단순 카운터)
--    백엔드 원-라운드trip UPSERT (INSERT ... ON CONFLICT DO UPDATE ... RETURNING)로
--    증분 — Supabase pooler(transaction 모드)에서 advisory lock 미사용 원칙 유지.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_quota_daily (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
);

COMMENT ON TABLE upload_quota_daily IS '일일 업로드 카운터(UTC day) — bump_upload_quota RPC만 쓰기, SELECT 폴백 없음';

-- 원-라운드트립 원자적 증가:읽기-검증-쓰기 레이스(공유 클라이언트 + pooler transaction 모드에서
-- advisory lock 미사용 원칙, t_486cf23b 교훈)를 라우트 코드가 아니라 SQL 한 문장으로 봉인한다.
-- 반환: 증분 후 사용량(초회 1, 정상이면 1..p_limit). 한도 초과 시 증가 없이 -1 → 라우트 429 판정.
--   (현재값 반환 방식은 'N번째 성공'과 'N+1번째 거부'가 구분되지 않아 -1 센티넬을 쓴다)
CREATE OR REPLACE FUNCTION bump_upload_quota(p_user UUID, p_day DATE, p_limit INTEGER)
RETURNS INTEGER AS $$
DECLARE v_used INTEGER;
BEGIN
    -- ON CONFLICT WHERE는 UPDATE만 막는다 — 한도 0(비활성화)이면 첫 INSERT도 거부해야 한다.
    IF p_limit IS NULL OR p_limit < 1 THEN RETURN -1; END IF;
    INSERT INTO upload_quota_daily (user_id, day, used)
    VALUES (p_user, p_day, 1)
    ON CONFLICT (user_id, day) DO UPDATE
      SET used = upload_quota_daily.used + 1, updated_at = now()
      WHERE upload_quota_daily.used < p_limit
    RETURNING used INTO v_used;
    RETURN COALESCE(v_used, -1);
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 3. 파기 마킹 트리거 — message 삭제(SET NULL)로 링크가 풀린 행에 deleted_at 기록
--    (탈퇴는 반대 경로: uploader_id FK CASCADE가 행을 즉시 삭제 + /api/me가 Storage 선파기)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_attachments_purge() RETURNS trigger AS $$
BEGIN
    IF NEW.message_id IS NULL AND OLD.message_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
        NEW.deleted_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attachments_purge_mark ON messages_attachments;
-- RI(SET NULL)가 수행하는 UPDATE도 발동한다. 미링크 행이 메시지 없이 지워지는 경로는
-- 탈퇴 CASCADE뿐이므로 마킹 누락 시나리오는 없다.
CREATE TRIGGER trg_attachments_purge_mark BEFORE UPDATE ON messages_attachments
    FOR EACH ROW EXECUTE FUNCTION mark_attachments_purge();

-- ------------------------------------------------------------
-- 4. RLS (002 패턴: authenticated/anon은 SELECT 전용(자기 소유 경유), 쓰기는 service_role)
-- ------------------------------------------------------------
ALTER TABLE messages_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_quota_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attachments_self_read" ON messages_attachments;
CREATE POLICY "attachments_self_read" ON messages_attachments FOR SELECT USING (uploader_id = auth.uid());

DROP POLICY IF EXISTS "quota_owner_read" ON upload_quota_daily;
CREATE POLICY "quota_owner_read" ON upload_quota_daily FOR SELECT USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 5. 검증 read-back 프루브 (db push 후 SQL Editor에서 실행)
--   SELECT tablename FROM pg_tables WHERE tablename IN
--     ('messages_attachments','upload_quota_daily');                    -- 2행 기대
--   SELECT indexname FROM pg_indexes WHERE tablename='messages_attachments'
--     AND indexname='messages_attachments_object_path_key';             -- 1행 (UNIQUE)
--   SELECT polname FROM pg_policies WHERE tablename IN
--     ('messages_attachments','upload_quota_daily');                    -- 2행
--   SELECT count(*) FROM pg_trigger WHERE tgname IN
--     ('trg_attachments_purge_mark');                                   -- ≥1
-- ============================================================
