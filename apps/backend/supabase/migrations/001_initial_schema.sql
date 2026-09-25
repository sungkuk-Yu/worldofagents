-- ============================================================
-- 에이전트톡(AgentTalk) 초기 스키마 마이그레이션
-- 버전: 001
-- 작성일: 2026-09-25
-- 기반: neuron-architecture-spec.md §9 데이터 모델
-- 기술스택: Supabase (Postgres 15+)
-- ============================================================

-- 확장 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. 사용자 프로필 (Supabase auth.users 확장)
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    avatar_url TEXT,
    phone TEXT,
    timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
    language TEXT NOT NULL DEFAULT 'ko',
    preferences JSONB NOT NULL DEFAULT '{}',
    -- MBTI, 관심사 등 사용자 특성 (페르소나 매칭용)
    profile JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS '사용자 프로필 — auth.users와 1:1 매핑';

-- ============================================================
-- 2. 에이전트 (그림자 에이전트)
-- ============================================================
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    avatar_url TEXT,
    agent_type TEXT NOT NULL DEFAULT 'shadow'
        CHECK (agent_type IN ('shadow', 'assistant', 'custom')),
    -- 에이전트 전체 설정 (모델, 온도, 최대 토큰 등)
    config JSONB NOT NULL DEFAULT '{}',
    -- 활성화 여부
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agents IS '에이전트 마스터 — 사용자 1명당 여러 에이전트 보유 가능';
CREATE INDEX idx_agents_owner ON agents(owner_id);

-- ============================================================
-- 3. 페르소나 설정 (통합 페르소나 유지 — §4)
-- ============================================================
CREATE TABLE personas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    -- 목소리 설정 (TTS용: voice_id, speed, pitch, language)
    voice_config JSONB NOT NULL DEFAULT '{}',
    -- 말투 규칙 (formality, emoji_usage, sentence_length, honorific_level)
    tone_config JSONB NOT NULL DEFAULT '{}',
    -- 스타일 가이드 (예시 응답, 금지/선호 표현, MBTI 등 성격 특성)
    style_guide JSONB NOT NULL DEFAULT '{}',
    -- 뉴런별 톤 오버라이드 (warmth_delta, formality_delta 등)
    neuron_overrides JSONB NOT NULL DEFAULT '{}',
    -- 관계 설정 (친구, 비서, 동료 등)
    relationship_type TEXT NOT NULL DEFAULT 'assistant',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_id, version)
);

COMMENT ON TABLE personas IS '에이전트 통합 페르소나 — 모든 뉴런이 동일한 페르소나를 따름 (§4 단일 인격 제약)';
CREATE INDEX idx_personas_agent ON personas(agent_id) WHERE is_active = TRUE;

-- ============================================================
-- 4. 세션 (관계 기반 라우팅 — 백서 §4.0)
-- ============================================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    persona_id UUID NOT NULL REFERENCES personas(id),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'archived')),
    -- Stream Chat 채널 ID (1:1 매핑)
    stream_channel_id TEXT,
    -- 세션 메타데이터 (디바이스, 채널 정보 등)
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- ★ 관계 기반 세션 라우팅: user_id + agent_id 복합 유니크 키
    UNIQUE (user_id, agent_id)
);

COMMENT ON TABLE sessions IS '세션 마스터 — (user_id, agent_id) 관계 단위로 식별 (백서 §4.0)';
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE status = 'active';
CREATE INDEX idx_sessions_agent ON sessions(agent_id) WHERE status = 'active';
CREATE INDEX idx_sessions_activity ON sessions(last_activity_at DESC);

