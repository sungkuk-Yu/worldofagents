-- ============================================================
-- 마이그레이션 015 — D1 시드 보장 baseline (실패로그 §D D1 종결 카드 t_58d08ab7)
-- 작성일: 2026-10-01 | 작성: 백개발 (직접 작성 — Codex 미경유)
-- 카드: t_58d08ab7 (심야 마이그레이션 015 시드 보장 — neurons/skills/title, additive만)
-- ============================================================
-- 근거 (실DB read-only 감사, 2026-10-01 14:2x UTC, PostgREST service_role SELECT 전용 —
--   감사 스크립트: apps/backend/scripts/live_db_readonly_audit.py, 출력 무캐시):
--   ① neurons: 5행 = core 4(empathy/answer/queue/visual, active) + translation(custom, active)
--      — 백서 §3.3 4종 + 카탈로그 관례. 006→010 경로로 실DB 목표 상태 도달 확인.
--   ② skills: official 4종(calendar-sync/data-analysis/email-assistant/translation-neuron,
--      published, author_name='agenttalk-official') 존재.
--   ③ sessions.title 컬럼 실재. 세션 97 = title 보유 77 / NULL 20. NULL 20세션 전부
--      user 메시지 0행(직접 프루브: role=eq.user × session_id=in.(NULL-ids) → 0행) —
--      010 §3b 백필 규칙상 유효 대상 0. "user 메시지 보유 ∩ title NULL" = 0행(역방향 프루브:
--      user 메시지 보유 세션 77 = title 보유 세션 77, 교차 잔여 0).
--   → 카드 ① '중복/충돌 확인 후 잔여분' 실측 결과: **잔여 0**. neurons/skills/title 백필
--     모두 006+010이 정의상·실태상 커버. 따라서 015는 신규 데이터를 넣는 시드가 아니라
--     **어떤 환경(신규/리셋 DB 포함)에서도 D1 baseline을 단발 db push로 확정할 수 있는
--     보장(保險) 마이그레이션**: 값 정의는 010_seed_convergence와 1:1 미러(수명 충돌·드리프트
--     방지), 전체 ON CONFLICT/가드 DO NOTHING — 수렴된 실DB에서는 모든 문이 0-row no-op
--     (로컬 PG 001→015 전량 재현 + 재실행 멱등 + 사용자 변경 보존 시나리오로 실측).
--     010과의 100% 내용 중복이 성립하며, 이 중복 자체가 카드 요구 '충돌 확인'의 산출물이다.
--     충돌 회피: name/slug 사전 가드 + DO NOTHING — 기존 행 드롭/덮어쓰기 절대 없음.
--   번로 확정(결정 기록): 본 파일이 015를 점유한다. 콜드 아카이브 DDL(context_patch_
--     archives)로 예약됐던 번호는 **다음 빈번호(016)로 이관** — 볼트 설계 v3 §(a)의
--     "015 후보" 갱신(카드 코멘트에 정직 기록).
--
-- 실행: 김비서/대표님 승인 게이트 후 `supabase db push --include-all`(pooler 경유, 008~014 관례)
--   또는 psql "$DATABASE_URL" -f supabase/migrations/015_seed_baseline.sql
-- 롤백: additive 전용 — 수렴 환경에서는 0행 변경이라 삭제 대상 자체가 없음(신규 DB에만 의미).
--   필요 시 수동: DELETE FROM neurons WHERE slug IN (...) AND author='agenttalk' AND
--   created_at=<015 적용 시각>; skills likewise — down 스크립트는 관례에 따라 별도 카드.
-- P2-py 경계: 사용자 행 드롭/덮어쓰기 금지 → 모든 INSERT는 가드 후 DO NOTHING.
-- P3-java 경계: agents/personas/users 테이블 무건드림.
-- content-neutral 원칙: 카탈로그 정의(시스템)만 — 사용자 프로필성 텍스트 일체 없음.
-- RLS: 새 테이블 없음 → 정책 추가 없음(002_rls_hardening 패턴 준수: sessions owner 정책
--   하위의 일반 컬럼이라 정책 무변경).

BEGIN;

