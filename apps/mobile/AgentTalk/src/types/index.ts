// 에이전트톡 핵심 타입 정의

// 다이얼로그 유형 (대화 목적별 특화 컴포넌트)
export type DialogType = 
  | 'information'      // 정보 응답형
  | 'data'            // 데이터 조작형
  | 'file'            // 파일 처리형
  | 'task'            // 작업 위임형
  | 'multi-agent';    // 멀티 에이전트 협업형

// 뉴런 유형 (백서 3.3절)
export type NeuronType = 
  | 'empathy'         // 공감 에이뉴런
  | 'answer'          // 답변생성 에이뉴런
  | 'visual'          // 비주얼 에이뉴런
  | 'custom';         // 커스텀 에이뉴런

// 뉴런 상태
export interface NeuronState {
  type: NeuronType;
  active: boolean;
  confidence: number;
  processing: boolean;
}

// 조이스틱 방향 (8방향 + 중앙)
export type JoystickDirection = 
  | 'center'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'up-left'
  | 'up-right'
  | 'down-left'
  | 'down-right';

// 조이스틱 제스처 타입
export type JoystickGesture = 
  | 'TAP_CENTER'
  | 'LONG_CENTER'
  | 'DIR_LEFT'
  | 'DIR_RIGHT'
  | 'DIR_UP'
  | 'DIR_DOWN'
  | 'DIR_UPLEFT'
  | 'DIR_UPRIGHT'
  | 'DIR_DOWNLEFT'
  | 'DIR_DOWNRIGHT';

// 다이얼로그 (대화 단위)
export interface Dialogue {
  id: string;
  type: DialogType;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  activeNeurons: NeuronState[];
}

// 메시지 (채팅버블이 아닌 기능 중심)
export interface Message {
  id: string;
  dialogueId: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  dialogType: DialogType;
  metadata?: Record<string, any>;
}

// 실시간 트랜스크립트
export interface Transcript {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: Date;
  speaker: 'user' | 'agent';
}

// 작업 플로우 상태
export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'cancelled' | 'failed';

export interface TaskFlow {
  id: string;
  title: string;
  status: TaskStatus;
  steps: TaskStep[];
  createdAt: Date;
}

export interface TaskStep {
  id: string;
  description: string;
  status: TaskStatus;
  completedAt?: Date;
}

// 멀티 에이전트
export interface Agent {
  id: string;
  name: string;
  persona: string;
  active: boolean;
  neurons: NeuronState[];
}

// 뉴런 연결 이벤트
export interface NeuronConnectionEvent {
  type: 'connected' | 'disconnected' | 'activated' | 'deactivated';
  neuron: NeuronType;
  timestamp: Date;
  reason?: string;
}

// 세그먼트 히스토리 항목 (결과 캔버스 · 하단 레일)
export type SegmentHistoryEntry = {
  id: string;
  /** 다이얼로그 유형과 동일 — 정보/데이터/파일/작업/멀티 */
  type: DialogType;
  /** 레일 라벨 (기본값: 세그먼트 표준 라벨) */
  label?: string;
  /** 뉴 닷 표시 (신규 세그먼트) */
  isNew?: boolean;
  /** 접힘/도움말용 요약 */
  summary?: string;
};

// ── 채팅 MVP (Phase 2) ──────────────────────────────

/** 채팅 화면 UI 메시지 — 백엔드 messages 행에서 정규화 */
export interface ChatMessage {
  aiGenerated?: boolean;
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  /** 백엔드 turn_index — 페이지네이션 커서 기준 */
  turnIndex: number;
  /** 응답 생성 뉴런 (empathy/answer 등) */
  sourceNeuron?: string | null;
  /** 낙관적 업데이트 중인 메시지 (서버 확인 전) */
  pending?: boolean;
  createdAt?: string;
  dialogueType?: string | null;
  payload?: StructuredPayload;
  parentMessageId?: string;
  threadReplyCount?: number;
  favorite?: boolean;
  taskOverrides?: Record<number, boolean>;
  contentKey?: string;
  contentParams?: Record<string, string>;
  status?: 'pending' | 'sent' | 'failed';
  runId?: string;
  draft?: string;
}

/** 로그인 사용자 */
export interface AuthUser {
  id: string;
  email?: string;
  displayName?: string;
}


// 서버 JSONB는 각 카드에서 사용하기 전에 다시 검증한다.
export interface StructuredPayload {
  title?: unknown;
  fields?: unknown;
  columns?: unknown;
  rows?: unknown;
  items?: unknown;
  name?: unknown;
  url?: unknown;
  mime_type?: unknown;
  size?: unknown;
  agents?: unknown;
  [key: string]: unknown;
}
export interface ForkOrigin {
  session_id: string;
  message_id?: string;
  title?: string;
}
