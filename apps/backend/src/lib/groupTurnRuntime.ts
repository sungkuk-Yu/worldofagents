// 그룹채팅 P2 — 턴 런타임 (t_ecb8b951, 73c3d0c9 재구현)
// 발화≤6 · handoff≤2 · 토큰상한 예산 루프 + open|closed|halted 상태 연동 + 유사도 반복 차단.
// 초과 시 PM 요약 저장 후 사용자에게 반환(halted). handoff는 sequence 전용(D3 런타임 규칙).
// GROUP_TURN_DISPATCH 게이트 기본 OFF — 실전 배선은 routes/groupChat.ts.
import { textSimilarity } from './textSimilarity.js';
import { logger } from '../utils/logger.js';
import type { AgentEnvelope, BoundaryDb, RouteMode } from './groupChatContext.js';

export const DEFAULT_TURN_BUDGET = { maxUtterances: 6, maxHandoffs: 2, tokenCap: 2500 } as const;

function envInt(name: string, def: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : def;
}

export interface TurnBudget { maxUtterances: number; maxHandoffs: number; tokenCap: number }

export function turnBudget(): TurnBudget {
  return {
    maxUtterances: envInt('GROUP_TURN_MAX_UTTERANCES', DEFAULT_TURN_BUDGET.maxUtterances),
    maxHandoffs: envInt('GROUP_TURN_MAX_HANDOFFS', DEFAULT_TURN_BUDGET.maxHandoffs),
    tokenCap: envInt('GROUP_TURN_TOKEN_CAP', DEFAULT_TURN_BUDGET.tokenCap),
  };
}

export function dispatchEnabled(): boolean {
  return process.env.GROUP_TURN_DISPATCH === 'true';
}

export type TurnStopReason = 'closed' | 'budget_utterances' | 'budget_handoffs' | 'budget_tokens' | 'repetition';

export interface SpeakContext {
  envelope: AgentEnvelope | null;
  spoken: { agent_id: string; text: string }[];
}

export interface SpeakResult {
  text: string;
  /** 후속 발화 요청 대상(에이전트 id 또는 이름 — sequence 전용, 이름 폴백 파싱). */
  pass_to?: string | null;
  tokens?: number; // 이 발화의 토큰 소비(chat usage 합산)
}

export interface SummarizeInput {
  reason: TurnStopReason;
  utterances: { agent_id: string; text: string }[];
}

export interface RunTurnInput {
  roomId: string;
  ownerId: string;
  turnId: string;
  anchorMessageId: string;
  mode: RouteMode;
  envelopes: AgentEnvelope[]; // responder당 1건, sequence면 responders 순
  agentIds: Set<string>; // handoff 유효 후보(방 agent 멤버)
  agentNames?: Record<string, string>; // 이름→id 폴백 매핑
  speak: (agentId: string, ctx: SpeakContext) => Promise<SpeakResult>;
  summarize: (input: SummarizeInput) => Promise<{ text: string; tokens: number }>;
  budget?: TurnBudget;
  similarityThreshold?: number; // 기본 0.7 (textSimilarity 2-gram Dice)
}

export interface RunTurnResult {
  status: 'closed' | 'halted';
  stop_reason: TurnStopReason;
  utterances: number;
  handoffs: number;
  tokens: number;
  messages: any[]; // 저장된 에이전트 발화 행
  summary: string | null;
}

interface QueueItem { agent_id: string; envelope: AgentEnvelope | null; handoffs: string[] }

/**
 * 턴 예산 루프 실행. 반환 전 group_turns 상태를 closed|halted + closed_at으로 반영한다.
 * 발화 저장 → 상태 연동 → 반복 유사도 ≥ 임계면 미저장 halted(repetition).
 */
