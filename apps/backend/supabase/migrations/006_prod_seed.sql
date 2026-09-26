-- ============================================================
-- 마이그레이션 006 — 프로덕션 시드 (neurons 5종 + skills 4종 + sessions.title)
-- 실DB 반영 완료 후 기준 데이터. 005_read_state와 번호 충돌 회피 → 006 사용(카드 지시).
-- 작성일: 2026-09-26
-- 카드: t_8ef66bb0 (시드 마이그레이션 005 프로덕션 반영 — D1/A4/A5)
-- 실DB 적용은 김비서(감독)가 수행한다 (002/003/004/005와 동일 절차).
-- Codex 작성/직접 작성 표기: 직접 작성 (백개발, 실DB 프로브 근거).
-- 용도: 실 Supabase(fppcohttpulkqwzapmff)에 1차 런북 순서대로 적용할 시드.
--   1) 001_initial_schema → 2) 002_rls_hardening → 3) 003_favorites →
--   4) 004_vault_board → 5) 005_read_state 가 이미 적용되어 있다고 가정.
--   (9/26 확인: 001~005 모두 적용됨 — session_read_state·messages.favorite 존재)
-- 출처: supabase/seed.sql(개발 시드)의 카탈로그 항목(neuron 5종/skill 4종)을
--   내용 중립적으로 옮겨담은 것. seed.sql 자체는 실행하지 않는다 —
--   seed.sql의 users/agents/personas/sessions/messages/tasks 샘플은
--   auth.users에 없는 고정 UUID를 참조해 FK 위반으로 실패하고(2026-09-26 cutover
--   점검 메모 관측과 동일: 004가 users FK 때문에 중단되는 상태),
--   '김민지/박철수/이개발' 같은 테스트 사용자 프로필 텍스트가 실DB에 들어가 혼입된다.
-- content-neutral 원칙 (P2-5 / P2-b):
--   사용자 프로필성 텍스트(이름·선호·대화 내용) 일체 없음. 카탈로그 정의(시스템)만.
-- ⚠️ P2-py 경계: neurons.name·skills.name은 UNIQUE가 아니거나(스킬) 사용자 행과
--   충돌할 수 있다 → name 충돌 시 해당 행은 INSERT하지 않고 건너뛴다(드롭/덮어쓰기 안 함).
-- ⚠️ P3-java 경계: agents/sessions/personas 테이블은 이 파일이 절대 건드리지 않는다.
-- 실행: psql "$DATABASE_URL" -f supabase/migrations/006_prod_seed.sql  (또는 Supabase SQL Editor에 붙여넣기)
-- 재실행 안전: 전부 slug/exists 가드로 idempotent — 반복 실행해도 중복 없음.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 세션 제목 컬럼 (P2-js #8)
--    실DB 미적용 상태(9/26 확인: column sessions.title does not exist).
--    세션 제목은 백서 §4.0 관계 마스터 모델의 의도상 sessions 고유의 속성이므로
--    컬럼으로 둔다. 단, 기존 세션의 제목 출처는 sessions.metadata->>'title'
--    (favorites.ts의 sessionTitleOf 규칙 — 포크 시 기록)이므로 백필한다.
-- ------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title TEXT;
COMMENT ON COLUMN sessions.title IS '세션 제목 — 미설정 시 metadata->>''title''로 해석(백필됨). 세션 단위 속성이라 관계 마스터 테이블에 둠(§4.0). 빈 문자열 금지 트리거로 NULL/'' 통일 보장.';

-- 빈 문자열/공백 전용 title 금지 (P2-js #8: '' vs NULL 통일)
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

-- 백필: metadata.title을 갖고 title이 없는 세션에만 채운다.
UPDATE sessions
   SET title = btrim(metadata->>'title')
 WHERE title IS NULL
   AND metadata ? 'title'
   AND btrim(coalesce(metadata->>'title', '')) <> '';

-- ------------------------------------------------------------
-- 2. 기본 뉴런 5종 (core 4 + official custom 1)
--    values: seed.sql §2와 동일 정의. ON CONFLICT(slug)로 재실행 안전.
--    name 충돌 가드: 같은 name을 다른 slug 행(사용자 등록 가능성)이 쓰면
--    RAISE NOTICE로 알리고 INSERT/UPDATE를 건너뛴다 (P2-py: 드롭/덮어쓰기 금지).
-- ------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
    clash BOOLEAN;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('공감 에이뉴런', 'empathy',
         '사용자 입력을 즉시 인지하고 공감 반응을 생성. 상시 활성.',
         'core', ARRAY['empathy_response', 'active_listening', 'acknowledgment'],
         ARRAY['any_user_input'],
         '{"cpu": "0.3", "memory": "128MB", "gpu": false, "model": "gpt-4o-mini"}'::jsonb,
         TRUE),
        ('답변생성 에이뉴런', 'answer',
         '사용자 요청에 대한 실질적 답변 생성. 스트리밍 출력.',
         'core', ARRAY['answer_generation', 'research', 'summarization', 'writing'],
         ARRAY['question_detected', 'request_detected'],
         '{"cpu": "1.0", "memory": "512MB", "gpu": false, "model": "gpt-4o"}'::jsonb,
         FALSE),
        ('큐 에이뉴런', 'queue',
         '끼어든 입력의 성격 판별 — 병합 또는 큐잉.',
         'core', ARRAY['intent_classification', 'merge_decision', 'queue_management'],
         ARRAY['active_task_exists', 'user_interruption'],
         '{"cpu": "0.2", "memory": "128MB", "gpu": false, "model": "gpt-4o-mini"}'::jsonb,
         FALSE),
        ('비주얼 에이뉴런', 'visual',
         '표, 차트, 인포그래픽 등 시각 산출물 생성.',
         'core', ARRAY['chart_generation', 'infographic', 'table_rendering', 'svg_output'],
         ARRAY['visual_output_needed', 'chart_request', 'data_visualization'],
         '{"cpu": "1.0", "memory": "1GB", "gpu": false, "model": "gpt-4o"}'::jsonb,
         FALSE),
        ('번역 에이뉴런', 'translation',
         '다국어 입력 감지 시 실시간 번역 제공.',
         'custom', ARRAY['translation', 'language_detection'],
         ARRAY['multilingual_input', 'explicit_translation_request'],
         '{}'::jsonb,   -- seed.sql §번역과 동일: 리소스 요구 미기술 → 빈 객체 (NULL 아님 — NOT NULL 기본값 유지)
         FALSE)
    ) AS v(name, slug, description, category, capabilities, trigger_conditions, resource_requirements, always_active)
    LOOP
        -- name 충돌 확인: 다른 slug의 행(예: 사용자 등록)이 같은 name을 쓰면 건너뜀.
        SELECT EXISTS (
            SELECT 1 FROM neurons n WHERE n.name = r.name AND n.slug <> r.slug
        ) INTO clash;
        IF clash THEN
            RAISE NOTICE 'neuron seed skipped (name 충돌): % / %', r.name, r.slug;
            CONTINUE;
        END IF;

        INSERT INTO neurons (name, slug, description, category, version, author,
                             capabilities, trigger_conditions, resource_requirements,
                             status, always_active, persona_compatible)
        VALUES (r.name, r.slug, r.description, r.category, '1.0.0', 'agenttalk',
                r.capabilities, r.trigger_conditions, r.resource_requirements,
                'active', r.always_active, TRUE)
        ON CONFLICT (slug) DO UPDATE SET
            description = EXCLUDED.description,
            capabilities = EXCLUDED.capabilities,
            trigger_conditions = EXCLUDED.trigger_conditions,
            status = 'active',
            updated_at = now();
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. 스킬 마켓 기본 카탈로그 4종
--    values: seed.sql §10과 동일 정의. content는 기능 설정(jsonb)일 뿐
--    사용자 프로필 텍스트 아님. author_id는 NULL(시스템 발행), author_name은
--    'agenttalk-official'로 통일 — seed.sql의 '이개발'(테스트 사용자명) 실DB 혼입 금지.
--    P3-java 경계: skills 테이블은 사용자 소유가 아니므로 author_id NULL이 안전.
-- ------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('캘린더 동기화', 'calendar-sync',
         'Google Calendar, Outlook 캘린더를 에이전트와 자동 동기화. 일정 추천 및 충돌 감지.',
         'productivity', '2.1.0',
         '{"integration": "google_calendar,outlook", "sync_interval_min": 5, "scopes": ["calendar.read", "calendar.write"]}'::jsonb,
         0),
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
    LOOP
        -- 이미 같은 slug의 사용자/마케팅 행이 있으면 덮지 않고 건너뜀 (P2-py: 드롭 금지).
        IF EXISTS (SELECT 1 FROM skills s WHERE s.slug = r.slug) THEN
            RAISE NOTICE 'skill seed skipped (slug 존재): %', r.slug;
            CONTINUE;
        END IF;
        INSERT INTO skills (name, slug, description, category, version,
                            author_id, author_name, content, price, status)
        VALUES (r.name, r.slug, r.description, r.category, r.version,
                NULL, 'agenttalk-official', r.content, r.price, 'published');
    END LOOP;
END $$;

-- ============================================================
-- 검증 쿼리 (실행 후 확인용 — 주석 해제하고 수행)
-- ============================================================
-- SELECT slug, name, status, category FROM neurons ORDER BY created_at;           -- empathy/answer/queue/visual/translation 5종 active 기대
-- SELECT slug, name, status, author_name FROM skills ORDER BY created_at;          -- calendar-sync/email-assistant/translation-neuron/data-analysis 4종 published, author_name='agenttalk-official' 기대
-- SELECT id, title, metadata->>'title' AS meta_title FROM sessions WHERE title IS NOT NULL;  -- 백필 확인
-- SELECT count(*) FROM sessions WHERE title IS NULL;                                -- metadata.title도 없는 세션 수 (정상: 제목 없는 세션은 NULL 유지)