-- ------------------------------------------------------------
-- 1. sessions.title 컬럼 재확인 (006 §1 정의 1:1, IF NOT EXISTS라 수렴 DB에서는 no-op)
--    생성 로직은 백엔드 src/lib/sessionTitle.ts(첫 발화 압축), NULL 허용 — 프론트
--    렌더는 별도 frontdev 카드(카드 body ③).
-- ------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title TEXT;
COMMENT ON COLUMN sessions.title IS '세션 제목 — 미설정 시 metadata->>''title''로 해석(백필됨). 세션 단위 속성이라 관계 마스터 테이블에 둠(§4.0). 빈 문자열 금지 트리거로 NULL/'' 통일 보장. (015 baseline 재확인)';

-- 빈 문자열/공백 전용 title 금지 (006 §1 트리거와 동일 정의 — CREATE OR REPLACE라 멱등)
CREATE OR REPLACE FUNCTION sessions_title_blank_to_null() RETURNS trigger AS $$
BEGIN
    IF NEW.title IS NOT NULL AND btrim(NEW.title) = '' THEN
        NEW.title := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sessions_title_blank_to_null ON sessions;
CREATE TRIGGER trg_sessions_title_blank_to_null
    BEFORE INSERT OR UPDATE OF title ON sessions
    FOR EACH ROW EXECUTE FUNCTION sessions_title_blank_to_null();

-- ------------------------------------------------------------
-- 2. neurons baseline — 백서 §3.3 core 4종 + 공식 custom(translation) 1종
--    values: 010 §1과 1:1 미러(010은 006/seed.sql §2 동일 정의 — 실DB read-back 확인됨).
--    name UNIQUE(001) 충돌(다른 slug가 같은 name 점유)은 WHERE 가드로 해당 행만 스킵,
--    slug 충돌은 ON CONFLICT (slug) DO NOTHING — 010 패턴 그대로. 기존 행 수정 없음.
-- ------------------------------------------------------------
INSERT INTO neurons (name, slug, description, category, version, author,
                     capabilities, trigger_conditions, resource_requirements,
                     status, always_active, persona_compatible)
SELECT v.name, v.slug, v.description, v.category, v.version, v.author,
       v.capabilities, v.trigger_conditions, v.resource_requirements,
       v.status, v.always_active, v.persona_compatible
FROM (VALUES
    ('공감 에이뉴런', 'empathy',
     '사용자 입력을 즉시 인지하고 공감 반응을 생성. 상시 활성.',
     'core'::text, '1.0.0'::text, 'agenttalk'::text,
     ARRAY['empathy_response', 'active_listening', 'acknowledgment'],
     ARRAY['any_user_input'],
     '{"cpu": "0.3", "memory": "128MB", "gpu": false, "model": "gpt-4o-mini"}'::jsonb,
     'active'::text, TRUE, TRUE),
    ('답변생성 에이뉴런', 'answer',
     '사용자 요청에 대한 실질적 답변 생성. 스트리밍 출력.',
     'core', '1.0.0', 'agenttalk',
     ARRAY['answer_generation', 'research', 'summarization', 'writing'],
     ARRAY['question_detected', 'request_detected'],
     '{"cpu": "1.0", "memory": "512MB", "gpu": false, "model": "gpt-4o"}'::jsonb,
     'active', FALSE, TRUE),
    ('큐 에이뉴런', 'queue',
     '끼어든 입력의 성격 판별 — 병합 또는 큐잉.',
     'core', '1.0.0', 'agenttalk',
     ARRAY['intent_classification', 'merge_decision', 'queue_management'],
     ARRAY['active_task_exists', 'user_interruption'],
     '{"cpu": "0.2", "memory": "128MB", "gpu": false, "model": "gpt-4o-mini"}'::jsonb,
     'active', FALSE, TRUE),
    ('비주얼 에이뉴런', 'visual',
     '표, 차트, 인포그래픽 등 시각 산출물 생성.',
     'core', '1.0.0', 'agenttalk',
     ARRAY['chart_generation', 'infographic', 'table_rendering', 'svg_output'],
     ARRAY['visual_output_needed', 'chart_request', 'data_visualization'],
     '{"cpu": "1.0", "memory": "1GB", "gpu": false, "model": "gpt-4o"}'::jsonb,
     'active', FALSE, TRUE),
    ('번역 에이뉴런', 'translation',
     '다국어 입력 감지 시 실시간 번역 제공.',
     'custom', '1.0.0', 'agenttalk',
     ARRAY['translation', 'language_detection'],
     ARRAY['multilingual_input', 'explicit_translation_request'],
     '{}'::jsonb,   -- 006/010과 동일: 리소스 요구 미기술 → 빈 객체 (NULL 아님)
     'active', FALSE, TRUE)
) AS v(name, slug, description, category, version, author,
       capabilities, trigger_conditions, resource_requirements,
       status, always_active, persona_compatible)
