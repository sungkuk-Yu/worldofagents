// 공감 재질문 카드 하단 예/아니요 대형 버튼 — 순수 로직
// (t_043539ff 소형 척에서 출발 → t_c62a2eb7 대표님 9/28 "예/아니요 크게, 텔레그램 reply keyboard 형태로")
// 백엔드 계약 (t_135a19b5 게이트 / t_44f8896c 재질문 / t_5e407a8a 집합 확장):
//   - empathy 행 content=재질문("이거 맞냐" 템플릿 4종 회전),
//     structured_payload = { empathy_full(복창 원문), empathy_question, template_id, empathy_ack }.
//   - 확인 발화 수신 시 복창 재생성 skip + answer 강제 활성 — isConfirmationUtterance 정확 일치 집합.
//     기본 '예'/'아니요'(en 'Yes'/'No') + '~맞죠?' 어미용 '맞아요'/'아니에오'(en 'Yeah'/'Nope') —
//     4종 모두 백엔드 집합에 등재되어 있으므로 라벨=발화 payload로 그대로 안전.
// 노출 계약 (t_c62a2eb7 #2):
//   - 소형 척의 3초 수명 폐기 — 재질문 카드가 보이는 동안 버튼 행 유지(상시 확인 가능).
//     소멸은 발화 진행으로만: 해당 empathy 행보다 turnIndex가 큰 user 행(칩 탭 낙관/직접 발화/큐 드레인)
//     이 생기거나 더 늦은 empathy 행이 오면 이동. 연속 질문 스팸 방지 = 답변 시작 시 자동 소멸.
//   - 히스토리 재현(새로고침/loadOlder)에는 노출하지 않는다: createdAt이 ACK_LIVE_STALE_MS 이내인
//     실시간 신규 행만 대상. 버튼이 무한 유지되는 것은 "이 세션에서 이미 넘어간 카드"가 재appear 하지
//     않는 것과 양립 — 재진입 시점에는 stale 가드가 소멸을 담당한다.
//   - 스레드 답글 경로의 empathy(parentMessageId)는 대상 제외(메인 피드만). 마지막 공감 행 하나만.
import type { ChatMessage } from './chatLogic';

/** created_at 이 경과한 행은 히스토리 재현으로 간주 (클럭 오차/재진입 유예 포함 15s) */
export const ACK_LIVE_STALE_MS = 15000;

/** 메인 피드 실시간 공감(재질문) 행 판별 */
export function isEmpathyEchoMessage(m: ChatMessage): boolean {
  return m.role === 'agent' && m.sourceNeuron === 'empathy' && !m.parentMessageId && m.content.trim().length > 0;
}

export interface AckChipView {
  id: string;
}

/**
 * 현재 버튼 행을 노출할 공감 카드 (없으면 null).
 * messages는 turnIndex 오름차순 (normalizeServerMessages/group 정렬 보장) — 마지막 empathy 행 기준.
 * deadline 없음: 시각 타이머가 아니라 발화 진행(뒤의 user 행)이 수명을 결정한다 (t_c62a2eb7 #2).
 */
export function visibleAckChip(messages: ChatMessage[], now: number, staleMs: number = ACK_LIVE_STALE_MS): AckChipView | null {
  let last: ChatMessage | null = null;
  for (const m of messages) if (isEmpathyEchoMessage(m)) last = m;
  if (!last) return null;
  // 답변 시작 이후 잔존 금지 — 이 공감보다 늦은 user 발화(탭 낙관 pending 포함)가 있으면 소멸
  if (messages.some((m) => m.role === 'user' && m.turnIndex > last!.turnIndex)) return null;
  // 실시간 신규 행만 (히스토리/재구독 재현 배제) — created_at 없으면 대상 제외(방어)
  const createdMs = last.createdAt ? Date.parse(last.createdAt) : NaN;
  if (!Number.isFinite(createdMs) || now - createdMs > staleMs) return null;
  return { id: last.id };
}

/**
 * '~맞죠?' 어미 재질문 id — 부모 카드(t_44f8896c) contract_for_child.button_label_rule 확정 해석:
 * eq_confirm('이거 맞죠? {요약}')만 '맞아요/아니에오' 라벨 대상. eq_align('맞나요? …')은 '~맞나요?'형이라
 * 어미 요건에 해당하지 않아 기본 예/아니요 유지. 본문 정규식 대신 template_id 키로 판정하는 이유:
 * '{요약}' 삽입으로 문장 어미가 가변(eq_confirm도 요약 뒤로 '이거 맞죠?'가 문두로 밀림).
 */
export const ACK_MATCH_TEMPLATE_IDS: ReadonlySet<string> = new Set(['eq_confirm']);

export interface AckLabelKeys {
  yesKey: string;
  noKey: string;
}

/**
 * 라벨 바인딩 (t_c62a2eb7 #4): 백엔드 structured_payload.template_id가 '~맞죠?' 형 어미
 * (eq_confirm)면 chat.ackMatchYes/No('맞아요'/'아니에오'), 그 외·template_id 결측(구 행)은
 * 기본 chat.ackYes/No('예'/'아니요') — 부모 카드(t_44f8896c) contract_for_child.fallback 규약.
 * 반환값은 i18n 키 — 렌더 라벨과 탭 payload가 같은 키에서 파생되어 발화=문구 불일치를 원천 차단.
 */
export function ackLabelKeysFor(m: ChatMessage): AckLabelKeys {
  const tid = typeof m.payload?.template_id === 'string' ? (m.payload.template_id as string) : null;
  if (tid && ACK_MATCH_TEMPLATE_IDS.has(tid)) return { yesKey: 'chat.ackMatchYes', noKey: 'chat.ackMatchNo' };
  return { yesKey: 'chat.ackYes', noKey: 'chat.ackNo' };
}
