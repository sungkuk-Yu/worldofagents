-- ============================================================
-- 에이전트톡(AgentTalk) 테스트 시드 데이터
-- 작성일: 2026-09-25
-- 용도: 개발/스테이징 환경 테스트용
-- 주의: 프로덕션에서 실행 금지
-- ============================================================

-- ============================================================
-- 1. 테스트 사용자
--    실제 Supabase auth.users에 이미 존재한다고 가정하고,
--    users 프로필만 INSERT (auth.users.id는 UUID 고정값 사용)
-- ============================================================

-- 테스트 사용자 ID (개발 편의상 고정 UUID 사용)
-- 실제 환경에서는 Supabase Auth를 통해 생성됨
DO $$
DECLARE
    user_minji UUID := 'a1111111-1111-4111-8111-111111111111';
    user_cheolsu UUID := 'b2222222-2222-4222-8222-222222222222';
    user_dev UUID := 'c3333333-3333-4333-8333-333333333333';

    agent_shadow UUID;
    agent_assistant UUID;
    agent_dev_custom UUID;
    agent_en UUID;

    persona_minji_shadow UUID;
    persona_cheolsu_assistant UUID;

    session_1 UUID;
    session_2 UUID;

    neuron_empathy UUID;
    neuron_answer UUID;
    neuron_queue UUID;
    neuron_visual UUID;
    neuron_translation UUID;

    skill_calendar UUID;
    skill_email UUID;
    skill_translation UUID;
BEGIN

