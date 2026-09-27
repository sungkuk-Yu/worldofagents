import { config } from '../config';
import { Locale, PATIENCE_PLAN, patienceQuipAt, pickQuip, QuipKey } from './locale';
import { registerRun, hasActiveRun } from '../websocket/eventlog';
import { randomUUID } from 'node:crypto';
import { DbClient } from './supabase';
import { assertAttachmentsOwned } from './attachments';
import { SessionsRow } from '../types/db';
import { processTurn, TurnResult, NeuronStage, ProcessTurnOptions } from '../neurons/graph';
import { rowToPersonaConfig } from './persona';
import { ApiError } from './errors';
import { ServerMessage, NEURON_NAMES } from '../websocket/protocol';
import { listQueue, markQueueStatus, queueSnapshot, skipAllPending } from './questionQueue';
import { deriveSessionTitle, sessionTitleOf, setSessionTitleIfEmpty } from './sessionTitle';

export type TurnEmitEvent = Extract<ServerMessage, { type: 'message.new' | 'run.started' | 'run.progress' | 'run.completed' | 'run.failed' | 'run.cancelled' | 'answer.delta' | 'answer.done' | 'neuron.status' | 'transcript.final' | 'queue.updated' }>;

/** REST와 WS가 공유하는 상태 전이 및 확정 메시지 발행 경계. */
export async function runTextTurn(
  db: DbClient, session: SessionsRow, userId: string, content: string,
  opts: { locale?: Locale; thread?: ProcessTurnOptions['thread']; sttMetadata?: Record<string, unknown> | null; attachmentIds?: string[]; answerLeadMs?: number; emit: (e: TurnEmitEvent) => void }
): Promise<TurnResult> {
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
    const { data: persona, error } = await db.from('personas').select('*').eq('id', session.persona_id).maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', error.message);
    // 접수 문구는 페르소나 말투를 반영한다 (formal→빠릿하게(brisk), casual→캐주얼하게(playful)).
    personaTone = (persona as { tone_config?: Record<string, unknown> } | null)?.tone_config ?? null;
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
      emitEvent: e => opts.emit({ type: 'neuron.status', session_id: session.id,
        neuron: { slug: e.neuron, name: NEURON_NAMES[e.neuron] || e.neuron }, status: e.status, stage: e.stage, quip: e.quip }),
      onAnswerDelta: (delta, index) => {
        partialText += delta;
        opts.emit({ type: 'answer.delta', ...base, delta, index });
      },
    });
    for (const message of [result.messages.user, result.messages.empathy, result.messages.answer]) {
      if (message) opts.emit({ type: 'message.new', ...base, message });
    }
    opts.emit({ type: 'answer.done', ...base, ai_generated: true, locale, text: result.answerResponse || '', message_id: result.answerMessageId,
      llm: { ...result.llm, usage: result.llm.usage ?? null }, grounding: result.grounding });
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
    neuron_events: result.events,
    persona_guard_passed: result.guardPassed,
    engine: result.engine,
  };
}
