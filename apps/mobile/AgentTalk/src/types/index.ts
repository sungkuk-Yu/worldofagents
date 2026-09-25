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