-- users 프로필 (auth.users에 해당 ID가 존재해야 함 — 로컬 개발시 수동 생성 필요)
INSERT INTO users (id, display_name, avatar_url, phone, timezone, language, preferences, profile)
VALUES
    (user_minji, '김민지', 'https://api.agenttalk.io/avatars/minji.png', '010-1234-5678', 'Asia/Seoul', 'ko',
     '{"theme": "dark", "notifications": {"push": true, "email": false}}'::jsonb,
     '{"mbti": "ENFJ", "interests": ["프로덕트 매니지먼트", "UX 리서치"]}'::jsonb),

    (user_cheolsu, '박철수', 'https://api.agenttalk.io/avatars/cheolsu.png', '010-9876-5432', 'Asia/Seoul', 'ko',
     '{"theme": "light", "notifications": {"push": true, "email": true}}'::jsonb,
     '{"mbti": "ISTJ", "interests": ["백엔드 개발", "인프라"]}'::jsonb),

    (user_dev, '이개발', 'https://api.agenttalk.io/avatars/dev.png', '010-5555-6666', 'Asia/Seoul', 'ko',
     '{"theme": "dark", "developer_mode": true}'::jsonb,
     '{"mbti": "INTP", "interests": ["AI", "뉴런 개발"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    updated_at = now();

-- ============================================================
-- 2. 기본 뉴런 4종 등록 (core)
-- ============================================================

INSERT INTO neurons (name, slug, description, category, version, author, capabilities, trigger_conditions, resource_requirements, status, always_active)
VALUES
    ('공감 에이뉴런', 'empathy',
     '사용자 입력을 즉시 인지하고 공감 반응을 생성. 상시 활성.',
     'core', '1.0.0', 'agenttalk',
     ARRAY['empathy_response', 'active_listening', 'acknowledgment'],
     ARRAY['any_user_input'],
     '{"cpu": "0.3", "memory": "128MB", "gpu": false, "model": "gpt-4o-mini"}'::jsonb,
     'active', TRUE),

    ('답변생성 에이뉴런', 'answer',
     '사용자 요청에 대한 실질적 답변 생성. 스트리밍 출력.',
     'core', '1.0.0', 'agenttalk',
     ARRAY['answer_generation', 'research', 'summarization', 'writing'],
     ARRAY['question_detected', 'request_detected'],
     '{"cpu": "1.0", "memory": "512MB", "gpu": false, "model": "gpt-4o"}'::jsonb,
     'active', FALSE),

    ('큐 에이뉴런', 'queue',
     '끼어든 입력의 성격 판별 — 병합 또는 큐잉.',
     'core', '1.0.0', 'agenttalk',
     ARRAY['intent_classification', 'merge_decision', 'queue_management'],
     ARRAY['active_task_exists', 'user_interruption'],
     '{"cpu": "0.2", "memory": "128MB", "gpu": false, "model": "gpt-4o-mini"}'::jsonb,
     'active', FALSE),

    ('비주얼 에이뉴런', 'visual',
     '표, 차트, 인포그래픽 등 시각 산출물 생성.',
     'core', '1.0.0', 'agenttalk',
     ARRAY['chart_generation', 'infographic', 'table_rendering', 'svg_output'],
     ARRAY['visual_output_needed', 'chart_request', 'data_visualization'],
     '{"cpu": "1.0", "memory": "1GB", "gpu": false, "model": "gpt-4o"}'::jsonb,
     'active', FALSE)
ON CONFLICT (slug) DO UPDATE SET
    description = EXCLUDED.description,
    capabilities = EXCLUDED.capabilities,
    updated_at = now();

-- 커스텀 뉴런 예시 (번역)
INSERT INTO neurons (name, slug, description, category, version, author, capabilities, trigger_conditions, status, persona_compatible)
VALUES
    ('번역 에이뉴런', 'translation',
     '다국어 입력 감지 시 실시간 번역 제공.',
     'custom', '1.0.0', 'agenttalk-official',
     ARRAY['translation', 'language_detection'],
     ARRAY['multilingual_input', 'explicit_translation_request'],
     'active', TRUE)
ON CONFLICT (slug) DO UPDATE SET
    description = EXCLUDED.description,
    updated_at = now();

-- 변수에 뉴런 ID 저장
SELECT id INTO neuron_empathy FROM neurons WHERE slug = 'empathy';
SELECT id INTO neuron_answer FROM neurons WHERE slug = 'answer';
SELECT id INTO neuron_queue FROM neurons WHERE slug = 'queue';
SELECT id INTO neuron_visual FROM neurons WHERE slug = 'visual';
SELECT id INTO neuron_translation FROM neurons WHERE slug = 'translation';

-- 사용량 집계 더미
UPDATE neurons SET
    usage_count = 1247, success_count = 1180, failure_count = 12,
    satisfaction_sum = 4200, satisfaction_count = 900
WHERE slug = 'empathy';

UPDATE neurons SET
    usage_count = 982, success_count = 890, failure_count = 28,
    satisfaction_sum = 3850, satisfaction_count = 820
WHERE slug = 'answer';

UPDATE neurons SET
    usage_count = 145, success_count = 130, failure_count = 5,
    satisfaction_sum = 520, satisfaction_count = 120
WHERE slug = 'queue';

UPDATE neurons SET
    usage_count = 412, success_count = 380, failure_count = 15,
    satisfaction_sum = 1680, satisfaction_count = 360
WHERE slug = 'visual';

-- ============================================================
-- 3. 에이전트 생성
-- ============================================================

INSERT INTO agents (owner_id, name, description, agent_type, config)
VALUES
    (user_minji, '민지의 그림자',
     '민지의 업무 스타일을 학습한 든든한 동료. 회의 준비, 이메일 작성, 자료 정리를 담당.',
     'shadow',
     '{"default_model": "gpt-4o", "max_tokens": 4096, "temperature": 0.7}'::jsonb)
RETURNING id INTO agent_shadow;

INSERT INTO agents (owner_id, name, description, agent_type, config)
VALUES
    (user_cheolsu, '철수 비서',
     '일정 관리와 코드 리뷰를 담당하는 꼼꼼한 비서.',
     'assistant',
     '{"default_model": "claude-sonnet", "max_tokens": 8192, "temperature": 0.5}'::jsonb)
RETURNING id INTO agent_assistant;

INSERT INTO agents (owner_id, name, description, agent_type, config)
VALUES
    (user_dev, '개발 도우미',
     '디버깅과 코드 생성에 특화된 커스텀 에이전트.',
     'custom',
     '{"default_model": "gpt-4o", "max_tokens": 8192, "temperature": 0.3}'::jsonb)
RETURNING id INTO agent_dev_custom;

-- ============================================================
-- 4. 페르소나 생성
-- ============================================================

INSERT INTO personas (agent_id, version, name, voice_config, tone_config, style_guide, neuron_overrides, relationship_type)
VALUES
    (agent_shadow, 1, '다온',
     '{"voice_id": "nova", "speed": 1.0, "pitch": 0, "language": "ko"}'::jsonb,
     '{"formality": "friendly", "emoji_usage": "rare", "sentence_length": "medium", "honorific_level": 3}'::jsonb,
     '{"personality_traits": ["MBTI: ENFJ", "따뜻함", "꼼꼼함", "유머 감각"],
       "preferred_expressions": ["~해볼게요!", "좋아요, 바로", "걱정 마세요"],
       "forbidden_expressions": ["못해요", "모르겠어요", "안 됩니다"],
       "example_responses": [
         {"user_input": "내일 회의 준비해줘", "agent_response": "네, 내일 회의 준비해볼게요! 어떤 자료부터 정리할까요?"},
         {"user_input": "좀 피곤하네", "agent_response": "오늘 고생 많았어요. 잠깐 쉬면서 물 한 잔 마셔요."}
       ]
     }'::jsonb,
     '{"empathy": {"warmth_delta": 0.2, "formality_delta": 0, "verbosity_delta": 0, "allowed_prefixes": ["아, ", "그렇군요, ", "네! "]},
       "answer": {"warmth_delta": 0, "formality_delta": 0.1, "verbosity_delta": 0.1, "allowed_prefixes": ["자, ", "다음은 ", "먼저 "]}}'::jsonb,
     'colleague')
