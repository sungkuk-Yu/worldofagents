// 진행 중인 질문(밀린 큐) 시각화 — 순수 파생 로직 (t_140ecc15, 대표님 10/4 지시).
// "가운데 창 우측 상단 '진행 중인 질문' 버튼 = 전역 큐 입구: pending 수 배지(주황 = 답변 중+대기,
//  빨강 = 멈춤). 탭 → 질문별 排队 시각화(번호=대기 순서, 앞 질문 상태, 도착 시각·대기 시간).
//  운영 체킹 = 이 배지 0 확인."
// 데이터 소스 원칙 (t_fd869e5b 계승): 백엔드 API 신규 없음 — 서버 큐 스냅샷(QueueItem: WS
// queue.updated/GET /queue/메시지 스냅샷의 단일 상태원천) ∪ messages 확정+낙관 행 ∪ 활성 streams
// ∪ 시간만으로 판정한다. 서버 큐가 세션을 모르는 구간(미착지/미배포)에서는 messages 파생만 동작.
// 상태 3분류:
//   answering(답변 중) = 선두 미해답 질문의 런(활성 스트림 소유 시 그 행, 없어도 선두=지금 처리 중)
//   waiting(대기)      = 순서상 앞이 막혀 있는 미해답 행 (번호=대기 순서)
//   stopped(멈춤)      = 전송 실패 행, 또는 활성 런 없이 STOPPED_MS 넘게 정체된 서버 pending/선두 행
//                        (백오프/타임아웃 미회수 실사례 — 운영자 해소 대상)
// 배지: pendingCount = unanswered 전역 수(숫자), stoppedCount = 멈춤 수.
//        stoppedCount ≥ 1 이면 배지 색 빨강, 그 외 주황(amber), 0이면 배지 숨김.
// 성능: answered/live 판정은 정렬된 turnIndex 배열에 이진탐색 1패스 (빌드 O(n log n)) —
//       피드 delta마다 재계산되는 경로(useChatSession useMemo)이므로 tracker식 O(n²) 윈도우 스캔 금지.
import type { ChatMessage, QueueItem, StreamingAnswer } from './chatLogic';
import { isStreamCard, queueItemForMessage } from './chatLogic';

export type QueueViewStatus = 'answering' | 'waiting' | 'stopped';

export interface QueueViewItem {
  /** user 질문 카드 id (메시지 없는 서버 큐 전용 항목이면 큐 항목 id) */
  id: string;
  /** 매칭된 서버 큐 항목 id (QueueMessageMark 대조용; messages 파생 전용이면 undefined) */
  queueId?: string;
  text: string;
  status: QueueViewStatus;
  /** 전송 실패 행(재발화 대상) — stopped의 하위 사유. 큐 전용 행은 false. */
  failed: boolean;
  /** 대기 순번 (1부터, unanswered 목록 내 위치 = 화면의 'n번째') */
  position: number;
  /** 서버 큐 스냅샷에서 매칭된 항목이면 true (미매칭 = messages 로컬 유도) */
  fromServerQueue: boolean;
  /** 질문 도착 시각(ms) — 파싱 불가/큐 전용 행이면 0 */
  arrivalMs: number;
}

export interface QueueView {
  items: QueueViewItem[];
  /** 답변 중 + 대기 수 (주황 배지 숫자) */
  pendingCount: number;
  /** 멈춤 수 (≥1 = 배지 색 빨강) */
  stoppedCount: number;
  /** 전역 밀린 수 = pending + stopped (리스트 헤더용) */
  backlogCount: number;
  /** 대기(waiting) 수 — 스트리밍 카드의 '답변 중 · 대기 n건' 문구용 */
  waitingCount: number;
}

/** 서버 큐 매칭/선두 행의 정체 판정 창(ms). 백엔드 런 타임아웃(통상 60~90s)보다 넓게 — 오탐(주황→빨강) 방지. */
export const QUEUE_STOPPED_MS = 180_000;

