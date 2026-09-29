import { config } from '../config';
import { Locale, PATIENCE_PLAN, patienceQuipAt, pickQuip, QuipKey } from './locale';
import { RelayCurtain, relayStageForEvent } from './relay';
import type { RelayStage } from './relay';
import { registerRun, hasActiveRun } from '../websocket/eventlog';
import { randomUUID } from 'node:crypto';
import { DbClient } from './supabase';
import { assertAttachmentsOwned } from './attachments';
import { SessionsRow, MessagesRow } from '../types/db';
import { processTurn, TurnResult, NeuronStage, ProcessTurnOptions } from '../neurons/graph';
import { rowToPersonaConfig } from './persona';
import { ApiError } from './errors';
import { serializeMessage } from './helpers';
import { ServerMessage, NEURON_NAMES } from '../websocket/protocol';
import { listQueue, markQueueStatus, queueSnapshot, skipAllPending } from './questionQueue';
import { findExistingByClientReqId } from './idempotency';
import { resolvePendingReplies, replyPendingSnapshot } from './awaitingReply';
import { deriveSessionTitle, sessionTitleOf, setSessionTitleIfEmpty } from './sessionTitle';

export type TurnEmitEvent = Extract<ServerMessage, { type: 'message.new' | 'run.started' | 'run.progress' | 'run.completed' | 'run.failed' | 'run.cancelled' | 'answer.delta' | 'answer.done' | 'neuron.status' | 'transcript.final' | 'queue.updated' | 'relay.updated' | 'reply.pending.updated' }>;

/** 텍스트 전송 턴의 멱등 재사용 결과 (t_3486b1d7 ①): 같은 client_req_id 재전송이 사전 조회로
 *  기존 user 행을 찾았을 때의 반환형. deduped=true면 턴을 실행하지 않았다(추가 이벤트 0건). */
export interface IdempotentTurnResult extends TurnResult {
  deduped: true;
}