-- ============================================================
-- 5. 뉴런 유형 레지스트리 (기본 4종 + 커스텀 — §2, §7)
-- ============================================================
CREATE TABLE neurons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,  -- 'empathy', 'answer', 'queue', 'visual', 'custom_*'
    description TEXT,
    category TEXT NOT NULL DEFAULT 'core'
        CHECK (category IN ('core', 'custom', 'experimental')),
    version TEXT NOT NULL DEFAULT '1.0.0',
    author TEXT NOT NULL DEFAULT 'agenttalk',
    -- 뉴런 기능 목록
    capabilities TEXT[] NOT NULL DEFAULT '{}',
    -- 활성화 트리거 조건
    trigger_conditions TEXT[] NOT NULL DEFAULT '{}',
    -- 리소스 요구사항 (cpu, memory, gpu, model)
    resource_requirements JSONB NOT NULL DEFAULT '{}',
    -- 의존성 (다른 뉴런 또는 스킬)
    dependencies TEXT[] NOT NULL DEFAULT '{}',
    -- 통합 페르소나 준수 여부 (필수)
    persona_compatible BOOLEAN NOT NULL DEFAULT TRUE,
    -- 상태: pending(심사중), active(활성), deprecated(단축예정), blocked(차단)
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'deprecated', 'blocked')),
    -- 항상 활성 여부 (공감 뉴런만 TRUE)
    always_active BOOLEAN NOT NULL DEFAULT FALSE,
    -- 백서 §1.3 다신호 랭킹용 집계
    usage_count BIGINT NOT NULL DEFAULT 0,
    success_count BIGINT NOT NULL DEFAULT 0,
    failure_count BIGINT NOT NULL DEFAULT 0,
    satisfaction_sum INTEGER NOT NULL DEFAULT 0,
    satisfaction_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE neurons IS '뉴런 유형 레지스트리 — 기본 4종(empathy/answer/queue/visual) + 커스텀 (§2, §7)';
CREATE INDEX idx_neurons_status ON neurons(status) WHERE status = 'active';
CREATE INDEX idx_neurons_category ON neurons(category);

-- ============================================================
-- 6. 뉴런 인스턴스 (세션별 활성 뉴런 — §3)
-- ============================================================
CREATE TABLE neuron_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    neuron_id UUID NOT NULL REFERENCES neurons(id),
    -- 상태 머신: idle → active → processing → degraded (§2.2)
    status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'active', 'processing', 'degraded')),
    -- 인스턴스별 설정 오버라이드
    config JSONB NOT NULL DEFAULT '{}',
    activated_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE neuron_instances IS '세션 내 활성 뉴런 인스턴스 — 상태 추적 및 리소스 관리';
CREATE INDEX idx_neuron_instances_session ON neuron_instances(session_id);
CREATE INDEX idx_neuron_instances_status ON neuron_instances(session_id, status);

-- ============================================================
-- 7. 뉴런 연결/해제 이력 (동적 연결 프로토콜 — §3)
-- ============================================================
CREATE TABLE neuron_connections (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_neuron_instance_id UUID REFERENCES neuron_instances(id),
    target_neuron_instance_id UUID REFERENCES neuron_instances(id),
    neuron_id UUID NOT NULL REFERENCES neurons(id),
    -- 이벤트 유형
    event_type TEXT NOT NULL
        CHECK (event_type IN (
            'activate', 'deactivate', 'connect', 'disconnect',
            'error', 'status_change'
        )),
    -- 이벤트 발생 전/후 상태
    prev_status TEXT,
    new_status TEXT,
    -- 추가 정보 (에러 메시지, 비활성화 사유 등)
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE neuron_connections IS '뉴런 연결/해제 이벤트 이력 — append-only, 동적 연결 프로토콜 감사 추적 (§3)';
CREATE INDEX idx_neuron_connections_session ON neuron_connections(session_id, created_at DESC);
CREATE INDEX idx_neuron_connections_neuron ON neuron_connections(neuron_id, created_at DESC);

-- ============================================================
-- 8. 메시지 (Stream Chat과 동기화되는 메시지 로그)
-- ============================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    -- Stream Chat 메시지 ID (외부 동기화용)
    stream_message_id TEXT,
    -- 턴 번호 (시퀀스)
    turn_index INTEGER NOT NULL,
    -- 발화자: user(사용자), agent(에이전트), system(시스템)
    role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
    -- 메시지 유형
    message_type TEXT NOT NULL DEFAULT 'text'
        CHECK (message_type IN ('text', 'voice', 'image', 'file', 'card', 'system')),
    content TEXT NOT NULL,
    -- STT 메타데이터 (음성 입력인 경우)
    stt_metadata JSONB,
    -- 어떤 뉴런이 이 응답을 생성했는지
    source_neuron TEXT,
    -- 첨부 파일 URL 목록
    attachments JSONB NOT NULL DEFAULT '[]',
    -- 페르소나 가드 검증 결과
    persona_guard JSONB NOT NULL DEFAULT '{}',
    -- 사용자 피드백 (좋아요/싫어요)
    user_feedback TEXT CHECK (user_feedback IN ('like', 'dislike')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, turn_index)
);

COMMENT ON TABLE messages IS '대화 메시지 로그 — Stream Chat과 양방향 동기화';
CREATE INDEX idx_messages_session ON messages(session_id, turn_index);
CREATE INDEX idx_messages_role ON messages(session_id, role);
CREATE INDEX idx_messages_created ON messages(created_at DESC);