RETURNING id INTO persona_minji_shadow;

INSERT INTO personas (agent_id, version, name, voice_config, tone_config, style_guide, neuron_overrides, relationship_type)
VALUES
-- 내 보좌관 캐릭터(t_80f0d396): quip_tone='adjutant' → 한국 영화 친근 quip 풀.
    (agent_assistant, 1, '세심',
     '{"voice_id": "alloy", "speed": 1.0, "pitch": 0, "language": "ko"}'::jsonb,
     '{"formality": "formal", "emoji_usage": "never", "sentence_length": "short", "honorific_level": 5, "quip_tone": "adjutant"}'::jsonb,
     '{"personality_traits": ["MBTI: ISTJ", "정확함", "간결함"],
       "preferred_expressions": ["확인했습니다", "진행하겠습니다"],
       "forbidden_expressions": ["아마", "글쎄", "~인 것 같다"]
     }'::jsonb,
     '{}'::jsonb,
     'secretary')
RETURNING id INTO persona_cheolsu_assistant;

INSERT INTO personas (agent_id, version, name, voice_config, tone_config, style_guide, relationship_type)
VALUES
-- 범용/신규 캐릭터(t_80f0d396): quip_tone='sf' → SF 집사 quip 풀.
    (agent_dev_custom, 1, '코디',
     '{"voice_id": "echo", "speed": 1.1, "pitch": 0, "language": "ko"}'::jsonb,
     '{"formality": "casual", "emoji_usage": "frequent", "sentence_length": "short", "honorific_level": 1, "quip_tone": "sf"}'::jsonb,
     '{"personality_traits": ["MBTI: INTP", "직설적", "기술적"],
       "preferred_expressions": ["이렇게 해봐", "버그 찾았어"],
       "forbidden_expressions": []
     }'::jsonb,
     'peer')
