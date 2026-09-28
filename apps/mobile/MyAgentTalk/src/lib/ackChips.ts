// 공감 카드 하단 예/아니요 칩 — 순수 로직 (t_043539ff, 대표님 9/28 "그 카드 하단에 예/아니요 버튼만 3초")
// 백엔드 계약 (t_135a19b5):
//   - empathy 행 content=복창 원문(source_neuron='empathy'), 확인음은 structured_payload.empathy_ack.
//   - 확인 발화 '예'/'아니요'(en 'Yes'/'No' — isConfirmationUtterance 소문자화 매칭) 수신 시
//     복창 재생성 skip + answer 강제 활성. 칩 탭 payload는 이 집합과 완전 일치해야 한다.
// 노출 계약:
//   - 칩은 "카드가 화면에 처음 나타난 시점"으로부터 ACK_CHIP_WINDOW_MS(3000ms) 동안만.
//     백엔드가 empathy 행을 message.new로 턴 종료 직전 발행하므로(ANSWER_LEAD_MS는 스트리밍 앞 지연,
//     행 발행 자체는 리드 이후), 리드 창 체감이 아닌 카드-노출-3초 기준이 현실 유일한 앵커다.
//   - 답변 시작 이후 잔존 금지: 이 공감 행보다 turnIndex가 큰 user 행(칩 탭/직접 발화/큐 드레인 낙관 행 포함)
//     이 존재하면 즉시 소멸 — 대화가 이미 다음으로 넘어간 것. 같은 턴의 answer 행은 소멸 조건이 아니다
//     (실시간 스트리밍 후 최종 카드 배치로 함께 arrive하므로 3초 체감 의도 그대로 유지).
//   - 히스토리 재현(새로고침/loadOlder)에는 노출하지 않는다: createdAt이 ACK_LIVE_STALE_MS 이내인
//     실시간 신규 행만 대상. 스레드 답글 경로의 empathy(parentMessageId)는 대상 제외(메인 피드만).
//   - 마지막 공감 행 하나만 — 연속 큐 드레인 시 이전 칩은 이미 'answered'로 소멸하지만 이중 가드.
// 시작각(deadline)은 모듈 레벨 Map에 messageId 기준으로 보관 — 컴포넌트 재마운트(스크롤)로도
// 재생성되지 않고 잔여시간이 유지된다. 값은 uuid 키라 세션 전환 시 누적만 방지되면 안전(size 가드).
import type { ChatMessage } from './chatLogic';

export const ACK_CHIP_WINDOW_MS = 3000;
/** created_at 이 경과한 행은 히스토리 재현으로 간주 (클럭 오차/리로드 유예 포함 15s) */
export const ACK_LIVE_STALE_MS = 15000;

/** 칩 시작각 캐시 — messageId → 이 세션 JS 런타임에서 칩이 처음 카운트된 시각(ms) */
const chipStarts = new Map<string, number>();
const CHIP_STARTS_MAX = 64;

/** 테스트/세션 초기화용 — 시작각 캐시 비우기 */
export function resetAckChipStarts(): void {
  chipStarts.clear();
}

/** 메인 피드 실시간 공감(에코) 행 판별 */
export function isEmpathyEchoMessage(m: ChatMessage): boolean {
  return m.role === 'agent' && m.sourceNeuron === 'empathy' && !m.parentMessageId && m.content.trim().length > 0;
}

function startOf(messageId: string, now: number): number {
  let start = chipStarts.get(messageId);
  if (start === undefined) {
    // uuid 키지만 무한 누적 방지 — 가장 오래된 항목부터 만료 정리
    if (chipStarts.size >= CHIP_STARTS_MAX) {
      const oldest = chipStarts.keys().next().value;
      if (oldest !== undefined && oldest !== messageId) chipStarts.delete(oldest);
    }
    start = now;
    chipStarts.set(messageId, start);
  }
  return start;
}

export interface AckChipView {
  id: string;
  /** 칩이 사라지는 시각 (Date.now() 기준 ms) */
  deadline: number;
}

/**
 * 현재 칩을 노출할 공감 카드 (없으면 null).
 * messages는 turnIndex 오름차순 (normalizeServerMessages/group 정렬 보장) — 마지막 empathy 행 기준.
 */
export function visibleAckChip(messages: ChatMessage[], now: number, staleMs: number = ACK_LIVE_STALE_MS): AckChipView | null {
  let last: ChatMessage | null = null;
  for (const m of messages) if (isEmpathyEchoMessage(m)) last = m;
  if (!last) return null;
  // 답변 이후 잔존 금지 — 이 공감보다 늦은 user 발화(낙관 pending 포함)가 있으면 소멸
  if (messages.some((m) => m.role === 'user' && m.turnIndex > last!.turnIndex)) return null;
  // 실시간 신규 행만 (히스토리/재구독 재현 배제) — created_at 없으면 대상 제외(방어)
  const createdMs = last.createdAt ? Date.parse(last.createdAt) : NaN;
  if (!Number.isFinite(createdMs) || now - createdMs > staleMs) return null;
  const deadline = startOf(last.id, now) + ACK_CHIP_WINDOW_MS;
  return deadline > now ? { id: last.id, deadline } : null;
}
