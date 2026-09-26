import { config } from '../config';
import { Locale, PATIENCE_PLAN, patienceQuipAt, pickQuip, QuipKey } from './locale';
import { registerRun } from '../websocket/eventlog';
import { randomUUID } from 'node:crypto';
import { DbClient } from './supabase';
import { SessionsRow } from '../types/db';
import { processTurn, TurnResult, NeuronStage, ProcessTurnOptions } from '../neurons/graph';
import { rowToPersonaConfig } from './persona';
import { ApiError } from './errors';
import { ServerMessage, NEURON_NAMES } from '../websocket/protocol';

export type TurnEmitEvent = Extract<ServerMessage, { type: 'message.new' | 'run.started' | 'run.progress' | 'run.completed' | 'run.failed' | 'run.cancelled' | 'answer.delta' | 'answer.done' | 'neuron.status' | 'transcript.final' }>;

/** REST와 WS가 공유하는 상태 전이 및 확정 메시지 발행 경계. */
export async function runTextTurn(
  db: DbClient, session: SessionsRow, userId: string, content: string,
  opts: { locale?: Locale; thread?: ProcessTurnOptions['thread']; sttMetadata?: Record<string, unknown> | null; emit: (e: TurnEmitEvent) => void }
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
    const { data: persona, error } = await db.from('personas').select('*').eq('id', session.persona_id).maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', error.message);
    // 접수 문구는 페르소나 말투를 반영한다 (formal→빠릿하게(brisk), casual→캐주얼하게(playful)).
    personaTone = (persona as { tone_config?: Record<string, unknown> } | null)?.tone_config ?? null;
    opts.emit({ type: 'run.started', ...base, quip: quip('started') });
    const result = await processTurn(db, session.id, userId, session.agent_id, persona ? rowToPersonaConfig(persona) : null, content, {
      turnId,
      locale,
      thread: opts.thread,
      signal: abort.signal,
      sttMetadata: opts.sttMetadata,
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
    neuron_events: result.events,
    persona_guard_passed: result.guardPassed,
    engine: result.engine,
  };
}
