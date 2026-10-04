// 내 질문 트래커 — 순수 파생 로직 (t_fd869e5b, 대표님 10/4 최종 지시).
// "오른쪽엔 볼트 노트가 아니라, 내가 한 질문들이 어떻게 돌아가는지 질문의 큐를 쓰레드 형식으로
//  보여주고, 큐가 어떻게 진행되는지 눈으로 보여주면 좋을거 같다. 비개발자들도 알기 쉽게."
// t_0e03e405 (대표님 10/4 재확인): "질문 현황 = 사용자가 직접 입력한 실제 질문만" — 확인응답
// ('예'/'아니요' 칩 탭·2.5s 자동예 기록)과 재질문(empathy)은 顶级 항목이 아니라 원 질문의
// '이해 확인 중' 단계로 흡수(확인 스레드화). 병합의 부수 효과로 ack 행이 끊던 질문 윈도우가 이어져
// 답변 진행이 원 질문에 정상 전파된다(11/12 부풀림·'14. 예' 노이즈 원봉인).
// 데이터 소스 원칙: 새 백엔드 API 없음 — 확정 messages(서버+낙관 행), WS 스냅샷 pendingReplies,
// 활성 streams, 서버 큐 스냅샷(queue.updated 우선·messages 로컬 유도 폴백)과 시간만으로 판정한다.
// 단계 (비개발자 문구, i18n tracker.stageN):
//   0 접수됨 → 1 이해 확인 중 → 2 답변 준비 중 → 3 완료
// 보조 상태: confirmed(서버 저장 vs 낙관 구분) / needsConfirm(예·아니오 재질문 대기 '확인 필요') /
//   failed(오류·타임아웃 → '다시 시도할게요' + 재발화 버튼) / replyCount(스레드 답글 수).
// 목록 폭발 방지: 완료 후 collapseMs(기본 24h) 지난 항목은 행을 접고 개수만 요약 노출.
import type { ChatMessage, PendingReplyItem, QueueItem, StreamingAnswer } from './chatLogic';
import { isStreamCard, queueItemForMessage } from './chatLogic';
import { confirmationLinks } from './ackChips';

export const TRACKER_STAGE_COUNT = 4;
export const TRACKER_DONE_COLLAPSE_MS = 24 * 60 * 60 * 1000;
/** 활성/최근 목록 상한 — 초과분(오래된 진행·완료 항목)은 collapsedDone에 합산 (목록 폭발 방지) */
export const TRACKER_MAX_ROWS = 12;

export interface TrackerRow {
  /** user 질문 카드 id — 탭 시 이 카드로 점프/하이라이트, 실패 시 재발화 대상 */
  messageId: string;
  text: string;
  /** 세션 내 질문 순번 (1부터, 상단 큐 스트립과 동일 번호 체계) */
  seq: number;
  /** 0 접수됨 / 1 이해 확인 중 / 2 답변 준비 중 / 3 완료 */
  stage: 0 | 1 | 2 | 3;
  /** 서버 저장 확인(접수 체크) — 낙관 행이면 false ('보내는 중' 표기) */
  confirmed: boolean;
  /** 전송 실패 — true면 stage 무시하고 오류 행 + 재발화 버튼 */
  failed: boolean;
  /** 예/아니오 재질문 대기 — '확인 필요' 강조 배지 */
  needsConfirm: boolean;
  /** 이 질문 기준 스레드 답글 수 (슬랙식 표시) */
  replyCount: number;
  /** 질문+후속 행 중 최신 활동 시각 (ms, 파싱 불가 시 0) */
  lastActivityMs: number;
}

export interface TrackerResult {
  /** 질문 발생 순(오름차순) — 렌더러는 최근 우선으로 뒤집어 쓴다 */
  rows: TrackerRow[];
  /** 24h 경과 완료 + 상한 초과로 접힌 항목 수 */
  collapsedDone: number;
}