-- ============================================================
-- 9. 원본 트랜스크립트 (기억 압축 1단계 — 백서 §4.5)
-- ============================================================
CREATE TABLE raw_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    -- 압축 배치 번호 (여러 턴을 하나로 묶어 압축)
    batch_id INTEGER NOT NULL,
    -- 원본 턴 범위 [시작, 끝)
    turn_range INT4RANGE NOT NULL,
    -- 원본 대화 전체 (JSON 배열)
    content JSONB NOT NULL,
    -- 압축 여부
    is_compacted BOOLEAN NOT NULL DEFAULT FALSE,
    compacted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE raw_transcripts IS '원본 대화 보존 — 압축 후에도 원본 유지 (백서 §4.5 1단계)';
CREATE INDEX idx_raw_transcripts_session ON raw_transcripts(session_id, batch_id);

-- ============================================================
-- 10. 압축 기억 (기억 압축 2단계 — 백서 §4.5)
-- ============================================================
CREATE TABLE compressed_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    -- 원본 배치 참조
    source_batch_id INTEGER NOT NULL,
    -- 압축 요약 텍스트
    summary TEXT NOT NULL,
    -- 핵심 키워드/태그 (검색용)
    tags TEXT[] NOT NULL DEFAULT '{}',
    -- 중요도 점수 (0.0 ~ 1.0)
    importance_score REAL NOT NULL DEFAULT 0.5,
    -- 압축 기준 (결정사항, 선호도, 미완료작업, 중요맥락)
    compaction_criteria JSONB NOT NULL DEFAULT '[]',
    -- 원본 턴 범위
    source_turn_range INT4RANGE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE compressed_memories IS '압축된 장기 기억 — 2단계 메모리 구조 (백서 §4.5 2단계)';
CREATE INDEX idx_compressed_memories_session ON compressed_memories(session_id, importance_score DESC);
CREATE INDEX idx_compressed_memories_tags ON compressed_memories USING GIN(tags);

-- ============================================================
-- 11. 작업 (Tasks — 에이전트가 수행하는 장기 작업)
-- ============================================================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    -- Temporal.io 워크플로우 ID (외부 추적용)
    temporal_workflow_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    -- 상태: pending → in_progress → completed / blocked / cancelled
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'cancelled')),
    -- 우선순위
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    -- 담당 뉴런
    assigned_neuron TEXT,
    -- 작업 유형 (answer, visual, research, translation 등)
    task_type TEXT NOT NULL DEFAULT 'general',
    -- 입력/출력 데이터
    input_data JSONB NOT NULL DEFAULT '{}',
    result JSONB,
    -- 타임라인
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tasks IS '에이전트 작업 — Temporal.io 워크플로우와 연동 (§5.3)';
CREATE INDEX idx_tasks_session ON tasks(session_id, status);
CREATE INDEX idx_tasks_status ON tasks(status) WHERE status IN ('pending', 'in_progress');
CREATE INDEX idx_tasks_temporal ON tasks(temporal_workflow_id) WHERE temporal_workflow_id IS NOT NULL;

