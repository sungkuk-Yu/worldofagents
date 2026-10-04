// 질문 큐 점프/폴링 컨트롤러 — 스트립 폐기(t_3c882443, 대표님 10/4 지시 3) 후에도 살아남는 두 기능만 소유:
// ① 칩→카드가 아니라 트래커(t_fd869e5b QuestionTracker) 행 탭이 쓰는 requestJump(nonce 점프) ② GET /queue
// 보조 폴링(부트스트랩 세션당 1회 + pending 있는 동안 15초) — QueueMessageMark/트래커의 queue 상태 원료.
// 계층 원칙 (t_2f45ccb1 교훈 그대로): WS queue.updated 우선 · 폴링 보조 —
// 부트스트랩은 세션당 1회, pending이 있는 동안에만 15초 주기. 토글마다 즉시 재pull 금지
// (낡은 스냅샷이 WS 갱신을 덮어씀). 적용기는 useChatSession의 단일 queue 상태를 그대로 쓴다 (이중 상태원천 금지).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { normalizeQueueItems, ChatMessage, QueueItem } from '../lib/chatLogic';

export interface QueueStripController {
  /** 트래커/딥링크 점프 대상 — nonce로 같은 행 재탭에도 스크롤 효과 재발동 */
  jump: { id: string; nonce: number } | null;
  requestJump: (messageId: string) => void;
}

export function useQueueStrip(opts: {
  sessionId: string | null;
  /** live 세션일 때만 폴링 (demo/미착지 세션은 요청 금지) */
  live: boolean;
  messages: ChatMessage[];
  queue: QueueItem[];
  /** WS queue.updated와 동일한 단일 상태 적용기 — 보조 pull 전용 */
  applyQueueSnapshot: (items: QueueItem[]) => void;
}): QueueStripController {
  const { sessionId, live, messages, queue, applyQueueSnapshot } = opts;
  const [jump, setJump] = useState<{ id: string; nonce: number } | null>(null);
  const requestJump = useCallback((id: string) => setJump({ id, nonce: Date.now() }), []);
  // 폴링 트리거 = 서버 큐 pending ∪ 발화 후 답변 대기(마지막 루트 행이 user).
  // (구 스트립의 buildQueueStrip 로컬 유도 pending과 동등한 창 — WS 지연 시 마커/트래커 원료 갱신용.
  //  토글 시 즉시 재pull 없음: 부트스트랩은 세션당 1회 고정, 인터벌만 켜고 꺼진다 — 9/27 경합 교훈.)
  const queuePending = queue.some((q) => q.status === 'pending');
  const awaitingAnswer = messages.length > 0 && [...messages].reverse().find((m) => m.role !== 'system' && !m.parentMessageId)?.role === 'user';
  const pollTrigger = queuePending || awaitingAnswer;
  const pollSid = live ? sessionId : null;
  const pulledSid = useRef<string | null>(null);
  useEffect(() => {
    if (!pollSid) return;
    let disposed = false;
    const pull = async () => {
      try {
        const env = await api.getQueue(pollSid);
        if (disposed || !env?.ok || !Array.isArray((env as { data?: unknown }).data)) return;
        applyQueueSnapshot(normalizeQueueItems((env as { data: unknown }).data));
      } catch { /* 404/네트워크 — 계약 미착지 구간: 마커/트래커는 렌더 없음으로 조용히 버틴다 */ }
    };
    // 부트스트랩: 세션당 1회
    let timer: ReturnType<typeof setInterval> | undefined;
    if (pulledSid.current !== pollSid) {
      pulledSid.current = pollSid;
      void pull();
    }
    if (pollTrigger) timer = setInterval(() => void pull(), 15000);
    return () => { disposed = true; if (timer) clearInterval(timer); };
  }, [pollSid, pollTrigger, applyQueueSnapshot]);
  return { jump, requestJump };
}