const EMPTY_VIEW: QueueView = { items: [], pendingCount: 0, stoppedCount: 0, backlogCount: 0, waitingCount: 0 };

const isRootQuestion = (m: ChatMessage) => m.role === 'user' && !m.parentMessageId;
/** 확정 답변 행: 에이전트·비감정·스트리밍/스트림 카드 아님 (buildQuestionTracker와 동일 판정) */
const isFinalAnswer = (m: ChatMessage) =>
  m.role === 'agent' && m.sourceNeuron !== 'empathy' && !isStreamCard(m) && m.status !== 'streaming' && m.status !== 'failed';
const timeMs = (m: ChatMessage) => {
  const v = m.createdAt ? Date.parse(m.createdAt) : NaN;
  return Number.isFinite(v) ? v : 0;
};
/** 오름차순 배열에서 first >= target 인덱스 */
const lowerBound = (arr: number[], target: number) => {
  let lo = 0; let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
};

export function deriveQueueView(
  messages: ChatMessage[],
  streams: StreamingAnswer[] = [],
  queue: QueueItem[] = [],
  opts: { now?: number; stoppedMs?: number } = {},
): QueueView {
  const now = opts.now ?? Date.now();
  const stoppedMs = opts.stoppedMs ?? QUEUE_STOPPED_MS;

  const questions = messages.filter(isRootQuestion);
  if (!questions.length && !queue.some((q) => q.status === 'pending')) return EMPTY_VIEW;

  // 질문 경계(turnIndex)는 오름 가정(피드 정렬 규범) — 어긋난 입력 방어: 정렬 사본 사용
  const sortedQ = [...questions].sort((a, b) => a.turnIndex - b.turnIndex);
  const boundaries = sortedQ.map((q) => q.turnIndex);
  const answerTurns = messages.filter((m) => !m.parentMessageId && isFinalAnswer(m)).map((m) => m.turnIndex).sort((a, b) => a - b);
  const liveRuns = new Set(streams.filter((s) => !s.done).map((s) => s.runId));
  const liveCardTurns = messages
    .filter((m) => isStreamCard(m) && m.runId && liveRuns.has(m.runId))
    .map((m) => m.turnIndex)
    .sort((a, b) => a - b);

  const windowOf = (turn: number, idx: number) => ({ from: turn, to: idx + 1 < boundaries.length ? boundaries[idx + 1] : Infinity });
  const hasIn = (arr: number[], from: number, to: number) => {
    const i = lowerBound(arr, from);
    return i < arr.length && arr[i] < to;
  };

  type Seed = { msg?: ChatMessage; q?: QueueItem; arrivalMs: number; failed: boolean; live: boolean };
  const seeds: Seed[] = [];
  const matchedQueueIds = new Set<string>();

  sortedQ.forEach((q, idx) => {
    const { from, to } = windowOf(q.turnIndex, idx);
    const qItem = queueItemForMessage(queue, q);
    if (qItem) matchedQueueIds.add(qItem.id);
    // 해소 판정: 메시지 윈도우 내 확정 답변 ∪ 서버 큐 answered/skipped(서버 진실 우선, 구 메시지 스냅샷滞后 보완)
    const resolved = hasIn(answerTurns, from, to) || (!!qItem && qItem.status !== 'pending');
    if (resolved) return;
    const live = hasIn(liveCardTurns, from, to);
    const failed = q.pending !== true && q.status === 'failed';
    seeds.push({ msg: q, q: qItem, arrivalMs: timeMs(q), failed, live });
  });

  // 서버 큐에만 있는 pending(messages 미도착/미매칭 — 예: 다른 디바이스 발화) 행 보충
  for (const q of queue) {
    if (matchedQueueIds.has(q.id) || q.status !== 'pending') continue;
    seeds.push({ q, arrivalMs: 0, failed: false, live: false });
  }

  // 정렬: 서버 position 우선(있으면), 없으면 도착 시각→턴 순. position은 이 순서로 재채번(대기 번호).
  seeds.sort((a, b) => {
    if (a.q && b.q && a.q.position !== b.q.position) return a.q.position - b.q.position;
    if (a.arrivalMs !== b.arrivalMs) return a.arrivalMs - b.arrivalMs;
    return (a.msg?.turnIndex ?? -1) - (b.msg?.turnIndex ?? -1);
  });

  let answeringClaimed = false;
  let stoppedCount = 0;
  const items: QueueViewItem[] = seeds.map((s, i) => {
    const position = i + 1;
    // 멈춤: ① 전송 실패 행 ② 활성 런 없이 stoppedMs 넘게 정체 — 서버 큐 매칭 행이면 위치 무관,
    //    큐 미매칭은 선두만(후방 대기 행은 애초에 앞이 막혀 있어 정체 귀속 무의미 — 오탐 방지).
    const stuck = !s.live && !s.failed && s.arrivalMs > 0 && now - s.arrivalMs > stoppedMs && (!!s.q || position === 1);
    let status: QueueViewStatus;
    if (s.failed || stuck) status = 'stopped';
    else if (!answeringClaimed && (s.live || position === 1)) {
      // 답변 중 = 첫 스트림 소유 행, 스트림 없으면 선두(라우팅/처리 진행 중으로 본다)
      status = 'answering';
      answeringClaimed = true;
    } else status = 'waiting';
    if (status === 'stopped') stoppedCount += 1;
    return {
      id: s.msg?.id ?? s.q!.id,
      queueId: s.q?.id,
      text: (s.msg?.content || s.q?.content || '').trim(),
      status,
      failed: !!s.failed,
      position,
      fromServerQueue: !!s.q,
      arrivalMs: s.arrivalMs,
    };
  });

  const pendingCount = items.reduce((n, it) => n + (it.status === 'stopped' ? 0 : 1), 0);
  const waitingCount = items.reduce((n, it) => n + (it.status === 'waiting' ? 1 : 0), 0);
  return { items, pendingCount, stoppedCount, backlogCount: items.length, waitingCount };
}

