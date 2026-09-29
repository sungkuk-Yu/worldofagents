-- ============================================================
-- 답글/인용 (012) — messages.reply_to_id (t_02f58030, 리서치 게이트 t_c6cbcd53 백로그④)
-- 원문: "답글은 원문 1줄 인용 + 인용 탭 시 원문 스크롤" (Eitora), "thread_id=원문 msg_id로
--   자동 귀속, 원문 삭제 시 인용만 소멸" (Telegram API).
--
-- 의미: 발화(user 행)가 특정 메시지를 인용하면 reply_to_id에 원문 ID를 기록한다.
--   원문 삭제(FK SET NULL) 시 인용 연결만 소멸하고 답글 행과 스냅샷
--   (structured_payload.reply_to = 발행 시점 요약)은 남는다 — 텔레그램 계약.
--   수신 검증은 백엔드(같은 세션 검증 + invalid 무시 발화 통과)가 1차, 이 트리거가 2차 방패.
--
-- same-session FK (카드 확정): 단칼럼 FK는 messages.id 자체만 검사하므로 다른 세션
--   메시지 참조를 DB가 막지 못한다 → BEFORE INSERT/UPDATE 트리거로 세션 동일성을 강제한다
--   (CROSS_SESSION DENY — 007 §3 deleted_at 마킹 트리거의 문체 패턴 재사용).
-- 실DB 적용은 pooler db push (008/009 절차, t_02f58030 항목⑤) → 아래 §3 read-back 프루브.
-- 롤백: 012_down — supabase/rollback/012_reply_to_down.sql (커밋 revert와 별개의 SQL 역방향).
-- 미적용 환경 안전판: 백엔드 래치(isMissingReplyToColumn: PGRST204/42703 관례)가
--   컬럼을 생략하고 insert하고, structured_payload.reply_to 요약만 남긴다. 발화 무영향.
-- ============================================================

-- ------------------------------------------------------------
-- 1. messages additive 컬럼 (003/011 패턴: NULL 기본값, 기존 행 전부 NULL)
-- ------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID
    REFERENCES messages(id) ON DELETE SET NULL;

COMMENT ON COLUMN messages.reply_to_id IS '답글 인용 원문 ID(t_02f58030) — 같은 세션 메시지 참조(트리거 강제). 원문 삭제 시 인용 연결만 소멸(SET NULL), 답글 행·요약은 유지. 쓰기는 service_role(백엔드) 전용';

-- FK enforcement/SET NULL 스캔 + 인용 체인 조회 (005 idx_ 패턴)
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. same-session 가드 트리거 (CROSS_SESSION DENY)
--    대상 부재는 FK(23503)가 곧 잡아주지만 BEFORE 트리거가 먼저 떨어 동일 에러코드로
--    통일한다. ERRCODE 23503 유지 — 백엔드가 FK 위반과 동일하게 '무시 후 발화 통과'로
--    처리할 수 있게 기존 반납 코드를 재사용한다.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_reply_to_same_session()
RETURNS TRIGGER AS $$
DECLARE
    target_session UUID;
BEGIN
    IF NEW.reply_to_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.reply_to_id = NEW.id THEN
        RAISE EXCEPTION 'CROSS_SESSION_REPLY_TO denied: self-reference'
            USING ERRCODE = '23503';
    END IF;
    SELECT session_id INTO target_session FROM messages WHERE id = NEW.reply_to_id;
    IF target_session IS NULL THEN
        RAISE EXCEPTION 'CROSS_SESSION_REPLY_TO denied: target % not found', NEW.reply_to_id
            USING ERRCODE = '23503';
    END IF;
    IF target_session <> NEW.session_id THEN
        RAISE EXCEPTION 'CROSS_SESSION_REPLY_TO denied: target belongs to another session'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_reply_to_same_session ON messages;
CREATE TRIGGER trg_messages_reply_to_same_session
    BEFORE INSERT OR UPDATE OF reply_to_id ON messages
    FOR EACH ROW EXECUTE FUNCTION enforce_reply_to_same_session();

-- ------------------------------------------------------------
-- 3. RLS — messages 기존 정책(001/002, 컬럼 단위 필터 없음) 그대로 흡수. 변경 불필요.
--    쓰기는 service_role 전용(백엔드)이며 인증 사용자는 messages SELECT만 한다.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 4. 검증 read-back 프루브 (db push 후 SQL Editor 또는 service_role REST로 실행, 007 §4 관례):
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'messages' AND column_name = 'reply_to_id';      -- 1행 uuid
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conrelid = 'messages'::regclass AND conname = 'messages_reply_to_id_fkey';
--   → confdeltype='n' (SET NULL)
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_messages_reply_to_same_session';  -- 1행
--   SET NULL 실측: 같은 세션 B(reply_to_id=A)를 만들고 A를 DELETE → B.reply_to_id IS NULL
--     이면서 B 행存续. CROSS_SESSION 실측: 다른 세션 메시지 ID를 reply_to_id로 INSERT →
--     23503 ('CROSS_SESSION_REPLY_TO denied') 거부. 프루브 행은 즉시 DELETE 클린업.
-- ------------------------------------------------------------
