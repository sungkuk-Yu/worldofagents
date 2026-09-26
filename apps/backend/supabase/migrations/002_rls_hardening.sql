-- codex-review-20260925 치명#2·중요 항목 반영 — 누락 테이블 RLS + 쓰기 주체 분리.
-- MVP 원칙: authenticated/anon은 읽기 전용이며 모든 쓰기는 백엔드 service_role(RLS bypass)을 경유한다.
-- 사용자 입력과 서버 생성 결과의 쓰기 권한을 분리한다. 실DB 적용은 감독이 수행한다.

ALTER TABLE context_patches ENABLE ROW LEVEL SECURITY;
ALTER TABLE neuron_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE neuron_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE neurons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_self" ON users;
DROP POLICY IF EXISTS "users_self_read" ON users;
CREATE POLICY "users_self_read" ON users FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "agents_owner" ON agents;
DROP POLICY IF EXISTS "agents_owner_read" ON agents;
CREATE POLICY "agents_owner_read" ON agents FOR SELECT USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "personas_via_agent" ON personas;
DROP POLICY IF EXISTS "personas_via_agent_read" ON personas;
CREATE POLICY "personas_via_agent_read" ON personas FOR SELECT USING (
        agent_id IN (SELECT id FROM agents WHERE owner_id = auth.uid())
    );

DROP POLICY IF EXISTS "sessions_self" ON sessions;
DROP POLICY IF EXISTS "sessions_self_read" ON sessions;
CREATE POLICY "sessions_self_read" ON sessions FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "messages_via_session" ON messages;
DROP POLICY IF EXISTS "messages_via_session_read" ON messages;
CREATE POLICY "messages_via_session_read" ON messages FOR SELECT USING (
        session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "tasks_via_session" ON tasks;
DROP POLICY IF EXISTS "tasks_via_session_read" ON tasks;
CREATE POLICY "tasks_via_session_read" ON tasks FOR SELECT USING (
        session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "task_logs_via_task" ON task_logs;
DROP POLICY IF EXISTS "task_logs_via_task_read" ON task_logs;
CREATE POLICY "task_logs_via_task_read" ON task_logs FOR SELECT USING (
        task_id IN (
            SELECT t.id FROM tasks t
            JOIN sessions s ON t.session_id = s.id
            WHERE s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "transcripts_via_session" ON raw_transcripts;
DROP POLICY IF EXISTS "transcripts_via_session_read" ON raw_transcripts;
CREATE POLICY "transcripts_via_session_read" ON raw_transcripts FOR SELECT USING (
        session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "memories_via_session" ON compressed_memories;
DROP POLICY IF EXISTS "memories_via_session_read" ON compressed_memories;
CREATE POLICY "memories_via_session_read" ON compressed_memories FOR SELECT USING (
        session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "context_patches_read" ON context_patches;
CREATE POLICY "context_patches_read" ON context_patches FOR SELECT USING (session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "neuron_instances_read" ON neuron_instances;
CREATE POLICY "neuron_instances_read" ON neuron_instances FOR SELECT USING (session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "neuron_connections_read" ON neuron_connections;
CREATE POLICY "neuron_connections_read" ON neuron_connections FOR SELECT USING (session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "skill_installations_read" ON skill_installations;
CREATE POLICY "skill_installations_read" ON skill_installations FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "neurons_read" ON neurons;
CREATE POLICY "neurons_read" ON neurons FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "skills_read" ON skills;
CREATE POLICY "skills_read" ON skills FOR SELECT USING (status = 'published' OR author_id = auth.uid());

-- ============================================================
-- 기능성 메시지 payload (Phase 2 — 대화 유형별 구조화 카드)
-- ============================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS dialogue_type TEXT
    CHECK (dialogue_type IN ('text','info_card','spreadsheet','file','task_flow','multi_agent'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS structured_payload JSONB NOT NULL DEFAULT '{}';

-- ============================================================
-- 스레드/하드포크 (Phase 2 — 슬랙식 스레드 + 브랜칭)
-- ============================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS root_message_id UUID REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS forked_from JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(session_id, root_message_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id);
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_user_id_agent_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_user_agent_root ON sessions(user_id, agent_id) WHERE (forked_from ->> 'session_id') IS NULL;
