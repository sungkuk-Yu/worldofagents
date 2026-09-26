import { registerRun } from '../websocket/eventlog';
import { randomUUID } from 'node:crypto';
import { DbClient } from './supabase';
import { SessionsRow } from '../types/db';
import { processTurn, TurnResult, NeuronStage, ProcessTurnOptions } from '../neurons/graph';
import { rowToPersonaConfig } from './persona';
import { ApiError } from './errors';
import { ServerMessage, NEURON_NAMES } from '../websocket/protocol';

export type TurnEmitEvent = Extract<ServerMessage, { type: 'message.new' | 'run.started' | 'run.progress' | 'run.completed' | 'run.failed' | 'run.cancelled' | 'answer.delta' | 'answer.done' | 'neuron.status' | 'transcript.final' }>;

const quips: Record<NeuronStage, string> = {
  thinking: '잠깐만요, 생각해볼게요…',
  organizing: '답변을 정리하고 있어요',
  finalizing: '거의 다 됐어요',
  rendering: '표현을 다듬고 있어요',
};

/** REST와 WS가 공유하는 상태 전이 및 확정 메시지 발행 경계. */
export async function runTextTurn(
  db: DbClient, session: SessionsRow, userId: string, content: string,
  opts: { thread?: ProcessTurnOptions['thread']; sttMetadata?: Record<string, unknown> | null; emit: (e: TurnEmitEvent) => void }
): Promise<TurnResult> {
  const turnId = randomUUID();
  const base = { session_id: session.id, run_id: turnId };
  let completed = false;
  let processing = false;
  let lastStage: NeuronStage | undefined;
  let partialText = '';
  const abort = new AbortController();
  const unregister = registerRun(session.id, { runId: turnId, abort, partial: () => partialText });
  let failure = { code: 'INTERNAL_ERROR', message: '턴 처리 중 오류가 발생했습니다.' };
  try {
    opts.emit({ type: 'run.started', ...base, quip: '접수했어요. 바로 살펴볼게요' });
    if (session.user_id !== userId) throw new ApiError('FORBIDDEN', '세션 소유자만 메시지를 보낼 수 있습니다.');
    if (session.status === 'archived') throw new ApiError('SESSION_ARCHIVED', '아카이브된 세션입니다.');
    const { data: persona, error } = await db.from('personas').select('*').eq('id', session.persona_id).maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', error.message);
    const result = await processTurn(db, session.id, userId, session.agent_id, persona ? rowToPersonaConfig(persona) : null, content, {
      turnId,
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
        opts.emit({ type: 'run.progress', ...base, stage, quip: quips[stage] });
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
    opts.emit({ type: 'answer.done', ...base, text: result.answerResponse || '', message_id: result.answerMessageId,
      llm: { ...result.llm, usage: result.llm.usage ?? null } });
    opts.emit({ type: 'run.completed', ...base,
      structured: { dialogue_type: result.structured.dialogue_type, structured_payload: result.structured.structured_payload },
      message_ids: { user: result.userMessageId, empathy: result.empathyMessageId, answer: result.answerMessageId }, llm: result.llm });
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
    unregister();
    // WS message.send를 포함한 모든 호출 경로에서 실패 종료를 보장한다.
    if (!completed) {
      if (!processing) opts.emit({ type: 'run.progress', ...base, stage: 'thinking', quip: quips.thinking });
      opts.emit({ type: 'run.failed', ...base, error: failure });
    }
  }
}


/** 텍스트 전송 REST 응답을 스레드와 일반 대화에서 공유한다. */
export function textTurnResponse(result: TurnResult) {
  return {
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
    activation_plan: result.activationPlan,
    neuron_events: result.events,
    persona_guard_passed: result.guardPassed,
    engine: result.engine,
  };
}
