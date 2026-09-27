// 질문 큐 스트립 도메인 훅 (t_91cb659c 심야 리팩터링 ②) — 스트립 데이터 경계의 단일 진입점.
// ChatScreen은 조립만 하고, 칩 행 빌드 · GET /queue 보조 폴링 · 칩 탭 점프 요청은 이 훅이 소유한다.
// 계층 원칙 (t_2f45ccb1 교훈 그대로): WS queue.updated 우선 · 폴링 보조 —
// 부트스트랩은 세션당 1회, pending이 있는 동안에만 15초 주기. stripPending 토글마다 즉시 재pull 금지
// (낡은 스냅샷이 WS 갱신을 덮어씀). 적용기는 useChatSession의 단일 queue 상태를 그대로 쓴다 (이중 상태원천 금지).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { buildQueueStrip, ChatMessage, normalizeQueueItems, QueueItem, QueueStripItem } from '../lib/chatLogic';

export interface QueueStripController {
  /** 상단 칩 행 — 서버 큐 우선, 없으면 메시지 로컬 유도 (QueueStrip 렌더 props) */
  items: QueueStripItem[];
  /** 칩 탭 점프 대상 (t_2f45ccb1) — nonce로 같은 칩 재탭에도 스크롤 효과 재발동 */
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
  const items = useMemo(() => buildQueueStrip(messages, queue), [messages, queue]);
  const [jump, setJump] = useState<{ id: string; nonce: number } | null>(null);
  const requestJump = useCallback((id: string) => setJump({ id, nonce: Date.now() }), []);
  const stripPending = items.some((s) => s.status === 'pending');
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
      } catch { /* 404/네트워크 — 계약 미착지 구간: strip은 messages 로컬 유도로 표시 */ }
    };
    // 부트스트랩: 세션당 1회
    let timer: ReturnType<typeof setInterval> | undefined;
    if (pulledSid.current !== pollSid) {
      pulledSid.current = pollSid;
      void pull();
    }
    if (stripPending) timer = setInterval(() => void pull(), 15000);
    return () => { disposed = true; if (timer) clearInterval(timer); };
  }, [pollSid, stripPending, applyQueueSnapshot]);
  return { items, jump, requestJump };
}
