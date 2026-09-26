/**
 * DB 스키마(001_initial_schema.sql)와 API 설계서(api-design.md) 기준 타입 정의.
 */

// ── 공통 ──────────────────────────────────────────────
export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

// ── 테이블 행 타입 ────────────────────────────────────
export interface UsersRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  timezone: string;
  language: string;
  preferences: Json;
  profile: Json;
  created_at: string;
  updated_at: string;
}

export interface AgentsRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  agent_type: 'shadow' | 'assistant' | 'custom';
  config: Json;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PersonasRow {
  id: string;
  agent_id: string;
  version: number;
  name: string;
  voice_config: Json;
  tone_config: Json;
  style_guide: Json;
  neuron_overrides: Json;
  relationship_type: string;
  is_active: boolean;
  created_at: string;
}

export interface SessionsRow {
  forked_from: Json;
  id: string;
  user_id: string;
  agent_id: string;
  persona_id: string;
  status: 'active' | 'suspended' | 'archived';
  stream_channel_id: string | null;
  metadata: Json;
  created_at: string;
  last_activity_at: string;
}

export interface NeuronsRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: 'core' | 'custom' | 'experimental';
  version: string;
  author: string;
  capabilities: string[];
  trigger_conditions: string[];
  resource_requirements: Json;
  dependencies: string[];
  persona_compatible: boolean;
  status: 'pending' | 'active' | 'deprecated' | 'blocked';
  always_active: boolean;
  usage_count: number;
  success_count: number;
  failure_count: number;
  satisfaction_sum: number;
  satisfaction_count: number;
  created_at: string;
  updated_at: string;
}

export type NeuronInstanceStatus = 'idle' | 'active' | 'processing' | 'degraded';

export interface NeuronInstancesRow {
  id: string;
  session_id: string;
  neuron_id: string;
  status: NeuronInstanceStatus;
  config: Json;
  activated_at: string | null;
  last_activity_at: string | null;
  deactivated_at: string | null;
  created_at: string;
}

export type DialogueCardType = 'text' | 'info_card' | 'spreadsheet' | 'file' | 'task_flow' | 'multi_agent';

export interface MessagesRow {
  locale: 'ko' | 'en';
  ai_generated: boolean;
  parent_message_id: string | null;
  root_message_id: string | null;
  id: string;
  session_id: string;
  stream_message_id: string | null;
  turn_index: number;
  role: 'user' | 'agent' | 'system';
  message_type: 'text' | 'voice' | 'image' | 'file' | 'card' | 'system';
  content: string;
  dialogue_type?: DialogueCardType | null;
  structured_payload: Json;
  stt_metadata: Json | null;
  source_neuron: string | null;
  attachments: Json;
  persona_guard: Json;
  user_feedback: 'like' | 'dislike' | null;
  /** 즐겨찾기(⭐) 영속화 — 마이그레이션 003. 개인 상태이며 재접속 시 GET /api/favorites로 동기화. */
  favorite: boolean;
  created_at: string;
}

export interface TasksRow {
  id: string;
  session_id: string;
  temporal_workflow_id: string | null;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assigned_neuron: string | null;
  task_type: string;
  input_data: Json;
  result: Json | null;
  started_at: string | null;
  completed_at: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillsRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: 'general' | 'productivity' | 'creative' | 'analysis' | 'communication' | 'neuron';
  version: string;
  author_id: string | null;
  author_name: string;
  content: Json;
  icon_url: string | null;
  price: number;
  status: 'draft' | 'pending_review' | 'published' | 'deprecated' | 'blocked';
  security_scan: Json;
  install_count: number;
  usage_count: number;
  satisfaction_sum: number;
  satisfaction_count: number;
  created_at: string;
  updated_at: string;
}

export interface SkillInstallationsRow {
  id: string;
  user_id: string;
  skill_id: string;
  agent_id: string | null;
  installed_version: string;
  config: Json;
  is_enabled: boolean;
  installed_at: string;
}

