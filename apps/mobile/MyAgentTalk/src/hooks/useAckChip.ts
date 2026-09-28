// 공감 카드 하단 예/아니요 칩 수명 훅 (t_043539ff) — 판정 로직은 lib/ackChips(순수) 소유.
// 렌더는 순수 유지(react-hooks/purity): 시각은 state로만 소비 — messages 변화 effect + deadline
// 타이머가 now를 갱신하고, 그 리렌더에서 visibleAckChip이 재판정한다. 미노출 시 타이머 없음(폴링 금지).
// 시작각은 lib/ackChips 모듈 캐시 — 컴포넌트 재마운트/재판정으로도 수명 갱신되지 않는다.
import { useEffect, useState } from 'react';
import { visibleAckChip, type AckChipView } from '../lib/ackChips';
import type { ChatMessage } from '../lib/chatLogic';

export function useAckChip(messages: ChatMessage[]): AckChipView | null {
  const [now, setNow] = useState(() => Date.now());
  const chip = visibleAckChip(messages, now);
  const deadline = chip?.deadline ?? 0;
  // 새 행(공감 등장/낙관 user append)마다 시계 갱신 → 다음 렌더에서 재판정.
  // 시간은 외부 시스템 — 데이터 변화 지점에서만 읽는 동기화이며 폴딩/루프 없음 (useChatSession과 동일 관례).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNow(Date.now()); }, [messages]);
  // 노출 중: deadline 도착 시 1회 리렌더(칩 소멸). 노출 아님: 타이머 생성 금지.
  useEffect(() => {
    if (!deadline) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, deadline - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [deadline]);
  return chip;
}