const isRootQuestion = (m: ChatMessage) => m.role === 'user' && !m.parentMessageId;
const isEmpathy = (m: ChatMessage) => m.role === 'agent' && m.sourceNeuron === 'empathy';
/** 확정 답변 행: 에이전트·비감정·스트리밍 PLACEHOLDER 아님·인라인 스트림 카드 아님 */
const isFinalAnswer = (m: ChatMessage) =>
  m.role === 'agent' && !isEmpathy(m) && !isStreamCard(m) && m.status !== 'streaming' && m.status !== 'failed';
const timeMs = (m: ChatMessage) => {
  const v = m.createdAt ? Date.parse(m.createdAt) : NaN;
  return Number.isFinite(v) ? v : 0;
};

/**
 * messages(확정+낙관 행, turnIndex 오름)에서 질문별 현황 행을 만든다.
 * t_0e03e405 항목 정의: **사용자가 직접 입력한 실제 顶级 질문만** 행이 된다.
 *   - 확인응답 user 행(confirmationLinks: 구조 신호 reply_to→empathy 우선 + 백엔드 집합 정확-일치
 *     문장 + 연속 체인)은 원 질문의 하위 이벤트 — 별도 행 NOT, stage만 전진(요구1/2, 오탐 금지:
 *     empathy 없는 맨 발화 '예를 들어…'는 링크되지 않아 顶级 유지).
 *   - 재질문(empathy) 행/복창은 원 질문의 '이해 확인 중' 단계로 흡수(agent 행이라 원래 비계수;
 *     ack 병합으로 윈도우가 끊기지 않아 후속 답변이 원 질문에 귀속 → 단계 전파 봉인, 요구3).
 *   - seq는 필터 후 발생순 1..N 재채번 — '질문 수 = 顶级 질문 수' 불변식.
 * 윈도우 정의: [이 질문 turnIndex, 다음 顶级 질문 turnIndex) 내 비답글(parentMessageId 없음)
 * 에이전트 행이 그 질문의 처리 결과. 답글 체인은 메인 윈도우에서 제외(replyCount로만 반영).
 * 서버 큐 스냅샷(queue)이 매칭되면 상태를 우선시한다 (상단 스트립과 동일 2계층 원칙).
 */