WHERE NOT EXISTS (SELECT 1 FROM neurons n WHERE n.name = v.name AND n.slug <> v.slug)
ON CONFLICT (slug) DO NOTHING;

-- ------------------------------------------------------------
-- 3. skills baseline — 공식 카탈로그 4종 published, author_name='agenttalk-official'
--    values: 010 §2와 1:1 미러. user_id 소유 구조 유지: 시스템 프리픽스 = author_id
--    NULL(스키마상 author_id는 users(id) FK — well-known user 행 강제 생성 없이 NULL로
--    시스템 발행 표현, 006/010 관례) + author_name 문자열.
--    ON CONFLICT (slug) DO NOTHING — 사용자/마케팅 행 덮어쓰기 금지. name UNIQUE는
--    skills에 없어 slug 가드만 유효(010 동일).
-- ------------------------------------------------------------
INSERT INTO skills (name, slug, description, category, version,
                    author_id, author_name, content, price, status)
SELECT v.name, v.slug, v.description, v.category, v.version,
       NULL, 'agenttalk-official', v.content, v.price, 'published'
FROM (VALUES
    ('캘린더 동기화'::text, 'calendar-sync'::text,
     'Google Calendar, Outlook 캘린더를 에이전트와 자동 동기화. 일정 추천 및 충돌 감지.'::text,
     'productivity'::text, '2.1.0'::text,
     '{"integration": "google_calendar,outlook", "sync_interval_min": 5, "scopes": ["calendar.read", "calendar.write"]}'::jsonb,
     0::int),
    ('이메일 어시스턴트', 'email-assistant',
     'Gmail/Outlook 이메일 자동 분류, 우선순위 설정, 답장 초안 생성.',
     'communication', '1.5.2',
     '{"providers": ["gmail", "outlook"], "auto_classify": true, "draft_style": "matching_persona"}'::jsonb,
     5000),
    ('실시간 번역 뉴런', 'translation-neuron',
     '다국어 대화 실시간 번역. 뉴런으로 등록되어 자동 활성화.',
     'neuron', '1.0.0',
     '{"neuron_slug": "translation", "supported_languages": 50, "model": "nllb-200-distilled-600M"}'::jsonb,
     0),
    ('데이터 분석', 'data-analysis',
     'CSV/Excel 파일 업로드 시 자동 분석 및 인사이트 도출.',
     'analysis', '1.2.0',
     '{"supported_formats": ["csv", "xlsx"], "max_size_mb": 100, "auto_chart": true}'::jsonb,
     10000)
) AS v(name, slug, description, category, version, content, price)
ON CONFLICT (slug) DO NOTHING;

-- ------------------------------------------------------------
-- 3a/3b. sessions.title 백필 (010 §3a/§3b 규칙 1:1 승계 — 결정론·무LLM)
--    실DB 잔여 0 실측(2026-10-01: NULL 20세션 전부 user 메시지 0행)이라 수렴 환경에서는
--    0행 UPDATE no-op. 신규/리셋 DB에만 실효.
--    3a: metadata.title 보유 세션 (006 §1 규칙 유지)
--    3b: 첫 사용자 메시지 요약 — src/lib/sessionTitle.ts:deriveSessionTitle와 1:1
--        (① 개행 전 첫 행 ② 공백 연속 한 칸 접기·trim ③ 50자 초과 시 left(49)||'…',
--         PG length/left는 코드포인트 단위 — TS 스프레드 문자열과 동일 기준)
--    기존 title 절대 불변 — WHERE s.title IS NULL 봉인. 006 빈문자열→NULL 트리거 경유.
-- ------------------------------------------------------------
UPDATE sessions
   SET title = btrim(metadata->>'title')
 WHERE title IS NULL
   AND metadata ? 'title'
   AND btrim(coalesce(metadata->>'title', '')) <> '';

