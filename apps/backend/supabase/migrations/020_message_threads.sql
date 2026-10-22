-- 020_message_threads.sql
-- 스레드 기능: 같은 대화 내 분기(parent_message_id), 검색·재오픈, 본문 병합
-- Feature flag: ENABLE_MESSAGE_THREADS (기본 OFF)

-- UP: 스레드 컬럼 추가 + 메타데이터 테이블
BEGIN;

-- messages 테이블에 스레드 관련 컬럼 추가
-- IF NOT EXISTS: 기존 parent_message_id와 충돌 방지
-- ON DELETE SET NULL: 부모 메시지 삭제 시 스레드 원문 보존 (고아 스레드로 전환)
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS merged_summary TEXT,
    ADD COLUMN IF NOT EXISTS is_merged_to_parent BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS send_to_main BOOLEAN NOT NULL DEFAULT false;

-- parent_message_id 인덱스 (스레드 조회 성능)
CREATE INDEX idx_messages_parent_message_id ON messages(parent_message_id)
    WHERE parent_message_id IS NOT NULL;

-- 스레드 메타데이터 테이블
CREATE TABLE message_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    parent_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    -- 스레드 제목 (검색용, 원 메시지 일부 또는 사용자 지정)
    title TEXT,
    -- 스레드 상태: active(활성), merged(본문 병합됨), archived(보관)
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'merged', 'archived')),
    -- 마지막 활동 시각 (정렬용)
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(parent_message_id)
);

-- 인덱스: 세션별 스레드 목록 조회
CREATE INDEX idx_message_threads_session_id ON message_threads(session_id, last_activity_at DESC);

-- 인덱스: 상태별 필터링
CREATE INDEX idx_message_threads_status ON message_threads(status)
    WHERE status = 'active';

COMMIT;

-- DOWN: 롤백 (스레드 데이터 보존 우선, 컬럼 DROP은 최후수단)
-- **권장 롤백 절차**:
-- 1. config.yaml 또는 .env에서 ENABLE_MESSAGE_THREADS=false 설정 (기능 비활성화)
-- 2. 애플리케이션 재시작 후 모니터링
-- 3. 데이터 보존이 불필요하다고 확정된 경우에만 아래 DROP 스크립트 실행
--
-- **DROP 스크립트** (실행 전 백업 필수):
-- BEGIN;
-- DROP INDEX IF EXISTS idx_message_threads_status;
-- DROP INDEX IF EXISTS idx_message_threads_session_id;
-- DROP TABLE IF EXISTS message_threads;
-- DROP INDEX IF EXISTS idx_messages_parent_message_id;
-- ALTER TABLE messages DROP COLUMN IF EXISTS send_to_main;
-- ALTER TABLE messages DROP COLUMN IF EXISTS is_merged_to_parent;
-- ALTER TABLE messages DROP COLUMN IF EXISTS merged_summary;
-- ALTER TABLE messages DROP COLUMN IF EXISTS parent_message_id;
-- COMMIT;
