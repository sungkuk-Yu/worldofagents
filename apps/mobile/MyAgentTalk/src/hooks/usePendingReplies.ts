// 답변 대기 폴링 훅 (t_363c0faa) — useQueueStrip(t_91cb659c)과 동일 계층 원칙.
// WS reply.pending.updated가 단일 상태원천(useChatSession.pendingReplies)을 갱신하고,
// 이 훅은 GET /pending 보조 pull만 owns: 부트스트랩 세션당 1회 + 미해소(pendingCount>0) 동안 15초 주기.
// 발화 해소 보조: 이 클라이언트가 보낸 발화(예/아니오/자유 발화)로 백엔드가 대기를 해소하면 WS 스냅샷이
// 유실돼도 런 종료(true→false) 직후 1회 재pull로 복구 — 대기 0건 상태에선 재조회가 반복되지 않는다
// (firstPull을 consume하므로 조건이 다시 참이 되지 않음; 9/28 dbg 실측: 지연 타이머는 테스트·실시간 양쪽 레이스).
// 토글/이벤트마다 즉시 재pull 금지 (t_2f45ccb1 교훈: 낡은 스냅샷이 WS 갱신을 덮어씀).
import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { normalizeReplyPending, PendingReplyItem } from '../lib/chatLogic';

export function usePendingReplies(opts: {
  sessionId: string | null;
  /** live 세션일 때만 폴링 (demo/미착지 세션은 요청 금지) */
  live: boolean;
  pendingCount: number;
  /** 답변 런 진행 여부 — 종료 전이(t_4497cfce 관례)에 해소 재확인 1회 */
  typing: boolean;
  /** WS reply.pending.updated와 동일한 단일 상태 적용기 — 보조 pull 전용 */
  applyPendingSnapshot: (items: PendingReplyItem[]) => void;
}): void {
  const { sessionId, live, pendingCount, typing, applyPendingSnapshot } = opts;
  const pollSid = live ? sessionId : null;
  const pulledSid = useRef<string | null>(null);
  const prevTyping = useRef(false);
  useEffect(() => {
    if (!pollSid) return;
    let disposed = false;
    const pull = async () => {
      try {
        const env = await api.getPendingReplies(pollSid);
        if (disposed || !env?.ok) return;
        applyPendingSnapshot(normalizeReplyPending(env.data));
      } catch { /* 404/래치/미착지: 배지 0 강등 — 대화 경로 무영향, 조용히 스킵 */ }
    };
    // 발화 종료 직후 해소 확인: WS 스냅샷(해소 count 0)을 놓쳤으면 즉시 재pull.
    // 첫 부트스트랩(pulledSid 미설정)과는 분리 — 부트스트랩은 effect 실행 본문에서, 이것은 전이 감지 후 예약.
    const runEnded = prevTyping.current && !typing;
    prevTyping.current = typing;
    const firstPull = pulledSid.current !== pollSid;
    if (firstPull) pulledSid.current = pollSid;
    // 부트스트랩: 세션당 1회 (WS 무신뢰/재접속 구간 복구) + 발화 종료 후 잔존 0건 재확인 1회
    // (종료 전이에만 발동 — 부트스트랩과 즉시 겹치지 않도록 첫 실행의 runEnded는 false).
    if (firstPull || runEnded) void pull();
    // 미해소가 쌓여 있는 동안에만 저빈도 주기
    let timer: ReturnType<typeof setInterval> | undefined;
    if (pendingCount > 0) timer = setInterval(() => void pull(), 15000);
    return () => { disposed = true; if (timer) clearInterval(timer); };
  }, [pollSid, pendingCount, typing, applyPendingSnapshot]);
}