-- ============================================================
-- 12. 작업 로그 (작업 수행 이력)
-- ============================================================
CREATE TABLE task_logs (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    -- 로그 유형
    log_type TEXT NOT NULL
        CHECK (log_type IN ('status_change', 'progress', 'error', 'retry', 'output', 'system')),
    -- 로그 내용
    message TEXT NOT NULL,
    -- 추가 데이터
    metadata JSONB NOT NULL DEFAULT '{}',
    -- 어떤 뉴런이 이 로그를 생성했는지
    source_neuron TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE task_logs IS '작업 수행 로그 — append-only, 감사 추적 및 디버깅용';
CREATE INDEX idx_task_logs_task ON task_logs(task_id, created_at DESC);
CREATE INDEX idx_task_logs_type ON task_logs(task_id, log_type);

-- ============================================================
-- 13. 스킬 (스킬 마켓 — 백서 §1.3)
-- ============================================================
CREATE TABLE skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'general'
        CHECK (category IN ('general', 'productivity', 'creative', 'analysis', 'communication', 'neuron')),
    version TEXT NOT NULL DEFAULT '1.0.0',
    author_id UUID REFERENCES users(id),
    author_name TEXT NOT NULL,
    -- 스킬 내용 (프롬프트, 코드, 설정 등)
    content JSONB NOT NULL DEFAULT '{}',
    -- 아이콘/썸네일
    icon_url TEXT,
    -- 가격 (0 = 무료)
    price INTEGER NOT NULL DEFAULT 0,
    -- 상태: draft → pending_review → published → deprecated → blocked
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_review', 'published', 'deprecated', 'blocked')),
    -- 보안 심사 결과
    security_scan JSONB NOT NULL DEFAULT '{}',
    -- 설치 수
    install_count BIGINT NOT NULL DEFAULT 0,
    -- 다신호 랭킹용
    usage_count BIGINT NOT NULL DEFAULT 0,
    satisfaction_sum INTEGER NOT NULL DEFAULT 0,
    satisfaction_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE skills IS '스킬 마켓 — 뉴런 포함 모든 스킬 등록/배포 (§7, 백서 §1.3)';
CREATE INDEX idx_skills_status ON skills(status) WHERE status = 'published';
CREATE INDEX idx_skills_category ON skills(category, status);
CREATE INDEX idx_skills_author ON skills(author_id);

-- ============================================================
-- 14. 스킬 설치 (사용자별 스킬 설치 기록)
-- ============================================================
CREATE TABLE skill_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    installed_version TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, skill_id)
);

COMMENT ON TABLE skill_installations IS '사용자별 스킬 설치 기록';
CREATE INDEX idx_skill_installations_user ON skill_installations(user_id);

-- ============================================================
-- 15. 스킬 랭킹 (다신호 검증 — 백서 §1.3)
-- ============================================================
CREATE OR REPLACE VIEW skill_rankings AS
SELECT
    s.id,
    s.name,
    s.slug,
    s.description,
    s.category,
    s.version,
    s.author_name,
    s.icon_url,
    s.price,
    s.install_count,
    -- 성공률 (스킬 실행 성공/실패 집계 — neurons 테이블과 별도)
    s.usage_count,
    -- 만족도 (좋아요/싫어요, 1~5점 평균)
    CASE WHEN s.satisfaction_count > 0
        THEN s.satisfaction_sum::REAL / s.satisfaction_count
        ELSE 0
    END AS satisfaction_score,
    -- 종합 점수 (가중치: 만족도 40%, 설치수 30%, 사용빈도 30%)
    (
        CASE WHEN s.satisfaction_count > 0
            THEN s.satisfaction_sum::REAL / s.satisfaction_count / 5.0
            ELSE 0
        END * 0.4 +
        LEAST(s.install_count::REAL / 1000.0, 1.0) * 0.3 +
        LEAST(s.usage_count::REAL / 5000.0, 1.0) * 0.3
    ) AS composite_score,
    s.created_at,
    s.updated_at
FROM skills s
WHERE s.status = 'published'
ORDER BY composite_score DESC;

COMMENT ON VIEW skill_rankings IS '스킬 랭킹 뷰 — 만족도 40% + 설치수 30% + 사용빈도 30% (백서 §1.3 다신호 랭킹)';

-- ============================================================
-- 16. 뉴런 랭킹 뷰
-- ============================================================
CREATE OR REPLACE VIEW neuron_ranking AS
SELECT
    id,
    name,
    slug,
    description,
    category,
    -- 성공률
    CASE WHEN (success_count + failure_count) > 0
        THEN success_count::REAL / (success_count + failure_count)
        ELSE 0
    END AS success_rate,
    -- 만족도
    CASE WHEN satisfaction_count > 0
        THEN satisfaction_sum::REAL / satisfaction_count
        ELSE 0
    END AS satisfaction_score,
    usage_count,
    -- 종합 점수 (성공률 40%, 만족도 35%, 사용빈도 25%)
    (
        CASE WHEN (success_count + failure_count) > 0
            THEN success_count::REAL / (success_count + failure_count)
            ELSE 0
        END * 0.4 +
        CASE WHEN satisfaction_count > 0
            THEN satisfaction_sum::REAL / satisfaction_count / 5.0
            ELSE 0
        END * 0.35 +
        LEAST(usage_count::REAL / 1000.0, 1.0) * 0.25
    ) AS composite_score
FROM neurons
WHERE status = 'active'
ORDER BY composite_score DESC;

