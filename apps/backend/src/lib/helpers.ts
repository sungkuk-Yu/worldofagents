/**
 * 라우트 공용 도우미 — 소유권 검증, 페르소나 자동 생성, 세션 ensure.
 */
import { AgentsRow, SessionsRow, PersonasRow } from '../types/db';
import { DbClient } from './supabase';
import { ApiError, ERROR_CODES } from './errors';

/** 에이전트가 특정 사용자 소유인지 확인하고 반환 (없으면 404) */
export async function getOwnedAgent(db: DbClient, userId: string, agentId: string): Promise<AgentsRow> {
  const { data, error } = await db.from('agents').select('*').eq('id', agentId).eq('owner_id', userId).maybeSingle();
  if (error || !data) throw new ApiError(ERROR_CODES.AGENT_NOT_FOUND, '에이전트를 찾을 수 없습니다.', { agent_id: agentId });
  return data as AgentsRow;
}

/** 에이전트가 존재하는지(소유권 무관) 확인 */
export async function agentExists(db: DbClient, agentId: string): Promise<boolean> {
  const { data } = await db.from('agents').select('id').eq('id', agentId).maybeSingle();
  return Boolean(data);
}

/** 에이전트 기본 페르소나 자동 생성 (api-design.md §3.2 — 에이전트 생성 시) */
export async function createDefaultPersona(db: DbClient, agentId: string, agentName: string): Promise<PersonasRow> {
  const { data, error } = await db
    .from('personas')
    .insert({
      agent_id: agentId,
      version: 1,
      name: agentName,
      voice_config: { voice_id: 'alloy', speed: 1.0, pitch: 0, language: 'ko' },
      tone_config: { formality: 'friendly', emoji_usage: 'rare', sentence_length: 'medium', honorific_level: 3 },
      style_guide: {
        personality_traits: ['친근함', '꼼꼼함'],
        preferred_expressions: ['~할게요', '좋아요'],
        forbidden_expressions: [],
        example_responses: [{ user_input: '안녕', agent_response: '안녕하세요! 무엇을 도와드릴까요?' }],
      },
      neuron_overrides: {
        empathy: { warmth_delta: 0.2, allowed_prefixes: ['아', '그렇군요'] },
        answer: { formality_delta: 0.1 },
      },
      relationship_type: 'assistant',
      is_active: true,
    })
    .select()
    .single();
  if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '기본 페르소나 생성 실패', { detail: error.message });
  return data as PersonasRow;
}

/** 세션 ensure — (user_id, agent_id) 기존 세션 반환 or 신규 생성 (api-design.md §3.4) */
export async function ensureSession(db: DbClient, userId: string, agentId: string): Promise<SessionsRow> {
  // 에이전트 존재 + 활성 페르소나 확인
  const { data: agent } = await db.from('agents').select('*').eq('id', agentId).maybeSingle();
  if (!agent) throw new ApiError(ERROR_CODES.AGENT_NOT_FOUND, '에이전트를 찾을 수 없습니다.', { agent_id: agentId });

  const { data: persona } = await db
    .from('personas')
    .select('*')
    .eq('agent_id', agentId)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!persona) throw new ApiError(ERROR_CODES.NOT_FOUND, '에이전트에 활성 페르소나가 없습니다.');

  const { data: existing } = await db
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .maybeSingle();
  if (existing) return existing as SessionsRow;

  const { data, error } = await db
    .from('sessions')
    .insert({
      user_id: userId,
      agent_id: agentId,
      persona_id: (persona as PersonasRow).id,
      status: 'active',
      stream_channel_id: null,
      metadata: {},
    })
    .select()
    .single();

  if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '세션 생성 실패', { detail: error.message });
  return data as SessionsRow;
}

/** 세션 소유권 확인 + 반환 */
export async function getOwnedSession(db: DbClient, userId: string, sessionId: string): Promise<SessionsRow> {
  const { data, error } = await db.from('sessions').select('*').eq('id', sessionId).eq('user_id', userId).maybeSingle();
  if (error || !data) throw new ApiError(ERROR_CODES.SESSION_NOT_FOUND, '세션을 찾을 수 없습니다.', { session_id: sessionId });
  return data as SessionsRow;
}

/** 다음 turn_index 계산 */
export async function nextTurnIndex(db: DbClient, sessionId: string): Promise<number> {
  const { data } = await db.from('messages').select('turn_index').eq('session_id', sessionId).order('turn_index', { ascending: false }).limit(1).maybeSingle();
  return ((data as { turn_index?: number } | null)?.turn_index ?? -1) + 1;
}