/** REST와 WS가 공유하는 상태 전이 및 확정 메시지 발행 경계. */
export async function runTextTurn(
  db: DbClient, session: SessionsRow, userId: string, content: string,
  opts: { locale?: Locale; thread?: ProcessTurnOptions['thread']; sttMetadata?: Record<string, unknown> | null; attachmentIds?: string[]; answerLeadMs?: number; clientReqId?: string | null; emit: (e: TurnEmitEvent) => void }
): Promise<TurnResult | IdempotentTurnResult> {
  const locale = opts.locale ?? config.defaultLocale;
  const turnId = randomUUID();
  const base = { session_id: session.id, run_id: turnId };
  let completed = false;
  let processing = false;
  let lastStage: NeuronStage | undefined;
  let partialText = '';
  // 페르소나 말투(quip tone)가 로드되기 전 문구는 기본 warm으로 나간다.
  let personaTone: Record<string, unknown> | null = null;
  const quip = (key: QuipKey) => pickQuip(key, locale, personaTone);
  const abort = new AbortController();
  // 첨부 선검증 (t_401c5bd1): 소유권 없는 attachment_ids로 고아 user 메시지/LLM 비용이 남지 않게
  // 턴 저장·실행 전에 실패시킨다. WS message.send/REST sendMessage/replies 공통 경로.
  if (opts.attachmentIds?.length) await assertAttachmentsOwned(db, userId, opts.attachmentIds);
  const unregister = registerRun(session.id, { runId: turnId, abort, partial: () => partialText });
  let failure = { code: 'INTERNAL_ERROR', message: '턴 처리 중 오류가 발생했습니다.' };
  // 지연 진행도 티커: patienceMs 이후 "확인 중→거의 다 됨" 2회까지 이어 붙이고 그 뒤 정지한다.
  const startedAt = Date.now();
  let quipTick = 0;
  const patience = setInterval(() => {
    if (completed || Date.now() - startedAt < config.quipPatienceMs) return;
    const step = patienceQuipAt(quipTick);
    if (step) {
      lastStage = step.stage;
      opts.emit({ type: 'run.progress', ...base, stage: step.stage, quip: quip(step.quip) });
    }
    if (++quipTick >= PATIENCE_PLAN.length) clearInterval(patience);
  }, config.quipPatienceMs);
  try {
    if (session.user_id !== userId) throw new ApiError('FORBIDDEN', '세션 소유자만 메시지를 보낼 수 있습니다.');
    if (session.status === 'archived') throw new ApiError('SESSION_ARCHIVED', '아카이브된 세션입니다.');
    // random_id 멱등 사전 조회 (t_3486b1d7 ①, core.telegram.org/method/messages.sendMessage):
    // 재연결·재전송으로 같은 client_req_id가 다시 들어오면 run 이벤트·user/answer 행을 추가로
    // 만들지 않고 기존 user 행을 돌려준다(프론트는 같은 카드를 in-place 유지). insert의
    // 유니크 인덱스(012)가 2차 방패 — 레이스로 뚫리면 graph가 CONFLICT로 마감한다.
    // run.started 이전 위치: quip fake-timer 이벤트 순서 계약 보존(추가 이벤트 0건으로 종료).
    const prior = await findExistingByClientReqId(db, session.id, opts.clientReqId ?? null);
    if (prior) {
      completed = true; // finally의 run.failed 보장·드레인 트리거 우회 (턴을 실행한 적 없음)
      return buildDedupedResult(prior);
    }
    // 세션 제목 자동 채움 (t_cc52fd4f ③, 대표님 9/28): 첫 사용자 메시지 요약 — 캐논 title
    // 컬럼·metadata.title 모두 비어 있는 세션에만, WHERE title IS NULL 가드로 원-라운드트립
    // 선착 세팅(동시 첫 턴 레이스 안전). 실패해도 턴을 오염시키지 않는다(목록은 폴백 규칙 유지).
    // REST sendMessage / WS message.send / PTT 트랜스크립트 / 큐 드레인 전 경로가 이 결절점 통과.
    if (!sessionTitleOf(session)) {
      const derived = deriveSessionTitle(content);
      if (derived) {
        session.title = derived; // 이 run 내 재세팅 방지 (동일 객체 재호출 대비)
        await setSessionTitleIfEmpty(db, session.id, derived).catch(() => undefined);
      }
    }
    // 답변 대기 (t_811e176c) — 발화 = 회신: 이전 미해소 pending 해소 체인을 여기서 시작하되
    // await는 배지 발행 직전으로 미룬다 (run.started 이전 대기 홉 추가 = fake-timer 테스트
    // 파손 — 기존 이벤트 타이밍 계약 보존). 배지 스냅샷은 아래에서 이번 턴 답변 판정과
    // 합쳐 한 번만 낸다(두 전이 1이벤트).
    const resolvingPending = resolvePendingReplies(db, session.id);
    const { data: persona, error } = await db.from('personas').select('*').eq('id', session.persona_id).maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', error.message);
    // 접수 문구는 페르소나 말투를 반영한다 (formal→빠릿하게(brisk), casual→캐주얼하게(playful)).
    personaTone = (persona as { tone_config?: Record<string, unknown> } | null)?.tone_config ?? null;
    // 비서실 백스테이지 릴레이 자막 (t_583d9fed 案1, 대표님 9/28 "일단 a이고"): relationship_type='secretary'
    // 페르소나의 턴에서만 뉴런 릴레이 실체를 자막으로 노출한다. 최종 답변은 기존 계약대로 하나의 통합 메시지(B1)이고,
    // channels/메시지 마이그레이션은 없다. 비서 외 페르소나에서는 이벤트가 0건 — 기존 흐름과 1:1 동일.
    const isSecretaryTurn = (persona as { relationship_type?: string } | null)?.relationship_type === 'secretary';
    const relayCurtain = new RelayCurtain(locale);
    const emitRelay = (stage: RelayStage) => {
      if (!isSecretaryTurn) return;
      const text = relayCurtain.advance(stage);
      if (text !== null) opts.emit({ type: 'relay.updated', ...base, stage, quip: text });
    };
    opts.emit({ type: 'run.started', ...base, quip: quip('started') });
    // ① 짧은 확인음 (t_344e047a, 대표님 9/28 정정): 공감 복명복창을 대체하는 "예/아니오"
    // 수준 확인음을 접수 직후 run.progress(stage=thinking, 계약 코드 유지)로 내보낸다.
    // 공감 노드는 계속 동작하며(생성·neuron.status·DB 기록 유지), UI 노출만 최소화한다.
    // lastStage 선점: empathy 노드의 thinking 전환과 동일 stage 코드이므로 dedup되어
    // ack 확인음이 thinking 진행도 1회를 대체한다 (run.started→run.progress(ack)→…계약, t_344e047a).
    lastStage = 'thinking';
    opts.emit({ type: 'run.progress', ...base, stage: 'thinking', quip: quip('ack') });
    const result = await processTurn(db, session.id, userId, session.agent_id, persona ? rowToPersonaConfig(persona) : null, content, {
      turnId,
      locale,
      thread: opts.thread,
      signal: abort.signal,
      sttMetadata: opts.sttMetadata,
      attachmentIds: opts.attachmentIds,
      // random_id 멱등 — 012 적용+플래그 on 시에만 user 행에 stamp.
      clientReqId: opts.clientReqId ?? null,
      // ① 답변 스트리밍 전 체감 공백(기본 config.answerLeadMs=3000). 취소·0 통과.
      answerLeadMs: opts.answerLeadMs,
      onTurnStatus: (status, extra) => {
        // 완료/실패는 확정 메시지 발행 이후 이 실행기에서 한 번만 전송한다.
        if (status !== 'processing') return;
        processing = true;
        const stage = extra?.stage || 'thinking';
        if (lastStage === stage) return;
        lastStage = stage;
        opts.emit({ type: 'run.progress', ...base, stage, quip: quip(stage) });
      },
      emitEvent: e => {
        opts.emit({ type: 'neuron.status', session_id: session.id,
          neuron: { slug: e.neuron, name: NEURON_NAMES[e.neuron] || e.neuron }, status: e.status, stage: e.stage, quip: e.quip });
        const relayStage = relayStageForEvent(e);
        if (relayStage) emitRelay(relayStage);
      },
      // ④ answer.delta 백프레셔 (t_3486b1d7) — 300ms 또는 150자 whichever-first 배칭.
      // deltaBatchMs=0이면 기존처럼 토큰마다 즉시 emit(테스트 기본).
      onAnswerDelta: (() => {
        const batchMs = config.protocol.deltaBatchMs;
        const batchChars = config.protocol.deltaBatchChars;
        if (batchMs <= 0) return (d: string, i: number) => { partialText += d; opts.emit({ type: 'answer.delta', ...base, delta: d, index: i }); };
        let buffer = '';
        let pending: ReturnType<typeof setTimeout> | null = null;
        let deltaIndex = 0;
        const flush = () => {
          if (!buffer) return;
          const d = buffer;
          buffer = '';
          opts.emit({ type: 'answer.delta', ...base, delta: d, index: deltaIndex++ });
        };
        return (d: string, _i: number) => {
          partialText += d;
          buffer += d;
          if (buffer.length >= batchChars) { if (pending) { clearTimeout(pending); pending = null; } flush(); return; }
          if (!pending) pending = setTimeout(() => { pending = null; flush(); }, batchMs);
        };
      })(),
    });
    for (const message of [result.messages.user, result.messages.empathy, result.messages.answer]) {
      // serializeMessage: devstore 기본값 미충족·011 이전 행의 awaiting_reply를 false로 정규화
      // (WS message.new = REST 히스토리 동일 형상 계약).
      if (message) opts.emit({ type: 'message.new', ...base, message: serializeMessage(message) });
    }
    // 비서실 마무리·종료 비트 — 커튼이 단조 증가만 허용하므로 visual이 먼저 'wrapping'을 받은
    // 턴은 dedup된다. run.completed는 항상 마지막 이벤트로 남긴다(phase2-contract 계약).
    emitRelay('wrapping');
    opts.emit({ type: 'answer.done', ...base, ai_generated: true, locale, text: result.answerResponse || '', message_id: result.answerMessageId,
      llm: { ...result.llm, usage: result.llm.usage ?? null }, grounding: result.grounding });
    // 답변 대기 (t_811e176c) — 해소/감지 전이가 있었을 때만 스냅샷 발행(매 턴 노이즈 금지).
    // run.completed 뒤에 내지 않는 이유: events.at(-1)=run.completed 계약이 기존 단위테스트
    // ·프론트 종료 처리가 의존한다. 프론트는 이벤트 순서 무관(전용 리스너).
    const resolvedPending = await resolvingPending;
    if (resolvedPending > 0 || result.replyRequest) {
      const snap = await replyPendingSnapshot(db, session.id);
      if (snap) opts.emit({ type: 'reply.pending.updated', ...base, ...snap });
    }
    emitRelay('done');
    opts.emit({ type: 'run.completed', ...base,
      structured: { dialogue_type: result.structured.dialogue_type, structured_payload: result.structured.structured_payload },
      classifier: { type: result.dialogueType, stage: result.dialogueStage, confidence: result.dialogueConfidence },
      message_ids: { user: result.userMessageId, empathy: result.empathyMessageId, answer: result.answerMessageId }, llm: result.llm,
      grounding: result.grounding });
    completed = true;
    return result;
  } catch (err: any) {
    if (err?.code === 'RUN_CANCELLED') {
      completed = true;
      opts.emit({ type: 'run.cancelled', ...base, partial_text: partialText });
    }
    failure = { code: err?.code || 'INTERNAL_ERROR', message: err?.message || failure.message };
    throw err;
  } finally {
    clearInterval(patience);
    unregister();
    // WS message.send를 포함한 모든 호출 경로에서 실패 종료를 보장한다.
    if (!completed) {
      if (!processing) opts.emit({ type: 'run.progress', ...base, stage: 'thinking', quip: quip('thinking') });
      opts.emit({ type: 'run.failed', ...base, error: failure });
    }
    // ② run 완료 후 세션 큐 순차 처리 (t_344e047a). unregister 이후라 hasActiveRun이 정확하다.
    // 워커 실패가 응답 경계를 오염시키지 않게 fire-and-forget (드레인 내 실패는 skipped로 표시).
    if (completed) void drainSessionQueue(db, session.id, userId, opts.emit).catch(() => undefined);
  }
}

