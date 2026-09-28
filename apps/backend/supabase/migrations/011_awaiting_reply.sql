-- ============================================================
-- 답변 대기 (011) — messages.awaiting_reply / reply_kind (t_811e176c, 대표님 9/28 09:07)
-- 원문: "사용자가 답변해야할걸 따로 지정해서 예/아니오 답변 혹은 주관식 답변으로 할수 있도록
--        상단에 답변대기 버튼을 추가" — 김비서 보드의 '대표님 대기 항목'과 같은 패턴.
--
-- 의미: 에이전트 답변 행(source_neuron='answer')에 사용자 회신(확정/선택/정보 요구)이
--   포함되면 awaiting_reply=true + reply_kind 기록. 사용자가 다음 발화를 보내면 해소(false).
--   후속 질문 칩(suggested_questions, 008 주기)과 다른 계약: 저건 '제안', 이거는 '회신 필요'.
-- 번호: 카드 확정 011 — 010은 t_cc52fd4f(시드 수렴)가 선점.
-- 실DB 적용은 김비서(감독)가 수행한다 (002~009와 동일 절차:
--   supabase db push 또는 SQL Editor 실행 → 아래 §3 read-back 프루브).
-- 미적용 환경 안전판: 백엔드 래치(008 PGRST205 관례 — 여기는 PGRST204/42703)가
--   컬럼을 생략하고 대기 기능만 조용히 꺼진다. 기존 대화 경로는 무영향.
-- ============================================================

-- ------------------------------------------------------------
-- 1. messages additive 컬럼 (003 favorite 패턴: 기본값 안전, 기존 행 false)
-- ------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS awaiting_reply BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_kind TEXT
    CHECK (reply_kind IN ('yesno', 'freeform', 'both'));

COMMENT ON COLUMN messages.awaiting_reply IS '답변 대기(t_811e176c) — 사용자 회신 필요 표시. 사용자 발화로 해소. 쓰기는 service_role(백엔드) 전용';
COMMENT ON COLUMN messages.reply_kind IS '회신 형식: yesno=예/아니오 확정 요구, freeform=주관식 정보 요구, both=둘 다';

-- 배지 스냅샷 조회: 세션의 미해소 대기 행을 턴 순서로
CREATE INDEX IF NOT EXISTS idx_messages_awaiting ON messages(session_id, awaiting_reply, turn_index);

-- ------------------------------------------------------------
-- 2. RLS — messages 기존 정책(001/002)이 컬럼 단위 필터링을 하지 않으므로 변경 불필요.
--    쓰기는 service_role 전용(백엔드)이며 인증 사용자는 messages SELECT만 한다.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 3. 검증 read-back 프루브 (db push 후 SQL Editor에서 실행, 007 §4 관례):
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'messages' AND column_name IN ('awaiting_reply','reply_kind');
--   → 2행 (boolean / text)
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'messages'::regclass AND conname = 'messages_reply_kind_check';
--   → CHECK 정의에 yesno/freeform/both 포함 확인.
--   SELECT count(*) FROM messages WHERE awaiting_reply = true;  -- 기존 행 전부 false(0) 확인
-- ------------------------------------------------------------
