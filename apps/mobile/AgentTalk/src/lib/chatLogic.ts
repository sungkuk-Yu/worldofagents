// 채팅 MVP 순수 로직 — 서버 행 ↔ UI 메시지 정규화, 페이지네이션, 낙관적 업데이트 머지
// (React/네트워크 의존 없음 → 단위 테스트 대상)
// 백엔드 스펙: apps/backend/docs/api-design.md §3.4
//   GET  /api/sessions/:id/messages → data[]: { id, turn_index, role, content, source_neuron, created_at }
//   POST /api/sessions/:id/messages → data: { user_message_id, empathy_response, answer_response, ... }
import { ChatMessage } from '../types';

/** 서버 messages 행 (최소 필드 — ApiEnvelope data[] 항목) */
export interface ServerMessageRow {
  id: string;
  turn_index: number;
  role: 'user' | 'agent' | 'system';
  content: string;
  source_neuron?: string | null;
  created_at?: string;
}

/** 서버 행 → UI 메시지 정규화 */
export function normalizeServerMessages(rows: ServerMessageRow[]): ChatMessage[] {
  return (rows || [])
    .filter((r) => r && typeof r.content === 'string' && r.content.length > 0)
    .map((r): ChatMessage => ({
      id: String(r.id),
      role: r.role === 'user' ? 'user' : r.role === 'system' ? 'system' : 'agent',
      content: r.content,
      turnIndex: Number(r.turn_index) || 0,
      sourceNeuron: r.source_neuron ?? null,
      createdAt: r.created_at,
    }))
    .sort((a, b) => a.turnIndex - b.turnIndex);
}

/**
 * 기존 목록에 새 페이지(이전 히스토리)를 prepend — id 중복 제거.
 * 서버는 turn_index 내림차순으로 limit만큼 반환하므로 오름차순 재정렬 후 합친다.
 */
export function prependPage(existing: ChatMessage[], olderPage: ChatMessage[]): ChatMessage[] {
  const seen = new Set(existing.map((m) => m.id));
  const fresh = olderPage.filter((m) => !seen.has(m.id));
  return [...fresh, ...existing].sort((a, b) => a.turnIndex - b.turnIndex);
}

/**
 * 낙관적 사용자 메시지 + 전송 실패 플래그 처리.
 * - appendOptimistic: pending 사용자 메시지를 목록 끝에 붙인다.
 * - confirmOptimistic: 서버 응답에서 확정된 행들을 pending 메시지 대신 교체/추가한다.
 */
export function appendOptimistic(existing: ChatMessage[], draft: ChatMessage): ChatMessage[] {
  return [...existing.filter((m) => m.id !== draft.id), draft];
}

/** POST 응답 → 확정 메시지 목록 (공감/답변 각각 별도 카드) */
export interface TurnConfirm {
  user_message_id: string;
  empathy_message_id?: string | null;
  answer_message_id?: string | null;
  empathy_response?: string | null;
  answer_response?: string | null;
  dialogue_type?: string;
}

export function confirmTurn(
  existing: ChatMessage[],
  optimisticId: string,
  confirm: TurnConfirm,
  userContent: string,
  baseTurnIndex: number
): ChatMessage[] {
  const withoutPending = existing.filter((m) => m.id !== optimisticId);
  const confirmedUser: ChatMessage = {
    id: confirm.user_message_id || optimisticId,
    role: 'user',
    content: userContent,
    turnIndex: baseTurnIndex,
    pending: false,
  };
  const out: ChatMessage[] = [...withoutPending, confirmedUser];
  let offset = 1;
  if (confirm.empathy_response) {
    out.push({
      id: confirm.empathy_message_id || `empathy-${baseTurnIndex}`,
      role: 'agent',
      content: confirm.empathy_response,
      turnIndex: baseTurnIndex + offset,
      sourceNeuron: 'empathy',
    });
    offset += 1;
  }
  if (confirm.answer_response) {
    out.push({
      id: confirm.answer_message_id || `answer-${baseTurnIndex}`,
      role: 'agent',
      content: confirm.answer_response,
      turnIndex: baseTurnIndex + offset,
      sourceNeuron: 'answer',
    });
  }
  // id 중복 방어 (WS가 먼저 같은 메시지를 뿌린 경우)
  const seen = new Set<string>();
  return out
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => a.turnIndex - b.turnIndex || (a.role === 'user' ? -1 : 1));
}

/** WS로 수신한 에이전트 응답(브로드캐스트) 머지 — id 중복이면 스킵 */
export function mergeIncoming(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(existing.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort((a, b) => a.turnIndex - b.turnIndex);
}

/** 다음 낙관적 turn_index 추정 — 목록 최대값 + 1 */
export function nextTurnIndex(existing: ChatMessage[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing.map((m) => m.turnIndex)) + 1;
}

/** 페이지네이션 커서 — 다음 "이전 페이지" 요청용 before 값 */
export function oldestCursor(messages: ChatMessage[]): number | null {
  if (messages.length === 0) return null;
  return messages[0].turnIndex;
}

// ── 처리중 상태 트래커 ─────────────────────────────
// 정체성 규칙: 처리중 표시는 100% 신뢰 가능해야 한다. REST pending 과 WS neuron.status 가
// 겹쳐 들어와도 "활성 소스 ≥ 1개"인 동안 상태가 소실되면 안 된다 (텔레그램식 깜빡임 금지).

export const DEFAULT_QUIP = '잠깐만요, 생각 중이에요…';

export interface TypingTracker {
  begin(source: string, quip?: string | null): void;
  end(source: string): void;
  endAll(): void;
  readonly active: boolean;
}

/**
 * 소스 카운터 기반 typing 트래커.
 * - begin(source, quip): 소스 활성화 (최근 quip 우선 표시)
 * - end(source): 소스 해제 — 다른 활성 소스가 남아 있으면 상태 유지
 * - onChange(active, quip): 상태가 바뀔 때만 호출 (중복 emit 없음)
 */
export function createTypingTracker(onChange: (active: boolean, quip: string | null) => void): TypingTracker {
  const sources = new Set<string>();
  const quips = new Map<string, string>();
  let lastActive = false;
  let lastQuip: string | null = null;

  function emit() {
    const active = sources.size > 0;
    const quip = active ? [...quips.values()].filter(Boolean).pop() ?? DEFAULT_QUIP : null;
    if (active !== lastActive || quip !== lastQuip) {
      lastActive = active;
      lastQuip = quip;
      onChange(active, quip);
    }
  }

  return {
    begin(source: string, quip?: string | null) {
      sources.add(source);
      if (quip) quips.set(source, quip);
      else quips.delete(source);
      emit();
    },
    end(source: string) {
      sources.delete(source);
      quips.delete(source);
      emit();
    },
    endAll() {
      sources.clear();
      quips.clear();
      emit();
    },
    get active() {
      return sources.size > 0;
    },
  };
}