// ── ② 질문 큐 워커 (t_344e047a) ──────────────────────────────────
// 드레인 재귀 방지: 세션별 활성 드레인 1개. 드레인 중 실행된 턴의 완료 체인은
// 플래그 때문에 즉시return하고, 도는 루프가 새 pending을 다음 iteration에서 주운다.
const drainingSessions = new Set<string>();

/**
 * 완료된 run의 후속 처리: 세션 큐의 pending을 position 순서로 하나씩 답변한다.
 * 실행이 이미 활성화되어 있으면(다른 발화가 앞섬) 나가되 행은 pending으로 남아
 * 그 실행의 완료 체인이 이어받는다 — 유실 없음.
 */
export async function drainSessionQueue(
  db: DbClient, sessionId: string, userId: string, emit: (e: TurnEmitEvent) => void
): Promise<void> {
  if (drainingSessions.has(sessionId)) return;
  drainingSessions.add(sessionId);
  try {
    let round = 0;
    for (;;) {
      if (hasActiveRun(sessionId)) return; // 새 실행이 끼어들면 그 실행의 완료 체인이 드레인을 이어받는다
      const all = await listQueue(db, sessionId);
      const pending = all.filter(i => i.status === 'pending');
      if (!pending.length) return;
      const { data: session } = await db.from('sessions').select('*').eq('id', sessionId).maybeSingle();
      if (!session || (session as SessionsRow).status === 'archived') {
        // 아카이브/소멸 세션: 미답변을 체크포인트 'skipped'로 마감 (유실 아님, 보이게).
        await skipAllPending(db, sessionId);
        emit({ type: 'queue.updated', session_id: sessionId, ...queueSnapshot(await listQueue(db, sessionId)) });
        return;
      }
      const item = pending[0];
      try {
        await runTextTurn(db, session as SessionsRow, userId, item.content, { locale: item.locale, emit });
        await markQueueStatus(db, item.id, 'answered');
      } catch {
        // 실패도 체크포인트에 남긴다 — 대답 안 한 것이 보이게 (유실과 구분).
        await markQueueStatus(db, item.id, 'skipped').catch(() => undefined);
      }
      emit({ type: 'queue.updated', session_id: sessionId, ...queueSnapshot(await listQueue(db, sessionId)) });
      // 라운드 캡 초과 잔량은 다음 발화/완료 체인이 이어받는다 (무한 루프 방패).
      if (++round >= config.questionQueue.maxBatch) return;
    }
  } finally {
    drainingSessions.delete(sessionId);
  }
}


