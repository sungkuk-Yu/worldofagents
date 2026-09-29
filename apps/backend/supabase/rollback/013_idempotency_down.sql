-- ============================================================
-- 013_down — messages.client_req_id 역방향 (롤백 게이트, 대표님 9/29 전보드 지시)
--
-- 사용: 실DB 적용 후 결함 발견 시 수동 실행 (supabase db push는 forward 전용).
--   psql 또는 SQL Editor에서 아래 순서대로 실행 → §검증 프루브.
-- 안전: 013이 ADD한 오브젝트만 역순으로 제거한다. messages 본문 데이터는 삭제하지 않는다.
-- 주의: client_req_id에 적힌 재전송 식별 정보가 컬럼과 함께 소멸 — 이후 재전송은
--   새 메시지로 접수된다(중복 차단 능력만 사라짐, 대화 데이터 무영향).
-- 순서: 012(reply_to)보다 늦게 적용된 마지막 레이어 — 부분 롤백 가능(다른 컬럼과 독립).
-- ============================================================

DROP INDEX IF EXISTS idx_messages_client_req;
DROP INDEX IF EXISTS uq_messages_client_req;
ALTER TABLE messages DROP COLUMN IF EXISTS client_req_id;

-- 검증 read-back:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'messages' AND column_name = 'client_req_id';   -- 0행
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'messages' AND indexname IN ('uq_messages_client_req','idx_messages_client_req');  -- 0행
-- 애플리케이션 코드는 래치(isMissingClientReqColumn: PGRST204/42703)로 자동 강등되므로
-- 롤백 후 백엔드 재시작 불요 (멱등만 조용히 off, 기존 대화 경로 무영향).
-- 1차 급소(재시작 불요): 백엔드 env MESSAGE_IDEMPOTENCY_DISABLED=true — 컬럼 유지 상태에서
--   클라이언트 어필리케이션 레벨로 멱등 코드 경로만 차단.
