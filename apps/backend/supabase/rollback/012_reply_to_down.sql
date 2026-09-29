-- ============================================================
-- 012_down — messages.reply_to_id 역방향 (롤백 게이트, 대표님 9/29 전보드 지시)
--
-- 사용: 실DB 적용 후 결함 발견 시 수동 실행 (supabase db push는 forward 전용).
--   psql 또는 SQL Editor에서 아래 순서대로 실행 → §검증 프루브.
-- 안전: 012가 ADD한 오브젝트만 역순으로 제거한다. messages 본문 데이터는 삭제하지 않는다.
-- 주의: reply_to_id에 적힌 인용 링크 정보는 컬럼 제거와 함께 소멸 — 백업 스냅샷 후 실행.
-- ============================================================

DROP TRIGGER IF EXISTS trg_messages_reply_to_same_session ON messages;
DROP FUNCTION IF EXISTS enforce_reply_to_same_session();
DROP INDEX IF EXISTS idx_messages_reply_to;
ALTER TABLE messages DROP COLUMN IF EXISTS reply_to_id;

-- 검증 read-back:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'messages' AND column_name = 'reply_to_id';   -- 0행
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_messages_reply_to_same_session';  -- 0행
-- 애플리케이션 코드는 래치(isMissingReplyToColumn: PGRST204/42703)로 자동 강등되므로
-- 롤백 후 백엔드 재시작 불요 (답글 요약 structured_payload.reply_to만 남고 링크 필드 null).
