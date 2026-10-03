-- ============================================================
-- 마이그레이션 017 — bump_skill_install_count (skills.install_count 원자 증감 RPC)
-- 작성일: 2026-10-03 | 작성: 백개발 (직접 작성 — Codex 미경유)
-- 카드: t_e1334cee (P1-3, 볼트 [[2026-10-03-백개발-numbers-boundary-감사]] §3)
-- ============================================================
-- 근거: POST/DELETE /api/skills/:id/install가 직전 select 값으로 install_count를
--   read-modify-write — (a) JSONB 타입 드리프트 시 "3"+1="31" 문자 폭발, (b) 동시
--   설치/제거 레이스에서 카운터 누락. 감사 초안의 근본 해결안(RPC 원자화)을 김비서
--   승인(t_e1334cee 카드 ①)에 따라 실행. 번호 예약: 016(아카이브 DDL) 다음 첫 슬롯 —
--   016 본문이 '017 이후 미예약'으로 명시, 경주 없음.
--
-- 관례: 007 bump_upload_quota의 "원-라운드트립 원자적 증가" 동일 방식 —
--   라우트 코드가 아니라 SQL 한 문장으로 레이스를 봉인. SECURITY DEFINER/GRANT 없음
--   (007/001 increment_neuron_usage·record_skill_feedback와 동일 — 백엔드는
--   service_role 전용 실행, RLS 정책과 무관).
-- 시맨틱: DB 저장값 기준 + p_delta (±1), GREATEST 하한 0 — 직전 select 오염("banana")과
--   무관하게 항상 유한 정수. 라우트 폴백(Number 가드 RMW)은 017 미적용 환경(PGRST202) 전용.
--
-- 실DB 적용은 김비서(감독) 승인 게이트 후 수행 (008~016 관례:
--   supabase db push --include-all(pooler) 또는 psql -f) → 아래 §검증 read-back 프루브.
-- 롤백: supabase/rollback/017_install_count_atomic_down.sql (DROP FUNCTION).
--   롤백 후에도 백엔드는 라우트 폴백으로 자동 강등(재시작 불요) — 카운터는 RMW로 계속 갱신.
-- 데이터 작업 0건: 신규 함수 CREATE만, skills 행/스키마 무건드림 (additive-only).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION bump_skill_install_count(p_skill_id UUID, p_delta INTEGER)
RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
    IF p_delta IS NULL OR p_delta NOT IN (-1, 1) THEN
        RAISE EXCEPTION 'p_delta must be -1 or 1';
    END IF;
    UPDATE skills
       SET install_count = GREATEST(0, install_count + p_delta)
     WHERE id = p_skill_id
     RETURNING install_count INTO v_count;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ------------------------------------------------------------
-- 검증 read-back 프루브 (db push 후 SQL Editor에서 실행, 011/013 §3 관례):
--   SELECT routine_name, data_type FROM information_schema.routines
--     WHERE routine_name = 'bump_skill_install_count';
--   → 1행 (integer)
--   SELECT bump_skill_install_count('00000000-0000-0000-0000-000000000000'::uuid, 1);
--   → NULL (없는 스킬 = 0행 update, 부작용 없음)
--   SELECT bump_skill_install_count('<실존 skill id>'::uuid, -99);
--   → ERROR "p_delta must be -1 or 1" (센티넬 봉인 확인 — 실카운터 무영향)
-- ------------------------------------------------------------
