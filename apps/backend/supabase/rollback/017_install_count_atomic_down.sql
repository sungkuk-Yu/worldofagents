-- ============================================================
-- 017_down — bump_skill_install_count 역방향 (롤백 게이트, 9/29 전보드 지시 관례)
--
-- 사용: 실DB 적용 후 결함 발견 시 수동 실행 (supabase db push는 forward 전용).
--   psql 또는 SQL Editor에서 실행 → §검증 프루브.
-- 안전: 017이 CREATE한 함수만 제거한다. skills 테이블·행·컬럼은 건드리지 않는다.
-- 롤백 후 동작: 라우트 bumpInstallCount의 RPC가 PGRST202로 실패 → Number 가드 RMW
--   폴백으로 자동 강등 (재시작 불요). 카운터 능력은 유지, 원자성만 017 이전 수준 회귀.
-- ============================================================

DROP FUNCTION IF EXISTS bump_skill_install_count(UUID, INTEGER);

-- 검증 read-back:
--   SELECT routine_name FROM information_schema.routines
--    WHERE routine_name = 'bump_skill_install_count';   -- 0행
