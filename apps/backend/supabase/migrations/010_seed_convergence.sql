-- ============================================================
-- 마이그레이션 010 — 심야 D1 수렴 가드: 카탈로그 시드(neurons 기본 4종+공식 번역 1종 /
-- skills 공식 4종) ON CONFLICT DO NOTHING + sessions.title 첫 메시지 요약 백필 (t_cc52fd4f)
-- 작성: 백개발 (직접 작성) 2026-09-27. 대표님 9/28 심야 루프 지시.
-- 실DB 적용은 김비서→대표님 승인 게이트 — 이 카드는 파일+dev/로컬 검증까지 (실DB push 금지).
--
-- additive 전용: CREATE ... IF NOT EXISTS / INSERT ... ON CONFLICT DO NOTHING /
-- 조건부 UPDATE(title IS NULL)만 사용. DELETE·TRUNCATE·DROP·ALTER ... DROP 일체 없음.
-- 기존 행 덮어쓰기 없음 — name/slug 충돌 시 해당 행 스킵 (006 P2-py 경계 동일).
--
-- 006_prod_seed와의 관계(카드 감사 코멘트 참조): 006은 "실DB 최초 반영"용(값 보정
-- DO UPDATE 포함). 이 010은 "어떤 환경(신규 DEV Supabase·로컬 테스트 DB·006 이전
-- 드리프트)이든 최종 카탈로그로 수렴"시키는 멱등 가드 — DO NOTHING이라 기존 값을
-- 절대 바꾸지 않는다. 006 적용済み 실DB에서는 010 시드부는 전부 no-op, 백필부만 유효하게 동작한다.
--
-- ⚠️ 세션 목록/즐겨찾기의 제목 해석 규칙(캐논 title → metadata.title 폴백)과
-- 신규 세션 첫 턴 자동 채움은 src/lib/sessionTitle.ts(백엔드 런타임)가 구현 —
-- 3절 백필 SQL과 규칙(첫 행·공백 접기·50자 초과 시 left(49)+'…')을 1:1 맞춘다.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. neurons 기본 카탈로그 — 4종(core) + 공식 커스텀 1종(translation)
--    값: 006/seed.sql §2와 동일 정의(감사 코멘트: 백서·기존 풀 실명 empathy/answer/queue/visual,
--    카드 예시명 변호사/보호관/범용/오케스트레이터는 백서에 실존하지 않아 기각).
--    slug 충돌 → ON CONFLICT DO NOTHING. name UNIQUE(001) 충돌(다른 slug가 같은 name 점유)은
--    WHERE 가드로 해당 행만 건너뛴다 — bulk INSERT가 name 위반으로 통째 실패하는 일 방지.
--    기존 행은 절대 수정하지 않는다 (additive).
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
     '{}'::jsonb,   -- 006과 동일: 리소스 요구 미기술 → 빈 객체 (NULL 아님)
     'active', FALSE, TRUE)
) AS v(name, slug, description, category, version, author,
       capabilities, trigger_conditions, resource_requirements,
       status, always_active, persona_compatible)
WHERE NOT EXISTS (SELECT 1 FROM neurons n WHERE n.name = v.name AND n.slug <> v.slug)
ON CONFLICT (slug) DO NOTHING;

-- ------------------------------------------------------------
-- 2. skills 공식 카탈로그 4종 — skills 테이블은 001부터 실존(감사 코멘트: 실DB
--    4행 published 확인). 신규 테이블 없음 — "현 structures 재사용"이 카드 ②의 판정.
--    006 §3과 동일 정의. author_id NULL(시스템 발행)·author_name 'agenttalk-official'.
--    ON CONFLICT (slug) DO NOTHING — 사용자/마케팅 행 덮어쓰기 금지.
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
-- 3. sessions.title — 컬럼 재확인(006 존재 환경에서는 no-op) + 백필 2단.
--    기존 title(컬럼)를 덮어쓰지 않는다 — WHERE s.title IS NULL 봉인.
--    006의 빈문자열→NULL 트리거(BEFORE UPDATE OF title)가 여기서도 동일 적용된다.
--    인덱스 추가 없음: 목록 정렬은 idx_sessions_activity(last_activity_at)/
--    idx_sessions_user가 이미 커버(001) — 제목은 필터·정렬 키로 쓰이지 않는다.
-- ------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title TEXT;

-- 3a. metadata.title 보유 세션 (006 이후 생성된 포크 등 누락분 — 006 §1 규칙 유지)
UPDATE sessions
   SET title = btrim(metadata->>'title')
 WHERE title IS NULL
   AND metadata ? 'title'
   AND btrim(coalesce(metadata->>'title', '')) <> '';

-- 3b. 제목 없는 세션에 첫 사용자 메시지 요약 (t_cc52fd4f ③ 신규 규칙).
--     src/lib/sessionTitle.ts:deriveSessionTitle와 1:1:
--       ① 개행 전 첫 행 ② 공백 연속 한 칸 접기·trim ③ 50자 초과 시 left(49)||'…'
--     (PG length/left는 코드포인트 단위 — TS의 스프레드 문자열과 동일 기준)
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

COMMIT;

-- ============================================================
-- 검증 쿼리 (실행 후 read-back — 주석 해제하고 수행)
-- ============================================================
-- SELECT slug, category, status FROM neurons ORDER BY created_at;      -- 5종 active 기대 (core 4 + translation custom)
-- SELECT slug, status, author_name FROM skills ORDER BY created_at;    -- calendar-sync/email-assistant/translation-neuron/data-analysis 4종 published / 'agenttalk-official'
-- SELECT count(*) FROM sessions WHERE title IS NULL;                    -- 첫 메시지도 metadata 제목도 없는 세션만 NULL
-- SELECT count(*) FROM messages m JOIN sessions s ON s.id=m.session_id
--   WHERE m.role='user' AND s.title IS NULL;                            -- 0 기대 (user 메시지 있는 세션은 전부 제목)
-- 재실행: 전부 no-op (DO NOTHING / WHERE title IS NULL 가드) — 멱등.
-- ============================================================