ON CONFLICT (agent_id, version) DO NOTHING;

-- ============================================================
-- 5. 세션 생성 (관계 기반 라우팅 — user_id + agent_id 유니크)
-- ============================================================

INSERT INTO sessions (user_id, agent_id, persona_id, status, stream_channel_id, metadata)
VALUES
    (user_minji, agent_shadow, persona_minji_shadow, 'active',
     'session:minji-shadow-001',
     '{"device": "ios", "app_version": "1.2.0"}'::jsonb)
RETURNING id INTO session_1;

INSERT INTO sessions (user_id, agent_id, persona_id, status, stream_channel_id, metadata)
VALUES
    (user_cheolsu, agent_assistant, persona_cheolsu_assistant, 'active',
     'session:cheolsu-assistant-001',
     '{"device": "android", "app_version": "1.2.0"}'::jsonb)
RETURNING id INTO session_2;

-- ============================================================
-- 6. 메시지 히스토리 (샘플 대화)
-- ============================================================

INSERT INTO messages (session_id, turn_index, role, message_type, content, source_neuron) VALUES
    -- 민지 ↔ 다온 세션
    (session_1, 1, 'user', 'voice',
     '내일 Q3 매출 회의 자료 좀 정리해줘',
     NULL),
    (session_1, 2, 'agent', 'text',
     'Q3 매출 자료 정리하시는구나, 내일 회의 준비하셔야겠어요. 바로 정리해드릴게요.',
     'empathy'),
    (session_1, 3, 'agent', 'text',
     'Q3 매출 자료를 부서별로 정리했어요. 아래 차트를 확인해주세요.',
     'answer'),
    (session_1, 4, 'agent', 'image',
     'Q3 부서별 매출 차트',
     'visual'),
    (session_1, 5, 'user', 'text',
     '아, 그리고 어제 받은 이메일 답장도 써줘',
     NULL),
    (session_1, 6, 'agent', 'text',
     '메일 답장은 매출 정리 끝나고 바로 이어서 할게요.',
     'queue'),
    (session_1, 7, 'agent', 'text',
     '어제 받은 이메일에 대한 답장 초안입니다: ...',
     'answer'),

    -- 철수 ↔ 세심 세션
    (session_2, 1, 'user', 'text',
     '오늘 오후 일정 정리해줘',
     NULL),
    (session_2, 2, 'agent', 'text',
     '확인했습니다. 오늘 오후 일정을 정리하겠습니다.',
     'empathy'),
    (session_2, 3, 'agent', 'text',
     '14:00 팀 주간 회의 (회의실 A)\n16:00 코드 리뷰 (PR #142)\n18:00 1:1 미팅 (팀장님)',
     'answer');

-- 메시지 피드백 샘플
UPDATE messages SET user_feedback = 'like'
WHERE session_id = session_1 AND turn_index = 3;

-- STT 메타데이터 샘플
UPDATE messages SET stt_metadata = '{
    "duration_ms": 2340,
    "confidence": 0.95,
    "language": "ko",
    "model": "whisper-v3-turbo"
}'::jsonb
WHERE session_id = session_1 AND turn_index = 1 AND role = 'user';

-- ============================================================
-- 7. 뉴런 인스턴스 및 연결 이력
-- ============================================================

-- 민지 세션의 활성 뉴런 인스턴스
INSERT INTO neuron_instances (session_id, neuron_id, status, activated_at, last_activity_at)
VALUES
    (session_1, neuron_empathy, 'active', now() - interval '2 hours', now() - interval '3 minutes'),
    (session_1, neuron_answer, 'idle', now() - interval '5 minutes', now() - interval '4 minutes'),
    (session_1, neuron_visual, 'idle', now() - interval '10 minutes', now() - interval '9 minutes');

