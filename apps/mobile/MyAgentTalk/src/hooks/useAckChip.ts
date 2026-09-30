// 공감 재질문 카드 하단 예/아니요 버튼 행 수명 훅 (t_043539ff → t_c62a2eb7 격상 → t_64e3edd6 2.5초 자동 소진) —
// 판정 로직은 lib/ackChips(순수) 소유. t_64e3edd6 (대표님 9/29 "안누르더라도 3초(→2.5초) 후에 그냥 바로 답변"):
// 표시 후 ACK_AUTO_PROCEED_MS 경과 미터치 → 소멸. 시각이 상태를 결정하므로 exposed 상태에서 시계 리렌더가
// 필요하다 — 단, 노출 창이 2.5초로 유한하므로 재질문 등장 시에만 시작하는 자가 종료 타이머(폴링 상주 금지).
// 렌더는 순수 유지(react-hooks/purity): 시각은 state로만 소비 (useChatSession과 동일 관례).
// t_cc232982 요구3: 답변 스트리밍(streams에 미완료 카드)이 달리는 동안 버튼 행 억제 — answer.done 후 표시.
// t_b2004d50 (김비서 9/30 앵커 교체 — 서버 created_at → 클라이언트 도착/노출 시점):
//   창 개시 시각 = Map<empathy id, firstSeenMs>에 각인한 '노출 가능해진 첫 관측' — visibleAckChip의
//   exposureStartMs로 주입. 같은 id 재관측(시계 틱·메시지 머지·WS 재구독 버스트)은 최초값 보존(리셋
//   금지 — 카드 명시: "WS 재구독 버스트가 도착시를 리셋하지 않게"). 스트리밍 억제 중에는 후보 게이트가
//   닫혀 각인 자체가 안 생기므로, answer.done 해제 순간이 창 개시가 된다(요구3 정합).
//   세션 전환/언마운트 = 훅 재생성 → Map 자연 폐기. 히스토리 재현(배치 GET 미도장+created 경화)은
//   후보 게이트에서 배제 → 각인도 뷰도 생기지 않는다(재진입 재점등 금지, smoke ⑦/verify ④ 회귀 가드).
import { useEffect, useRef, useState } from 'react';
import { ackChipCandidateId, visibleAckChip } from '../lib/ackChips';
import type { ChatMessage } from '../lib/chatLogic';

const TICK_MS = 200;

export function useAckChip(messages: ChatMessage[], streaming = false) {
  const [now, setNow] = useState(() => Date.now());
  const exposureRef = useRef<Map<string, number>>(new Map());
  // 후보 id는 순수 계산(렌더 중 변형 없음; 스트리밍 억제를 무시한 '창 개시 자격' id).
  const candidateId = ackChipCandidateId(messages, now);
  const view = visibleAckChip(messages, now, undefined, streaming, candidateId ? exposureRef.current.get(candidateId) : undefined);
  // 후보 관측 = '노출 가능' 전이 — 첫 각인 시에만 리렌더 유도(각인 전 계산은 만료 created_at로
  // null일 수 있어 타이머가 안 뜨는 교착을 방지). 이미 각인된 id는 시계 틱이 창 종료를 담당.
  // 스트리밍 억제(t_cc232982 요구3) 구간은 각인을 폐기한다 — 억제 중 도착한 재질문(empathyEarly
  // ON 경로)은 answer.done 순간이 창 개시가 돼야 'done 후 표시' 계약이 2.5s 창을 실제로 준다
  // (각인 유지 시 억제 구간이 창을 통째로 태워 F 구간이 구조적으로 실패 — t_888c1669 김비서 판정).
  useEffect(() => {
    const id = ackChipCandidateId(messages, Date.now());
    if (!id) return;
    if (streaming) {
      if (!exposureRef.current.delete(id)) return;
    } else if (exposureRef.current.has(id)) {
      return;
    } else {
      exposureRef.current.set(id, Date.now());
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, [messages, streaming]);
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
  return view;
}
