-- ============================================================
-- 사용자별 기록 인프라 (004) — 옵시디언식 볼트(vault_notes) + 칸반 보드(boards/board_cards)
-- 작업: t_3b38c9be (대표님 지시 ①각 사용자들의 디비로 기록 ②옵시디언과 칸반 모두 적용)
-- RLS는 002 패턴 그대로: authenticated/anon은 SELECT 전용, 모든 쓰기는 백엔드 service_role 경유.
-- ⚠️ board_cards는 기존 tasks 테이블(세션 스코프, 에이전트 실행 추적용)과 별개다 —
--    board_cards는 사용자 개인 칸반 보드의 카드. 혼동 금지 (api-design.md §"사용자별 볼트+칸반" 참조).
-- 실DB 적용은 김비서(감독)가 수행한다 (002/003과 동일 절차).
-- ============================================================

-- ------------------------------------------------------------
-- 1. vault_notes — 옵시디언식 사용자별 노트 볼트
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    -- 마크다운 원문 ([[wikilink]] 해석은 프론트 담당 — 백엔드는 원문 보존)
    content TEXT NOT NULL DEFAULT '',
    -- 폴더 경로 (옵시디언식 계층, 예: /업무/메모). 루트는 '/'
    folder TEXT NOT NULL DEFAULT '/',
    tags TEXT[] NOT NULL DEFAULT '{}',
    -- 백링크 저장소 (프론트가 계산해 PATCH로 동기화 가능, 기본 빈 배열)
    backlinks JSONB NOT NULL DEFAULT '[]',
    -- 대화→노트로 저장한 경우 역참조. 원본 메시지/세션이 삭제되어도 노트는 남는다(FK 없음 — 의도적).
    source_session_id UUID,
    source_message_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vault_notes IS '사용자별 옵시디언식 노트 볼트 — 행 단위 user_id 소유, RLS 본인 격리';
CREATE INDEX IF NOT EXISTS idx_vault_notes_user_folder ON vault_notes(user_id, folder);
CREATE INDEX IF NOT EXISTS idx_vault_notes_user_updated ON vault_notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_notes_source_message ON vault_notes(source_message_id);

-- ------------------------------------------------------------
-- 2. boards — 사용자별 칸반 보드
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE boards IS '사용자 개인 칸반 보드 — tasks(에이전트 실행 추적)와 별개';
CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id);

-- ------------------------------------------------------------
-- 3. board_cards — 보드 내 카드 (컬럼: todo/doing/review/done)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS board_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'doing', 'review', 'done')),
    priority INTEGER NOT NULL DEFAULT 0,
    -- 컬럼 내 카드 순서 (드래그 이동 시 앞뒤 카드 사이 값으로 갱신)
    position REAL NOT NULL DEFAULT 0,
    -- 담당 에이전트 이름 (사용자 에이전트가 카드 담당 가능 — users FK 아님)
    assignee TEXT,
    labels TEXT[] NOT NULL DEFAULT '{}',
    -- 대화→카드로 생성한 경우 역참조 (원본 삭제되어도 카드 유지 — FK 없음, 의도적)
    source_message_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE board_cards IS '개인 보드 카드 — 소유권은 board_id → boards.user_id로 결정';
CREATE INDEX IF NOT EXISTS idx_board_cards_board_status ON board_cards(board_id, status, position);
CREATE INDEX IF NOT EXISTS idx_board_cards_source_message ON board_cards(source_message_id);

-- ------------------------------------------------------------
-- 4. RLS (002 패턴: SELECT 전용 본인 격리, 쓰기는 service_role)
-- ------------------------------------------------------------
ALTER TABLE vault_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vault_notes_self_read" ON vault_notes;
CREATE POLICY "vault_notes_self_read" ON vault_notes FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "boards_self_read" ON boards;
CREATE POLICY "boards_self_read" ON boards FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "board_cards_via_board_read" ON board_cards;
CREATE POLICY "board_cards_via_board_read" ON board_cards FOR SELECT USING (
    board_id IN (SELECT id FROM boards WHERE user_id = auth.uid())
);

-- ------------------------------------------------------------
-- 5. updated_at 트리거 (001의 update_updated_at() 재사용)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_vault_notes_updated ON vault_notes;
CREATE TRIGGER trg_vault_notes_updated BEFORE UPDATE ON vault_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_boards_updated ON boards;
CREATE TRIGGER trg_boards_updated BEFORE UPDATE ON boards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_board_cards_updated ON board_cards;
CREATE TRIGGER trg_board_cards_updated BEFORE UPDATE ON board_cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