-- 철수 세션의 활성 뉴런 인스턴스
INSERT INTO neuron_instances (session_id, neuron_id, status, activated_at, last_activity_at)
VALUES
    (session_2, neuron_empathy, 'active', now() - interval '1 hour', now() - interval '1 minute'),
    (session_2, neuron_answer, 'idle', now() - interval '3 minutes', now() - interval '2 minutes');

-- 뉴런 연결/해제 이력 샘플
INSERT INTO neuron_connections (session_id, neuron_id, event_type, prev_status, new_status, reason)
VALUES
    (session_1, neuron_empathy, 'activate', NULL, 'active', '세션 시작 시 상시 활성'),
    (session_1, neuron_answer, 'activate', 'idle', 'active', '사용자 질문 감지'),
    (session_1, neuron_answer, 'status_change', 'active', 'processing', '답변 생성 시작'),
    (session_1, neuron_visual, 'activate', 'idle', 'active', '시각 산출물 필요 판단'),
    (session_1, neuron_visual, 'status_change', 'active', 'processing', '차트 생성 시작'),
    (session_1, neuron_queue, 'activate', 'idle', 'active', '끼어들기 감지'),
    (session_1, neuron_queue, 'deactivate', 'active', 'idle', '큐 처리 완료'),
    (session_1, neuron_visual, 'status_change', 'processing', 'idle', '차트 생성 완료'),
    (session_1, neuron_answer, 'status_change', 'processing', 'idle', '이메일 답장 생성 완료');

-- ============================================================
-- 8. 작업 (Tasks) 샘플
-- ============================================================

INSERT INTO tasks (session_id, title, description, status, priority, task_type, assigned_neuron, input_data, result, started_at, completed_at)
VALUES
    (session_1, 'Q3 매출 보고서 작성', '부서별 Q3 매출 집계 및 시각화',
     'completed', 'high', 'research', 'answer',
     '{"department": "전사", "period": "2026-Q3"}'::jsonb,
     '{"chart_url": "https://storage.agenttalk.io/charts/q3-2026.png", "pages": 3}'::jsonb,
     now() - interval '2 hours', now() - interval '1 hour 55 minutes'),

    (session_1, '이메일 답장 작성', '어제 받은 협력사 이메일에 대한 답장 초안',
     'completed', 'normal', 'writing', 'answer',
     '{"sender": "협력사 김부장", "topic": "계약 갱신"}'::jsonb,
     '{"draft_length": 450, "tone": "formal"}'::jsonb,
     now() - interval '1 hour 50 minutes', now() - interval '1 hour 45 minutes'),

    (session_2, 'PR #142 코드 리뷰', '인증 모듈 리팩토링 PR 리뷰',
     'in_progress', 'normal', 'review', 'answer',
     '{"pr_number": 142, "repo": "backend"}'::jsonb,
     NULL,
     now() - interval '30 minutes', NULL);

-- 작업 로그 샘플
INSERT INTO task_logs (task_id, log_type, message, source_neuron)
SELECT id, 'status_change', '작업 시작됨', 'answer'
FROM tasks WHERE title = 'PR #142 코드 리뷰';

INSERT INTO task_logs (task_id, log_type, message, metadata, source_neuron)
SELECT id, 'progress', '파일 12개 중 5개 분석 완료', '{"progress": 0.42}'::jsonb, 'answer'
FROM tasks WHERE title = 'PR #142 코드 리뷰';

-- ============================================================
-- 9. 원본 트랜스크립트 + 압축 기억 (2단계 구조)
-- ============================================================