WITH first_user AS (
    SELECT DISTINCT ON (m.session_id) m.session_id, m.content
      FROM messages m
     WHERE m.role = 'user'
     ORDER BY m.session_id, m.turn_index ASC, m.created_at ASC, m.id ASC
), derived AS (
    SELECT session_id,
           NULLIF(btrim(regexp_replace(split_part(content, E'\n', 1), '[[:space:]]+', ' ', 'g')), '') AS t
      FROM first_user
)
UPDATE sessions s
   SET title = CASE WHEN length(d.t) > 50 THEN left(d.t, 49) || '…' ELSE d.t END
  FROM derived d
 WHERE s.id = d.session_id
   AND s.title IS NULL
   AND d.t IS NOT NULL;

-- ------------------------------------------------------------
-- 3c. 잔여 NULL 진단 NOTICE (쓰기 없음 — 감독자가 적용 로그로 확인)
-- ------------------------------------------------------------
DO $$
DECLARE
    n_total INTEGER; n_null INTEGER; n_meta INTEGER; n_orphan INTEGER;
BEGIN
    SELECT count(*) INTO n_total FROM sessions;
    SELECT count(*) INTO n_null FROM sessions WHERE title IS NULL;
    SELECT count(*) INTO n_meta FROM sessions WHERE title IS NULL AND metadata ? 'title';
    -- 백필 유효 대상 잔여(=0 기대): user 메시지 있는데 title 없는 세션
    SELECT count(*) INTO n_orphan FROM sessions s
     WHERE s.title IS NULL
       AND EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id AND m.role = 'user');
    RAISE NOTICE '015 baseline 후 세션 title 현황 — 전체 %, NULL 잔여 % (metadata.title 폴백 %, 백필불가 orphan %)',
        n_total, n_null, n_meta, n_orphan;
END $$;

-- ------------------------------------------------------------
-- 4. 카탈로그 상태 read-back NOTICE (검증 커멘트 대체 — 적용 로그에서 확인)
-- ------------------------------------------------------------
DO $$
DECLARE
    n_neuron INTEGER; n_skill INTEGER;
BEGIN
    SELECT count(*) INTO n_neuron FROM neurons WHERE status = 'active'
      AND slug = ANY (ARRAY['empathy','answer','queue','visual','translation']);
    SELECT count(*) INTO n_skill FROM skills WHERE status = 'published'
      AND author_name = 'agenttalk-official';
    RAISE NOTICE '015 baseline 후 카탈로그 — active neurons 5 기대: %, official published skills 4 기대: %', n_neuron, n_skill;
    IF n_neuron < 5 OR n_skill < 4 THEN
        RAISE WARNING '015 baseline 불충족 — name/slug 충돌로 스킵된 행 존재. 드롭/덮어쓰기 금지 원칙상 수동 확인 필요.';
    END IF;
END $$;

COMMIT;

-- ============================================================
-- 검증 read-back (김비서 승인 후 실DB 적용 시 동일 절차 — 주석 해제하고 수행):
--   SELECT slug, category, status FROM neurons ORDER BY slug;   -- 5종 active (core 4 + translation custom)
--   SELECT slug, status, author_name FROM skills ORDER BY slug; -- 공식 4 published / 'agenttalk-official'
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='sessions' AND column_name='title';       -- 1행
--   SELECT count(*) FROM sessions s WHERE s.title IS NULL
--     AND EXISTS (SELECT 1 FROM messages m WHERE m.session_id=s.id AND m.role='user');  -- 0
--   재실행 멱등: 행 수·값 DRIFT 0.
-- 로컬 하네스: scripts/verify_015_local_pg.py (pgserver) — 001→015 순차 적용, 백필 6케이스,
--   재적용 멱등, 사용자 변경(deprecated/draft) 보존 검증.
-- ============================================================