-- ============================================================
-- 17. 컨텍스트 패치 (뉴런 간 컨텍스트 동기화 — §6)
-- ============================================================
CREATE TABLE context_patches (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    -- 컨텍스트 키 (conversation.recent, task.current 등 — §6.4)
    key TEXT NOT NULL,
    -- 연산: set, append, replace, delete
    operation TEXT NOT NULL
        CHECK (operation IN ('set', 'append', 'replace', 'delete')),
    -- 변경 데이터
    delta JSONB NOT NULL,
    -- 변경 주체 뉴런
    source_neuron TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE context_patches IS '컨텍스트 변경 이력 — append-only, 뉴런 간 동기화 (§6)';
CREATE INDEX idx_context_patches_session_key ON context_patches(session_id, key, created_at DESC);

-- ============================================================
-- 18. RLS (Row Level Security) 정책
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compressed_memories ENABLE ROW LEVEL SECURITY;

-- 사용자: 본인 데이터만 접근
CREATE POLICY "users_self" ON users
    FOR ALL USING (id = auth.uid());

-- 에이전트: 소유자만 접근
CREATE POLICY "agents_owner" ON agents
    FOR ALL USING (owner_id = auth.uid());

-- 페르소나: 에이전트 소유자만 접근
CREATE POLICY "personas_via_agent" ON personas
    FOR ALL USING (
        agent_id IN (SELECT id FROM agents WHERE owner_id = auth.uid())
    );

-- 세션: 본인 세션만 접근
CREATE POLICY "sessions_self" ON sessions
    FOR ALL USING (user_id = auth.uid());

-- 메시지: 본인 세션의 메시지만 접근
CREATE POLICY "messages_via_session" ON messages
    FOR ALL USING (
        session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
    );

-- 작업: 본인 세션의 작업만 접근
CREATE POLICY "tasks_via_session" ON tasks
    FOR ALL USING (
        session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
    );

-- 작업 로그: 본인 세션의 로그만 접근
CREATE POLICY "task_logs_via_task" ON task_logs
    FOR ALL USING (
        task_id IN (
            SELECT t.id FROM tasks t
            JOIN sessions s ON t.session_id = s.id
            WHERE s.user_id = auth.uid()
        )
    );

-- 원본 트랜스크립트: 본인 세션만
CREATE POLICY "transcripts_via_session" ON raw_transcripts
    FOR ALL USING (
        session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
    );

-- 압축 기억: 본인 세션만
CREATE POLICY "memories_via_session" ON compressed_memories
    FOR ALL USING (
        session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
    );

-- ============================================================
-- 19. 자동 updated_at 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_neurons_updated BEFORE UPDATE ON neurons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_skills_updated BEFORE UPDATE ON skills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 20. 세션 활동 시간 자동 갱신 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION update_session_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE sessions SET last_activity_at = now()
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_session_activity
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION update_session_activity();

CREATE TRIGGER trg_tasks_session_activity
    AFTER INSERT OR UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_session_activity();

-- ============================================================
-- 21. 기억 압축 자동화 함수
-- ============================================================
CREATE OR REPLACE FUNCTION check_compaction_needed(p_session_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    recent_count INTEGER;
    last_compacted_turn INTEGER;
BEGIN
    -- 마지막 압축 이후 메시지 수 계산
    SELECT COALESCE(MAX(upper(source_turn_range)), 0)
    INTO last_compacted_turn
    FROM compressed_memories
    WHERE session_id = p_session_id;

    SELECT COUNT(*)
    INTO recent_count
    FROM messages
    WHERE session_id = p_session_id
      AND turn_index > last_compacted_turn;

    -- 100턴 이상이면 압축 필요
    RETURN recent_count >= 100;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 22. 뉴런 사용량 집계 함수
-- ============================================================
CREATE OR REPLACE FUNCTION increment_neuron_usage(
    p_neuron_id UUID,
    p_success BOOLEAN
)
RETURNS VOID AS $$
BEGIN
    UPDATE neurons SET
        usage_count = usage_count + 1,
        success_count = success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
        failure_count = failure_count + CASE WHEN NOT p_success THEN 1 ELSE 0 END
    WHERE id = p_neuron_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 23. 스킬 만족도 기록 함수
-- ============================================================
CREATE OR REPLACE FUNCTION record_skill_feedback(
    p_skill_id UUID,
    p_rating INTEGER  -- 1~5
)
RETURNS VOID AS $$
BEGIN
    UPDATE skills SET
        satisfaction_sum = satisfaction_sum + p_rating,
        satisfaction_count = satisfaction_count + 1
    WHERE id = p_skill_id;
END;
$$ LANGUAGE plpgsql;