INSERT INTO raw_transcripts (session_id, batch_id, turn_range, content, is_compacted, created_at)
VALUES
    (session_1, 1, '[1,7)'::int4range,
     '[
       {"turn": 1, "role": "user", "text": "내일 Q3 매출 회의 자료 좀 정리해줘"},
       {"turn": 2, "role": "agent", "text": "Q3 매출 자료 정리하시는구나, 내일 회의 준비하셔야겠어요. 바로 정리해드릴게요."},
       {"turn": 3, "role": "agent", "text": "Q3 매출 자료를 부서별로 정리했어요."},
       {"turn": 4, "role": "agent", "text": "[Q3 부서별 매출 차트]"},
       {"turn": 5, "role": "user", "text": "아, 그리고 어제 받은 이메일 답장도 써줘"},
       {"turn": 6, "role": "agent", "text": "메일 답장은 매출 정리 끝나고 바로 이어서 할게요."},
       {"turn": 7, "role": "agent", "text": "어제 받은 이메일에 대한 답장 초안입니다."}
     ]'::jsonb,
     TRUE, now() - interval '1 hour');

INSERT INTO compressed_memories (session_id, source_batch_id, summary, tags, importance_score, compaction_criteria, source_turn_range)
VALUES
    (session_1, 1,
     '민지는 2026-09-25에 Q3 매출 회의 자료 정리(부서별 집계+시각화)와 협력사 김부장의 계약 갱신 이메일 답장 작성을 요청했으며, 둘 다 정상 완료됨. 시각 자료와 업무 자동 처리에 만족하는 경향.',
     ARRAY['Q3매출', '회의준비', '이메일답장', '협력사', '계약갱신'],
     0.85,
     '["핵심 결정사항", "사용자 선호도", "미완료 작업", "중요 맥락"]'::jsonb,
     '[1,7)'::int4range);

-- ============================================================
-- 10. 스킬 마켓 샘플
-- ============================================================

INSERT INTO skills (name, slug, description, category, version, author_id, author_name, content, price, status, install_count, usage_count, satisfaction_sum, satisfaction_count)
VALUES
    ('캘린더 동기화', 'calendar-sync',
     'Google Calendar, Outlook 캘린더를 에이전트와 자동 동기화. 일정 추천 및 충돌 감지.',
     'productivity', '2.1.0', user_dev, '이개발',
     '{"integration": "google_calendar,outlook", "sync_interval_min": 5, "scopes": ["calendar.read", "calendar.write"]}'::jsonb,
     0, 'published', 842, 12450, 3950, 820),

    ('이메일 어시스턴트', 'email-assistant',
     'Gmail/Outlook 이메일 자동 분류, 우선순위 설정, 답장 초안 생성.',
     'communication', '1.5.2', user_dev, '이개발',
     '{"providers": ["gmail", "outlook"], "auto_classify": true, "draft_style": "matching_persona"}'::jsonb,
     5000, 'published', 312, 4580, 1420, 295),

    ('실시간 번역 뉴런', 'translation-neuron',
     '다국어 대화 실시간 번역. 뉴런으로 등록되어 자동 활성화.',
     'neuron', '1.0.0', user_dev, '이개발',
     '{"neuron_slug": "translation", "supported_languages": 50, "model": "nllb-200-distilled-600M"}'::jsonb,
     0, 'published', 180, 2100, 780, 165),

    ('데이터 분석', 'data-analysis',
     'CSV/Excel 파일 업로드 시 자동 분석 및 인사이트 도출.',
     'analysis', '1.2.0', user_dev, '이개발',
     '{"supported_formats": ["csv", "xlsx"], "max_size_mb": 100, "auto_chart": true}'::jsonb,
     10000, 'pending_review', 0, 0, 0, 0)
RETURNING id INTO skill_calendar;

-- 변수 할당을 위한 별도 SELECT
SELECT id INTO skill_calendar FROM skills WHERE slug = 'calendar-sync';
SELECT id INTO skill_email FROM skills WHERE slug = 'email-assistant';
SELECT id INTO skill_translation FROM skills WHERE slug = 'translation-neuron';

-- ============================================================
-- 11. 스킬 설치 기록
-- ============================================================

INSERT INTO skill_installations (user_id, skill_id, agent_id, installed_version)
SELECT user_minji, id, agent_shadow, '2.1.0'
FROM skills WHERE slug = 'calendar-sync'
ON CONFLICT (user_id, skill_id) DO NOTHING;

