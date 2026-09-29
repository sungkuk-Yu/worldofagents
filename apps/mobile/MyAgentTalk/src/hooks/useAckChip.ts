// 공감 재질문 카드 하단 예/아니요 버튼 행 수명 훅 (t_043539ff → t_c62a2eb7 격상 → t_64e3edd6 2.5초 자동 소진) —
// 판정 로직은 lib/ackChips(순수) 소유. t_64e3edd6 (대표님 9/29 "안누르더라도 3초(→2.5초) 후에 그냥 바로 답변"):
// 표시 후 ACK_AUTO_PROCEED_MS 경과 미터치 → 소멸. 시각이 상태를 결정하므로 exposed 상태에서 시계 리렌더가
// 필요하다 — 단, 노출 창이 2.5초로 유한하므로 재질문 등장 시에만 시작하는 자가 종료 타이머(폴링 상주 금지).
// 렌더는 순수 유지(react-hooks/purity): 시각은 state로만 소비 (useChatSession과 동일 관례).
// t_cc232982 요구3: 답변 스트리밍(streams에 미완료 카드)이 달리는 동안 버튼 행 억제 — answer.done 후 표시.
import { useEffect, useState } from 'react';
import { visibleAckChip, type AckChipView } from '../lib/ackChips';
import type { ChatMessage } from '../lib/chatLogic';

const TICK_MS = 200;

export function useAckChip(messages: ChatMessage[], streaming = false): AckChipView | null {
  const [now, setNow] = useState(() => Date.now());
  const view = visibleAckChip(messages, now);
  const viewId = view?.id ?? null;
  // 노출 중일 때만 시계 틱 — 소진(2.5s) 또는 user 발화 소멸 시 자동 정리. 상주 폴링 금지.
  useEffect(() => {
    if (!viewId) return;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, [viewId]);
  // 새 행(재질문 등장/낙관 user append)마다 시계 갱신 → 다음 렌더에서 판정 즉시 반영.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNow(Date.now()); }, [messages]);
  return visibleAckChip(messages, now, undefined, streaming);
}
