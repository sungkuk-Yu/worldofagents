// 공감 재질문 카드 하단 예/아니요 대형 버튼 — 순수 로직
// (t_043539ff 소형 척에서 출발 → t_c62a2eb7 대표님 9/28 "예/아니요 크게, 텔레그램 reply keyboard 형태로")
// 백엔드 계약 (t_135a19b5 게이트 / t_44f8896c 재질문 / t_5e407a8a 집합 확장):
//   - empathy 행 content=재질문("이거 맞냐" 템플릿 4종 회전),
//     structured_payload = { empathy_full(복창 원문), empathy_question, template_id, empathy_ack }.
//   - 확인 발화 수신 시 복창 재생성 skip + answer 강제 활성 — isConfirmationUtterance 정확 일치 집합.
// 라벨 계약 (t_1b123e59, 대표님 9/28 원문② "맞아요가 아니고 예/아니요 로만 해야되"):
//   - 템플릿 바인딩(eq_confirm→'맞아요/아니에오', t_c62a2eb7 #4) 폐기 — template_id 무관 모든
//     재질문 카드 버튼은 고정 '예'/'아니요'(en 'Yes'/'No'). 두 발화 모두 백엔드 게이트 집합 등재.
// 노출 계약 (t_c62a2eb7 #2 → t_64e3edd6 9/29 개정):
//   - 대표님 9/29 원문: "예 아 니오도 3초 안에 안사라지고 내가 안누르더라도 3초 후에 그냥 바로 답변해야
//     하는거야" → 3초(→#321 2.5초) 미터치 시 자동 소진(버튼 행 사라짐). 답변은 같은 턴에 이미 파이프라인
//     진행 중이므로(t_135a19b5: 확인 발화 없으면 empathy 후 answer 직결) 프론트는 소멸만 담당 —
//     '발화 진행까지 무한 유지'(t_c62a2eb7 #2)는 폐기. ACK_AUTO_PROCEED_MS = 2500.
//   - 탭 시 즉시 발화('예'/'아니요') 불변. 발화 진행(user 행 발생) 소멸도 여전히 유효(더 늦기 전엔 타이머가 1차).
//   - #324/#325: 음성 경로의 전사확인 2.5초 게이트는 폐지 — 예/아니오는 텍스트 입력의 공감 재질문에만.
//   - 히스토리 재현(새로고침/loadOlder)에는 노출하지 않는다: createdAt이 ACK_LIVE_STALE_MS 이내인
//     실시간 신규 행만 대상 (자동 소진 이후에도 잔여 안전망).
//   - 스레드 답글 경로의 empathy(parentMessageId)는 대상 제외(메인 피드만). 마지막 공감 행 하나만.
import type { ChatMessage } from './chatLogic';

/** created_at 이 경과한 행은 히스토리 재현으로 간주 (클럭 오차/재진입 유예 포함 15s) */
export const ACK_LIVE_STALE_MS = 15000;

/** 재질문 버튼 행 자동 소진 (t_64e3edd6 9/29, #321: 3초→2.5초) — 표시 후 미터치면 사라진다 */
export const ACK_AUTO_PROCEED_MS = 2500;

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
 * 수명 (t_64e3edd6 9/29): 표시 후 autoProceedMs(기본 2.5s) 미터치 → 소멸(자동 진행은 백엔드 파이프라인이
 * 이미 담당 — 답변은 확인 발화 없이도 같은 턴에 직결 실행). 그 전에 user 발화(탭 낙관 포함)가 오면 소멸.
 * autoProceedMs는 테스트 주입용 — 0 이하는 stale 가드와 같은 의미(노출 창 없음).
 * streaming (t_cc232982 요구3): 답변 토큰 스트리밍이 아직 성장 중이면 버튼 행 억제 — 재질문/답변이
 * answer.done(확정) 전에 반쯤 쓰인 카드에 예/아니요가 붙는 충돌을 막는다 (t_64e3edd6 자동진행 안전).
 */
export function visibleAckChip(messages: ChatMessage[], now: number, autoProceedMs: number = ACK_AUTO_PROCEED_MS, streaming = false): AckChipView | null {
  if (streaming) return null;
  let last: ChatMessage | null = null;
  for (const m of messages) if (isEmpathyEchoMessage(m)) last = m;
  if (!last) return null;
  // 답변 시작 이후 잔존 금지 — 이 공감보다 늦은 user 발화(탭 낙관 pending 포함)가 있으면 소멸
  if (messages.some((m) => m.role === 'user' && m.turnIndex > last!.turnIndex)) return null;
  // 실시간 신규 행 + 자동 소진 창 내만 (히스토리/재구독 재현은 created_at 결측/경개로 배제 — 방어 겸용)
  const createdMs = last.createdAt ? Date.parse(last.createdAt) : NaN;
  if (!Number.isFinite(createdMs) || now - createdMs > Math.min(autoProceedMs, ACK_LIVE_STALE_MS)) return null;
  return { id: last.id };
}

/** 백엔드 isConfirmationUtterance와 동일한 정규화 (trim + 어미 구두점/공백 제거 + 소문자). */
export function normalizeAckText(s: string): string {
  return s.trim().toLowerCase().replace(/[.!~〜？?。，,\s]+$/g, '');
}

/**
 * ack 결과 카드 숨김 판정 (t_64e3edd6 ②, 대표님 9/29 "예 아 니오의 결과는 사실상 카드로 안 보여줘도 돼"):
 * 공감 재질문(empathy 행) 이후, 그 사이에 다른 user 발화 없이 등장한 user 행 중 본문이
 * 예/아니요 라벨(현 locale '예'/'아니요', en 'Yes'/'No')과 정확 일치하면 렌더에서 제외한다.
 * 전송 자체는 정상 진행(백엔드 게이트 판정 전달) — 숨김은 화면 layer만. 라벨 외 일반 발화는
 * 재질문 창을 닫고(리셋), 이후 같은 라벨 재발화는 다시 숨김 대상(새 재질문 기준).
 * 낙관행/서버행 동일 규칙 적용 — 재진입 히스토리에서도 일관되게 숨김(결과는 카드 불필요 계약).
 */
export function ackResultCardIds(messages: ChatMessage[], labels: string[]): Set<string> {
  const want = new Set(labels.map(normalizeAckText).filter(Boolean));
  const out = new Set<string>();
  if (!want.size) return out;
  let empathyTurn: number | null = null;
  for (const m of messages) {
    if (isEmpathyEchoMessage(m)) { empathyTurn = m.turnIndex; continue; }
    if (m.role !== 'user') continue;
    if (empathyTurn !== null && m.turnIndex > empathyTurn && want.has(normalizeAckText(m.content || ''))) {
      out.add(m.id);
    } else {
      empathyTurn = null; // 그 외 user 발화 = 재질문 창 종료
    }
  }
  return out;
}