/** 배지 톤 — 'none'=밀린 0건(배지 숨김), 'warn'=주황(답변 중+대기), 'stop'=빨강(멈춤 ≥1).
 *  숫자 = 전역 밀린 수(backlog): 대표님 규약 "pending 수 배지" + 운영 체킹 = 배지 0 확인. */
export function queueBadgeTone(v: QueueView): 'none' | 'warn' | 'stop' {
  if (v.backlogCount <= 0) return 'none';
  return v.stoppedCount > 0 ? 'stop' : 'warn';
}

export function queueBadgeCount(v: QueueView): number {
  return v.backlogCount;
}

/** 행의 대기 문구 키 — 바로 앞 행 상태(답변 중/대기/멈춤)를 실데이터로 보여준다.
 *  대기 행의 앞은 항상 미해답(선두는 answering 또는 stopped) — aheadWaiting은 앞이 다수 대기일 때. */
export function queueAheadKey(view: QueueView, item: QueueViewItem): 'queueView.aheadAnswering' | 'queueView.aheadWaiting' | 'queueView.aheadStopped' | undefined {
  if (item.status !== 'waiting' || item.position <= 1) return undefined;
  const ahead = view.items[item.position - 2];
  if (!ahead) return undefined;
  return ahead.status === 'answering' ? 'queueView.aheadAnswering'
    : ahead.status === 'stopped' ? 'queueView.aheadStopped' : 'queueView.aheadWaiting';
}

/** 대기 시간 포맷 — <60s 초, <60m 분, 그 외 시간 (i18n 단위 라벨 주입용, 상수 반환) */
export function queueWaitDurationUnit(ms: number): { key: 'queueView.unitSec' | 'queueView.unitMin' | 'queueView.unitHr'; value: number } {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return { key: 'queueView.unitSec', value: sec };
  const min = Math.floor(sec / 60);
  if (min < 60) return { key: 'queueView.unitMin', value: min };
  return { key: 'queueView.unitHr', value: Math.floor(min / 60) };
}
