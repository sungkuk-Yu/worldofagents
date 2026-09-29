// 공감 재질문 카드 하단 예/아니요 버튼 행 수명 훅 (t_043539ff → t_c62a2eb7 격상) —
// 판정 로직은 lib/ackChips(순수) 소유. 3초 타이머 폐기: 버튼 행은 발화 진행(뒤의 user 행)까지 유지되므로
// 시각 리렌더가 불요 — messages 변화 시점에만 now를 갱신해 stale 가드를 재판정한다(폴링 없음).
// 렌더는 순수 유지(react-hooks/purity): 시각은 state로만 소비 (useChatSession과 동일 관례).
// t_cc232982 요구3: 답변 스트리밍(streams에 미완료 카드)이 달리는 동안 버튼 행 억제 — answer.done 후 표시.
import { useEffect, useState } from 'react';
import { visibleAckChip, type AckChipView } from '../lib/ackChips';
import type { ChatMessage } from '../lib/chatLogic';

export function useAckChip(messages: ChatMessage[], streaming = false): AckChipView | null {
  const [now, setNow] = useState(() => Date.now());
  // 새 행(재질문 등장/낙관 user append)마다 시계 갱신 → 다음 렌더에서 stale 가드 재판정.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNow(Date.now()); }, [messages]);
  return visibleAckChip(messages, now, undefined, streaming);
}
