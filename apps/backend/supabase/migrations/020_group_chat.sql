-- P0 group chat additive schema. Existing 1:1 sessions/messages remain untouched.
CREATE TABLE IF NOT EXISTS group_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS group_room_members (
  room_id UUID NOT NULL REFERENCES group_rooms(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL CHECK (member_type IN ('user','agent')),
  member_id UUID NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, member_type, member_id)
);
CREATE INDEX IF NOT EXISTS idx_group_room_members_member ON group_room_members(member_type, member_id);
CREATE TABLE IF NOT EXISTS group_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES group_rooms(id) ON DELETE CASCADE,
  start_message_id UUID,
  utterance_count INTEGER NOT NULL DEFAULT 0 CHECK (utterance_count >= 0),
  token_count INTEGER NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','halted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES group_rooms(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES group_messages(id) ON DELETE CASCADE,
  turn_id UUID REFERENCES group_turns(id) ON DELETE SET NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('user','agent')),
  author_id UUID NOT NULL,
  mentions UUID[] NOT NULL DEFAULT '{}',
  attachments JSONB NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','form','question','handoff','summary')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_messages_room ON group_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_group_messages_parent ON group_messages(parent_id, created_at);
ALTER TABLE group_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_rooms_owner_read ON group_rooms FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY group_members_owner_read ON group_room_members FOR SELECT USING (EXISTS (SELECT 1 FROM group_rooms r WHERE r.id = room_id AND r.owner_id = auth.uid()));
CREATE POLICY group_turns_owner_read ON group_turns FOR SELECT USING (EXISTS (SELECT 1 FROM group_rooms r WHERE r.id = room_id AND r.owner_id = auth.uid()));
CREATE POLICY group_messages_owner_read ON group_messages FOR SELECT USING (EXISTS (SELECT 1 FROM group_rooms r WHERE r.id = room_id AND r.owner_id = auth.uid()));