export function buildQuestionTracker(
  messages: ChatMessage[],
  pendingReplies: PendingReplyItem[] = [],
  streams: StreamingAnswer[] = [],
  opts: { now?: number; collapseMs?: number; maxRows?: number; queue?: QueueItem[] } = {},
): TrackerResult {
  const now = opts.now ?? Date.now();
  const collapseMs = opts.collapseMs ?? TRACKER_DONE_COLLAPSE_MS;
  const maxRows = opts.maxRows ?? TRACKER_MAX_ROWS;
  const queue = opts.queue ?? [];

  // 확인응답 흡수 맵 (lib/ackChips — 렌더 스레드 프레임과 동일 원천. ack 행 id → 대상 empathy id)
  const links = confirmationLinks(messages);
  // empathy id → 그 확인응답 발화가 도착했나 (stage1 고착 방지: 해소 발화 = 진행)
  const ackedByEmpathy = new Set<string>(links.values());

  const questions = messages.filter((m) => isRootQuestion(m) && !links.has(m.id));
  const lastQuestionTurn = questions.length ? Math.max(...questions.map((q) => q.turnIndex)) : -1;
  // 활성 스트림은 '지금 마지막 질문의 런'에만 귀속 (useChatSession 런-턴 매핑과 동일 전제)
  const liveStream = streams.some((s) => !s.done);

  const rows: TrackerRow[] = [];
  let seq = 0;
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    seq += 1;
    const nextTurn = i + 1 < questions.length ? questions[i + 1].turnIndex : Infinity;
    const inWindow = messages.filter((m) => m !== q && m.turnIndex >= q.turnIndex && m.turnIndex < nextTurn && !m.parentMessageId);
    const empathy = inWindow.filter(isEmpathy);
    const answers = inWindow.filter(isFinalAnswer);
    const streamingRow = inWindow.some((m) => m.role === 'agent' && (m.status === 'streaming' || isStreamCard(m)));
    // pending 회신 대상은 user 질문/윈도우 내 에이전트 행 어느 쪽 id로도 올 수 있다 (t_811e176c 실측:
    // message_id = 회신을 요구한 agent 행) — 윈도우 전체 행과 대조한다.
    const pendingForWindow = pendingReplies.some((p) => p.messageId === q.id || inWindow.some((m) => m.id === p.messageId) || empathy.some((e) => e.id === p.messageId));

    const failed = q.pending !== true && q.status === 'failed';
    const confirmed = q.pending !== true && q.status !== 'pending';

    // 공감 재질문 해소 판정 2계층: ① 서버 reply.pending 스냅샷(pendingForWindow)이 남아있으면 '확인 필요'
    //    단, 확인응답(예/아니오)이 이미 발화됐으면 강등된 스냅샷보다 우선 — 해소 진행 (t_0e03e405).
    // ② 스냅샷 강등(011 미적용 등) 시 ackChips 후보 게이트 규칙 — 이 공감보다 늦은 user 발화가 없으면 미해소.
    const lastEmpathy = empathy.length ? empathy[empathy.length - 1] : null;
    const empathyUnresolved = !!lastEmpathy && !messages.some((m) => m.role === 'user' && m.turnIndex > lastEmpathy!.turnIndex);
    // '최근 empathy'가 확인응답으로 병합됐으면 = '확인 스레드' 해소 진행 (stage1 근거 소멸).
    // [e1][ack][e2]처럼 최신만 미확인인 경우 e2가 stage1 유지 — acked는 최신 empathy 기준.
    const acked = !!lastEmpathy && ackedByEmpathy.has(lastEmpathy.id);
    const confirmWaiting = empathy.length > 0 && (pendingForWindow || empathyUnresolved) && !acked;

    let stage: TrackerRow['stage'];
    if (answers.length > 0) stage = 3;
    else if (confirmWaiting) stage = 1; // 확인 대기 = 이해 확인 중
    else if (empathy.length > 0 || acked) stage = 2; // 재질문 해소(통과) = 답변 준비 중
    else if (streamingRow || (liveStream && q.turnIndex === lastQuestionTurn)) stage = 2;
    else stage = 0;
    // 서버 큐 우선: answered/skipped 확정 스냅샷이면 국지 추정을 완료로 올린다 (pending은 신뢰 불가 — 강등만 금지)
    const qItem: QueueItem | undefined = queueItemForMessage(queue, q);
    if (qItem && qItem.status !== 'pending' && stage < 3 && !failed) stage = 3;

    const replyCount = Math.max(
      q.threadReplyCount ?? 0,
      // 답글 + 확인 스레드 참여(ack 병합 행)는 replyCount에 합산하지 않는다 — 확인은 답글이 아니라 단계 진행
      messages.filter((m) => m.parentMessageId === q.id || (m.rootMessageId && m.rootMessageId === q.id && m !== q)).length,
    );
    const lastActivityMs = Math.max(timeMs(q), ...inWindow.map(timeMs), 0);
    const needsConfirm = (confirmWaiting && stage === 1) || (pendingForWindow && !acked && stage < 3);

    rows.push({
      messageId: q.id,
      text: q.content,
      seq,
      stage,
      confirmed,
      failed,
      needsConfirm,
      replyCount,
      lastActivityMs,
    });
  }

  // ④ 완료 후 24h 지난 항목 자동 축약 + 상한 초과분 접기 (오래된 것부터)
  let collapsedDone = 0;
  const kept: TrackerRow[] = [];
  for (const r of rows) {
    const staleDone = r.stage === 3 && !r.needsConfirm && r.lastActivityMs > 0 && now - r.lastActivityMs > collapseMs;
    if (staleDone) { collapsedDone += 1; continue; }
    kept.push(r);
  }
  if (kept.length > maxRows) {
    collapsedDone += kept.length - maxRows;
    return { rows: kept.slice(kept.length - maxRows), collapsedDone };
  }
  return { rows: kept, collapsedDone };
}
