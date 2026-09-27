-- ============================================================
-- photo_edit 카드 라우팅 (009) — messages.dialogue_type CHECK 확장 (t_78ffba4f, Wave 2 서버측)
-- 작업: 백개발 9/27. 실DB 적용은 김비서(감독)가 수행한다 (007과 동일 절차:
--   supabase db push 또는 SQL Editor 실행 → 아래 read-back 프루브).
-- 배경: 프론트 t_4497cfce가 registerCard('photo_edit', PhotoEditAgentCard) 배선 완료.
--   백엔드가 photo_edit 디렉티브 턴의 답변에 dialogue_type='photo_edit'를 emit하려면
--   002의 CHECK 허용 목록 확장 필수 (없으면 실DB INSERT 23514 거부).
-- 결정: 기존 'media' 재사용 금지(#182) — media는 백엔드가 한 번도 emit한 적 없는
--   프론트 전용 타입이므로 그대로 두고 photo_edit를 추가한다.
-- ============================================================

-- 002에서 컬럼 인라인 CHECK로 생성된 기본 이름 messages_dialogue_type_check.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_dialogue_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_dialogue_type_check
    CHECK (dialogue_type IN ('text','info_card','spreadsheet','file','task_flow','multi_agent','photo_edit'));

-- ------------------------------------------------------------
-- read-back 프루브 (적용 후 실행, 007 §4 관례):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'messages'::regclass AND conname = 'messages_dialogue_type_check';
--   → 정의 문자열에 'photo_edit' 포함 확인.
-- ------------------------------------------------------------