export interface ContextPatchesRow {
  id: number;
  session_id: string;
  key: string;
  operation: 'set' | 'append' | 'replace' | 'delete';
  delta: Json;
  source_neuron: string | null;
  created_at: string;
}

// ── API 요청/응답 DTO ─────────────────────────────────
export interface ApiResponse<T = unknown> {
  ok: true;
  data: T;
  meta?: {
    cursor?: string;
    has_more?: boolean;
    total?: number;
    /** offset 기반 페이지네이션 에코 (GET /api/favorites — 마이그레이션 003) */
    limit?: number;
    offset?: number;
  };
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PersonaConfig {
  system_prompt?: string;
  tags?: string[];
  persona_id: string;
  name: string;
  voice: Record<string, unknown>;
  tone: {
    formality: 'formal' | 'casual' | 'friendly' | string;
    emoji_usage: 'never' | 'rare' | 'frequent' | string;
    sentence_length: 'short' | 'medium' | 'long' | string;
    honorific_level: number;
    /** 처리 중 문구(quip) 톤: warm | brisk | playful (미설정 시 formality에서 추론) */
    quip_tone?: 'warm' | 'brisk' | 'playful' | string;
  };
  style_guide: {
    personality_traits: string[];
    preferred_expressions: string[];
    forbidden_expressions: string[];
    example_responses: { user_input: string; agent_response: string }[];
  };
  neuron_overrides: Record<string, { warmth_delta?: number; formality_delta?: number; allowed_prefixes?: string[] }>;
  relationship_context: {
    user_relationship: string;
    conversation_history_summary: string;
    recent_mood: string;
  };
}

export type DialogueType = 'information' | 'data' | 'file' | 'task' | 'multi' | 'question' | 'command';

export type NeuronStage = 'thinking' | 'organizing' | 'finalizing' | 'rendering';

export type ConsentType = 'terms' | 'privacy' | 'voice_recording' | 'overseas_transfer' | 'marketing';
export interface ConsentsRow {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  version: string;
  consented: boolean;
  ip_or_device: string | null;
  created_at: string;
}

// ── 사용자별 볼트 + 칸반 (마이그레이션 004, t_3b38c9be) ──────
// ⚠️ BoardCardsRow는 TasksRow(세션 스코프, 에이전트 실행 추적용)와 별개다.
// board_cards는 사용자 개인 칸반 보드의 카드이며 session/task FK가 없다.

/** 옵시디언식 노트 볼트 행 — user_id 직접 소유 */
export interface VaultNotesRow {
  id: string;
  user_id: string;
  title: string;
  /** 마크다운 원문 ([[wikilink]] 해석은 프론트 담당 — 백엔드는 원문 보존) */
  content: string;
  /** 폴더 경로 (항상 '/'로 시작, 루트는 '/') */
  folder: string;
  tags: string[];
  /** 백링크 저장소 — 프론트가 계산해 PATCH로 동기화 가능 */
  backlinks: Json;
  /** 대화→노트 저장 시 역참조 (FK 없음 — 원본 삭제되어도 노트 유지) */
  source_session_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 사용자 개인 칸반 보드 행 */
export interface BoardsRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type BoardCardStatus = 'todo' | 'doing' | 'review' | 'done';

/** 보드 카드 행 — 소유권은 board_id → boards.user_id로 결정 */
export interface BoardCardsRow {
  id: string;
  board_id: string;
  title: string;
  body: string;
  status: BoardCardStatus;
  priority: number;
  /** 컬럼 내 카드 순서 (드래그 이동 시 앞뒤 카드 사이 값으로 갱신) */
  position: number;
  /** 담당 에이전트 이름 (users FK 아님 — 자유 텍스트) */
  assignee: string | null;
  labels: string[];
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /api/vault/tree 노드 */
export interface VaultTreeNode {
  name: string;
  path: string;
  note_count: number;
  children: VaultTreeNode[];
}