INSERT INTO skill_installations (user_id, skill_id, agent_id, installed_version)
SELECT user_minji, id, agent_shadow, '1.5.2'
FROM skills WHERE slug = 'email-assistant'
ON CONFLICT (user_id, skill_id) DO NOTHING;

INSERT INTO skill_installations (user_id, skill_id, agent_id, installed_version)
SELECT user_cheolsu, id, agent_assistant, '2.1.0'
FROM skills WHERE slug = 'calendar-sync'
ON CONFLICT (user_id, skill_id) DO NOTHING;

-- ============================================================
-- 12. 컨텍스트 패치 샘플
-- ============================================================

INSERT INTO context_patches (session_id, key, operation, delta, source_neuron) VALUES
    (session_1, 'conversation.summary', 'append',
     '{"text": "사용자는 Q3 매출 회의 자료와 이메일 답장을 요청했으며 성공적으로 완료."}'::jsonb,
     'system.compaction'),
    (session_1, 'user.preferences', 'set',
     '{"visual_preference": "chart", "response_length": "medium"}'::jsonb,
     'system.learning'),
    (session_1, 'persona.state', 'set',
     '{"last_emotion": "satisfied", "rapport_level": 0.75}'::jsonb,
     'empathy'),
    (session_2, 'conversation.summary', 'set',
     '{"text": "철수는 일정 관리와 코드 리뷰 위주로 사용."}'::jsonb,
     'system.compaction');

-- 영어 프리셋: 기존 JSON 확장 지점에 로케일과 시스템 프롬프트를 저장한다.
-- 내 변호사 캐릭터(t_80f0d396): tone_config.quip_tone='noir' → 탐정 누아르 전용 quip 풀 사용.
INSERT INTO agents (owner_id, name, description, agent_type, config)
VALUES (user_dev, 'Legal Guide', 'An English legal information assistant', 'custom',
        '{"locale":"en","category":"legal"}'::jsonb)
RETURNING id INTO agent_en;
INSERT INTO personas (agent_id, version, name, voice_config, tone_config, style_guide, relationship_type)
VALUES (agent_en, 1, 'Legal Guide', '{"language":"en"}'::jsonb,
        '{"formality":"formal","emoji_usage":"never","sentence_length":"medium","quip_tone":"noir"}'::jsonb,
        '{"system_prompt":"You are Legal Guide. Explain legal concepts clearly and suggest consulting a qualified lawyer for individual advice.","personality_traits":["careful","clear"],"preferred_expressions":["Here is an overview"],"forbidden_expressions":[],"example_responses":[{"user_input":"What is a contract?","agent_response":"A contract is an agreement that creates enforceable obligations."}]}'::jsonb,
        'assistant');

END $$;

-- ============================================================
-- 검증 쿼리 (시드 후 확인용 — 실행하지 않고 주석 처리)
-- ============================================================
-- SELECT 'users' AS tbl, COUNT(*) FROM users
-- UNION ALL SELECT 'agents', COUNT(*) FROM agents
-- UNION ALL SELECT 'personas', COUNT(*) FROM personas
-- UNION ALL SELECT 'neurons', COUNT(*) FROM neurons
-- UNION ALL SELECT 'sessions', COUNT(*) FROM sessions
-- UNION ALL SELECT 'messages', COUNT(*) FROM messages
-- UNION ALL SELECT 'tasks', COUNT(*) FROM tasks
-- UNION ALL SELECT 'skills', COUNT(*) FROM skills
-- UNION ALL SELECT 'skill_installations', COUNT(*) FROM skill_installations;
--
-- -- 랭킹 뷰 확인
-- SELECT name, slug, composite_score FROM neuron_ranking LIMIT 5;
-- SELECT name, slug, composite_score FROM skill_rankings LIMIT 5;
