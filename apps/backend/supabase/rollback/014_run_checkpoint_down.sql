-- ============================================================
-- 014_down — 내구성 실행 테이블 역방향 (롤백 게이트, 대표님 9/29 전보드 지시)
--
-- 사용: 실DB 적용 후 결함 발견 시 수동 실행 (supabase db push는 forward 전용).
--   SQL Editor/psql에서 아래 순서로 → §검증 프루브.
-- 안전: 014가 만든 3테이블만 역순 제거. messages/sessions 등 기존 데이터 무건드림.
--   체크포인트에 남은 미완 run 상태는 소멸 — 백엔드는 flag(LANGGRAPH_CHECKPOINT)를
--   내리거나 첫 PGRST205 래치로 조용히 무영속 경로(기존 동작)로 복귀하므로
--   롤백 후 재시작 불요.
-- ============================================================

DROP TABLE IF EXISTS graph_checkpoint_writes;
DROP TABLE IF EXISTS graph_checkpoints;
DROP TABLE IF EXISTS graph_runs;

-- 검증 read-back:
--   SELECT tablename FROM pg_tables WHERE tablename LIKE 'graph_%';   -- 0행
--   SELECT indexname FROM pg_indexes WHERE indexname LIKE 'graph_%';  -- 0행
-- 애플리케이션: LANGGRAPH_CHECKPOINT=true라도 saver의 첫 조회가 PGRST205 →
--   isJournalKnownUnavailable() 래치, 모든 훅 no-op (턴 실행·저장 무영향 확인:
--   unit durability resume 테스트가 skip으로 바뀌지 않고 plain 실행으로 통과해야 한다).