export async function runAgentTurns(db: BoundaryDb, input: RunTurnInput): Promise<RunTurnResult> {
  const budget = input.budget ?? turnBudget();
  const threshold = input.similarityThreshold ?? 0.7;
  const envByAgent = new Map(input.envelopes.map((e) => [e.agent_id, e]));
  const queue: QueueItem[] = input.envelopes.map((e) => ({ agent_id: e.agent_id, envelope: e, handoffs: [] }));

  const spoken: { agent_id: string; text: string }[] = [];
  const messages: any[] = [];
  let utterances = 0, handoffs = 0, tokens = 0;
  let stop: TurnStopReason = 'closed';

  const persistTurn = async (status: 'open' | 'closed' | 'halted', closed: boolean) => {
    const patch: Record<string, unknown> = { utterance_count: utterances, handoff_count: handoffs, token_count: tokens, status };
    if (closed) patch.closed_at = new Date().toISOString();
    const { error } = await db.from('group_turns').update(patch).eq('id', input.turnId);
    if (error) throw new Error(`group_turns state update failed: ${error.message ?? error}`);
  };

  const nameToId = new Map<string, string>();
  for (const [name, id] of Object.entries(input.agentNames ?? {})) nameToId.set(name.toLowerCase(), id);
  const resolveAgent = (raw: string): string | null => {
    const v = raw.trim();
    if (input.agentIds.has(v)) return v;
    return nameToId.get(v.toLowerCase()) ?? null;
  };

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (utterances >= budget.maxUtterances) { stop = 'budget_utterances'; break; }
    if (tokens >= budget.tokenCap) { stop = 'budget_tokens'; break; }

    const res = await input.speak(item.agent_id, { envelope: item.envelope, spoken });
    const text = String(res.text ?? '').trim();
    tokens += res.tokens ?? 0;

    // 높은 유사도 발화 차단 — 저장하지 않고 halted(repetition)
    if (text) {
      const dup = spoken.some((s) => textSimilarity(text, s.text) >= threshold);
      if (dup) {
        stop = 'repetition';
        if (tokens > budget.tokenCap) await persistTurn('open', false);
        break;
      }
    }

    let saved: any = null;
    if (text) {
      const passRaw = res.pass_to ? String(res.pass_to).trim() : null;
      const passTo = passRaw ? resolveAgent(passRaw) : null;
      // handoff는 sequence 전용(D3). 실행 승인 여부로 저장 라벨을 결정 — 미실행 'handoff' 기록 금지.
      const eligible = !!passTo && input.mode === 'sequence' && passTo !== item.agent_id
        && !queue.some((q) => q.agent_id === passTo);
      const accepted = eligible && handoffs < budget.maxHandoffs;
      const { data, error } = await db.from('group_messages').insert({
        room_id: input.roomId,
        turn_id: input.turnId,
        parent_id: item.envelope?.anchor.parent_id ?? item.envelope?.anchor.id ?? input.anchorMessageId,
        author_type: 'agent',
        author_id: item.agent_id,
        content: text,
        kind: accepted ? 'handoff' : 'text',
        mentions: accepted ? [passTo!] : [],
      }).select().single();
      if (error) throw new Error(`group agent utterance save failed: ${error.message ?? error}`);
      saved = data;
      messages.push(saved);
      spoken.push({ agent_id: item.agent_id, text });
      utterances += 1;
      await persistTurn('open', false); // 진행 중 카운터 라이브 반영

      if (eligible && !accepted) { stop = 'budget_handoffs'; break; }
      if (accepted) {
        handoffs += 1;
        queue.push({
          agent_id: passTo!,
          envelope: envByAgent.get(passTo!) ?? null,
          handoffs: [text], // 승인된 선행 발화만 전달 원문으로(D3)
        });
      }
    }

    if (tokens > budget.tokenCap) { stop = 'budget_tokens'; break; }
  }

  let summary: string | null = null;
  const halted = stop !== 'closed';
  if (halted) {
    // 초과 정지 → PM 요약 저장 후 사용자 반환
    const s = await input.summarize({ reason: stop, utterances: spoken });
    summary = String(s.text ?? '').trim();
    tokens += s.tokens ?? 0;
    if (summary) {
      const { error } = await db.from('group_messages').insert({
        room_id: input.roomId,
        turn_id: input.turnId,
        parent_id: input.anchorMessageId,
        author_type: 'user',
        author_id: input.ownerId,
        content: summary,
        kind: 'summary',
        mentions: [],
      });
      if (error) throw new Error(`PM summary save failed: ${error.message ?? error}`);
    }
  }
  await persistTurn(halted ? 'halted' : 'closed', true);
  logger.info({
    evt: 'group_turn_runtime', room_id: input.roomId, turn_id: input.turnId,
    status: halted ? 'halted' : 'closed', stop_reason: stop,
    utterances, handoffs, tokens, summary_chars: summary ? summary.length : 0,
  }, 'group_turn_finished');
  return { status: halted ? 'halted' : 'closed', stop_reason: stop, utterances, handoffs, tokens, messages, summary };
}