/** 멱등 재사용 응답 조립 (t_3486b1d7 ①) — 재실행 없이 기존 user 행으로 TurnResult 형상을 만든다.
 *  실행 이력이 없는 재구성이라 llm/structured/events는 중립값; 프론트는 user_message_id와
 *  messages.user만 읽는다 (deduped 플래그로 REST/WS 모두 새 run으로 취급하지 않는다). */
function buildDedupedResult(prior: MessagesRow): IdempotentTurnResult {
  return {
    deduped: true,
    turnId: prior.id,
    llm: { used: false, model: null, fallback: false },
    messages: { user: prior, empathy: null, answer: null },
    userMessageId: prior.id,
    empathyMessageId: null,
    answerMessageId: null,
    empathyResponse: null,
    answerResponse: prior.content,
    structured: { dialogue_type: 'text', structured_payload: (prior.structured_payload ?? {}) as Record<string, unknown>, classifier: 'rules' },
    suggestedQuestions: [],
    replyRequest: null,
    dialogueType: 'information',
    dialogueStage: 3,
    dialogueConfidence: 0,
    grounding: null,
    activationPlan: { activate: [], reason: 'idempotent-replay', dialogueType: 'information' },
    events: [],
    guardPassed: true,
    engine: 'simple',
  };
}

/** 텍스트 전송 REST 응답을 스레드와 일반 대화에서 공유한다. */
export function textTurnResponse(result: TurnResult) {
  return {
    locale: result.messages.user.locale,
    ai_generated: true,
    run_id: result.turnId,
    turn_id: result.turnId,
    llm: result.llm,
    structured: result.structured,
    messages: result.messages,
    user_message_id: result.userMessageId,
    empathy_message_id: result.empathyMessageId,
    answer_message_id: result.answerMessageId,
    empathy_response: result.empathyResponse,
    answer_response: result.answerResponse,
    dialogue_type: result.dialogueType,
    /** 판별 신뢰도 공개 계약 (t_56498848) — stage: 1=패턴 2=LLM 3=폴백/수동 */
    classifier: { type: result.dialogueType, stage: result.dialogueStage, confidence: result.dialogueConfidence },
    grounding: result.grounding,
    activation_plan: result.activationPlan,
    suggested_questions: result.suggestedQuestions,
    /** 답변 대기 (t_811e176c) — 감지 시 {kind, excerpt}, 없으면 null. 행은 awaiting_reply=true. */
    reply_request: result.replyRequest,
    neuron_events: result.events,
    persona_guard_passed: result.guardPassed,
    engine: result.engine,
  };
}
