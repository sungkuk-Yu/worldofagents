import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ApiError, badRequest, ok } from '../lib/errors';
import { routePmTurn } from '../lib/pmRouter';
import { buildAgentEnvelopes } from '../lib/groupChatContext';
import { dispatchEnabled, runAgentTurns, type SpeakContext } from '../lib/groupTurnRuntime';
import { chatCompletion } from '../lib/llm';

const KINDS = ['text', 'form', 'question', 'handoff', 'summary'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ownedRoom(db: any, ownerId: string, roomId: string) {
  const { data, error } = await db.from('group_rooms').select('*').eq('id', roomId).eq('owner_id', ownerId).maybeSingle();
  if (error || !data) throw new ApiError('NOT_FOUND', '그룹방을 찾을 수 없습니다.');
  return data;
}

export async function groupChatRoutes(app: FastifyInstance) {
  app.post('/', { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body as { name?: unknown; members?: unknown };
    const members = Array.isArray(body?.members) ? body.members as { type?: unknown; id?: unknown }[] : [];
    if (members.length < 1 || members.length > 5) throw badRequest('멤버는 사용자 포함 2~6명이어야 합니다.');
    const normalized = [{ type: 'user', id: req.userId }, ...members];
    if (normalized.some(m => !['user', 'agent'].includes(String(m.type)) || typeof m.id !== 'string' || !UUID.test(m.id))) throw badRequest('멤버 형식이 올바르지 않습니다.');
    const keys = new Set(normalized.map(m => `${m.type}:${m.id}`));
    if (keys.size !== normalized.length || normalized.some(m => m.type === 'user' && m.id !== req.userId)) throw badRequest('멤버가 중복되었거나 본인 외 사용자를 포함했습니다.');
    const agents = normalized.filter(m => m.type === 'agent').map(m => m.id as string);
    if (agents.length) {
      const { data, error } = await req.db.from('agents').select('id').eq('owner_id', req.userId).in('id', agents);
      if (error || (data || []).length !== agents.length) throw badRequest('소유하지 않은 에이전트가 포함되었습니다.');
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : `그룹 ${new Date().toLocaleDateString('ko-KR')}`;
    const { data: room, error } = await req.db.from('group_rooms').insert({ owner_id: req.userId, name }).select().single();
    if (error || !room) throw new ApiError('INTERNAL_ERROR', '그룹방 생성에 실패했습니다.');
    const { error: memberError } = await req.db.from('group_room_members').insert(normalized.map(m => ({ room_id: room.id, member_type: m.type, member_id: m.id })));
    if (memberError) throw new ApiError('INTERNAL_ERROR', '그룹 멤버 저장에 실패했습니다.');
    const { data: savedMembers } = await req.db.from('group_room_members').select('*').eq('room_id', room.id);
    return reply.status(201).send(ok({ ...room, members: savedMembers || [] }));
  });

  app.get('/', { preHandler: requireAuth }, async req => {
    const { data, error } = await req.db.from('group_rooms').select('*').eq('owner_id', req.userId).order('updated_at', { ascending: false });
    if (error) throw new ApiError('INTERNAL_ERROR', '그룹방 목록 조회에 실패했습니다.');
    return ok(data || []);
  });

  app.get('/:id', { preHandler: requireAuth }, async req => {
    const room = await ownedRoom(req.db, req.userId, (req.params as { id: string }).id);
    const [members, messages, turns] = await Promise.all([
      req.db.from('group_room_members').select('*').eq('room_id', room.id),
      req.db.from('group_messages').select('*').eq('room_id', room.id).order('created_at', { ascending: true }).limit(500),
      req.db.from('group_turns').select('*').eq('room_id', room.id).order('created_at', { ascending: false }).limit(100),
    ]);
    if (members.error || messages.error || turns.error) throw new ApiError('INTERNAL_ERROR', '그룹방 조회에 실패했습니다.');
    return ok({ ...room, members: members.data || [], messages: messages.data || [], turns: turns.data || [] });
  });

  app.patch('/:id', { preHandler: requireAuth }, async req => {
    const room = await ownedRoom(req.db, req.userId, (req.params as { id: string }).id);
    const body = req.body as { name?: unknown; members?: unknown };
    const hasName = body?.name !== undefined;
    const hasMembers = body?.members !== undefined;
    if (!hasName && !hasMembers) throw badRequest('name 또는 members가 필요합니다.');
    let name: string | null = null;
    if (hasName) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) throw badRequest('방 이름은 1~80자여야 합니다.');
      name = body.name.trim();
    }

    let normalized: { type: string; id: string }[] | null = null;
    if (hasMembers) {
      if (!Array.isArray(body.members)) throw badRequest('members는 배열이어야 합니다.');
      const incoming = body.members as { type?: unknown; id?: unknown }[];
      if (incoming.length < 1 || incoming.length > 5 || incoming.some(m => !['user','agent'].includes(String(m.type)) || typeof m.id !== 'string' || !UUID.test(m.id))) throw badRequest('멤버는 본인 외 1~5명이어야 합니다.');
      normalized = [{ type: 'user', id: req.userId }, ...incoming.map(m => ({ type: String(m.type), id: m.id as string }))];
      if (new Set(normalized.map(m => `${m.type}:${m.id}`)).size !== normalized.length || normalized.some(m => m.type === 'user' && m.id !== req.userId)) throw badRequest('멤버가 중복되었거나 본인 외 사용자를 포함했습니다.');
      const agentIds = normalized.filter(m => m.type === 'agent').map(m => m.id);
      if (agentIds.length) {
        const { data, error } = await req.db.from('agents').select('id').eq('owner_id', req.userId).in('id', agentIds);
        if (error || (data || []).length !== agentIds.length) throw badRequest('소유하지 않은 에이전트가 포함되었습니다.');
      }
    }

    const { data, error } = await req.db.rpc('update_group_room', {
      p_room_id: room.id,
      p_owner_id: req.userId,
      p_name: name,
      p_members: normalized?.map(m => ({ member_type: m.type, member_id: m.id })) ?? null,
    });
    if (error || !data) throw new ApiError('INTERNAL_ERROR', '그룹방 변경에 실패했습니다.');
    return ok(hasName && !hasMembers ? data.room : (data.members || []));
  });

  app.post('/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const room = await ownedRoom(req.db, req.userId, (req.params as { id: string }).id);
    const body = req.body as { content?: unknown; parent_id?: unknown; mentions?: unknown; attachments?: unknown; kind?: unknown; turn_id?: unknown; token_count?: unknown };
    if (typeof body?.content !== 'string' || !body.content.trim() || body.content.length > 20000) throw badRequest('메시지는 1~20000자여야 합니다.');
    const kind = body.kind === undefined ? 'text' : body.kind;
    if (!KINDS.includes(kind as typeof KINDS[number])) throw badRequest('메시지 kind가 올바르지 않습니다.');
    const mentions = body.mentions === undefined ? [] : body.mentions;
    const attachments = body.attachments === undefined ? [] : body.attachments;
    if (!Array.isArray(mentions) || mentions.some(x => typeof x !== 'string' || !UUID.test(x)) || !Array.isArray(attachments)) throw badRequest('mentions 또는 attachments 형식이 올바르지 않습니다.');
    if (body.parent_id !== undefined && (typeof body.parent_id !== 'string' || !UUID.test(body.parent_id))) throw badRequest('parent_id가 올바르지 않습니다.');
    if (body.parent_id) {
      const { data, error } = await req.db.from('group_messages').select('id').eq('id', body.parent_id).eq('room_id', room.id).maybeSingle();
      if (error || !data) throw badRequest('같은 그룹방의 스레드 메시지를 지정해야 합니다.');
    }
    if (body.token_count !== undefined && (!Number.isSafeInteger(body.token_count) || (body.token_count as number) < 0)) throw badRequest('token_count는 0 이상의 정수여야 합니다.');
    let turn: { id: string; status: string; utterance_count: number; token_count: number };
    let createdTurn = false;
    if (body.turn_id !== undefined) {
      if (typeof body.turn_id !== 'string' || !UUID.test(body.turn_id)) throw badRequest('turn_id가 올바르지 않습니다.');
      const { data, error } = await req.db.from('group_turns').select('*').eq('id', body.turn_id).eq('room_id', room.id).maybeSingle();
      if (error || !data) throw badRequest('같은 그룹방의 턴을 지정해야 합니다.');
      if (data.status !== 'open') throw badRequest('열린 턴에만 메시지를 추가할 수 있습니다.');
      turn = data;
    } else {
      const { data, error } = await req.db.from('group_turns').insert({ room_id: room.id, status: 'open' }).select().single();
      if (error || !data) throw new ApiError('INTERNAL_ERROR', '턴 생성에 실패했습니다.');
      turn = data;
      createdTurn = true;
    }
    const { data, error } = await req.db.from('group_messages').insert({ room_id: room.id, turn_id: turn.id, parent_id: body.parent_id || null, author_type: 'user', author_id: req.userId, content: body.content.trim(), mentions, attachments, kind }).select().single();
    if (error || !data) throw new ApiError('INTERNAL_ERROR', '메시지 저장에 실패했습니다.');
    if (createdTurn) {
      const { error: updateError } = await req.db.from('group_turns').update({ start_message_id: data.id, utterance_count: 1, token_count: Number(body.token_count || 0) }).eq('id', turn.id);
      if (updateError) throw new ApiError('INTERNAL_ERROR', '턴 메시지 연결에 실패했습니다.');
    } else {
      // Compare-and-set the observed counters so concurrent updates cannot silently overwrite one another.
      const { data: updated, error: updateError } = await req.db.from('group_turns').update({ utterance_count: turn.utterance_count + 1, token_count: turn.token_count + Number(body.token_count || 0) }).eq('id', turn.id).eq('room_id', room.id).eq('status', 'open').eq('utterance_count', turn.utterance_count).eq('token_count', turn.token_count).select().maybeSingle();
      if (updateError || !updated) throw new ApiError('CONFLICT', '턴 카운터가 동시에 변경되었습니다. 메시지를 다시 시도하세요.');
    }
    await req.db.from('group_rooms').update({ updated_at: new Date().toISOString() }).eq('id', room.id);
    const { data: savedTurn, error: readTurnError } = await req.db.from('group_turns').select('*').eq('id', turn.id).maybeSingle();
    if (readTurnError || !savedTurn) throw new ApiError('INTERNAL_ERROR', '턴 조회에 실패했습니다.');
    return reply.status(201).send(ok({ ...data, turn: savedTurn }));
  });

  app.patch('/:id/turns/:turnId', { preHandler: requireAuth }, async req => {
    const room = await ownedRoom(req.db, req.userId, (req.params as { id: string }).id);
    const { turnId } = req.params as { turnId: string };
    const body = req.body as { status?: unknown; token_count_delta?: unknown };
    if (body?.status !== undefined && !['open', 'closed', 'halted'].includes(String(body.status))) throw badRequest('턴 상태가 올바르지 않습니다.');
    if (body?.token_count_delta !== undefined && (!Number.isSafeInteger(body.token_count_delta) || (body.token_count_delta as number) < 0)) throw badRequest('token_count_delta는 0 이상의 정수여야 합니다.');
    const { data: turn, error } = await req.db.from('group_turns').select('*').eq('id', turnId).eq('room_id', room.id).maybeSingle();
    if (error || !turn) throw new ApiError('NOT_FOUND', '턴을 찾을 수 없습니다.');
    if (body.status === 'open' && turn.status !== 'open') throw badRequest('종료된 턴은 다시 열 수 없습니다.');
    const patch: Record<string, unknown> = {};
    if (body.status !== undefined) {
      patch.status = body.status;
      patch.closed_at = body.status === 'open' ? null : new Date().toISOString();
    }
    if (body.token_count_delta !== undefined) patch.token_count = turn.token_count + (body.token_count_delta as number);
    if (!Object.keys(patch).length) throw badRequest('status 또는 token_count_delta가 필요합니다.');
    const { data, error: updateError } = await req.db.from('group_turns').update(patch).eq('id', turn.id).eq('room_id', room.id).eq('status', turn.status).eq('token_count', turn.token_count).select().maybeSingle();
    if (updateError || !data) throw new ApiError('CONFLICT', '턴이 동시에 변경되었습니다. 다시 시도하세요.');
    return ok(data);
  });

  app.get('/:id/threads/:messageId', { preHandler: requireAuth }, async req => {
    const room = await ownedRoom(req.db, req.userId, (req.params as { id: string }).id);
    const { messageId } = req.params as { messageId: string };
    const { data: root, error } = await req.db.from('group_messages').select('*').eq('id', messageId).eq('room_id', room.id).maybeSingle();
    if (error || !root) throw new ApiError('NOT_FOUND', '메시지를 찾을 수 없습니다.');
    const { data: replies, error: repliesError } = await req.db.from('group_messages').select('*').eq('room_id', room.id).eq('parent_id', messageId).order('created_at', { ascending: true });
    if (repliesError) throw new ApiError('INTERNAL_ERROR', '스레드 조회에 실패했습니다.');
    return ok({ root, replies: replies || [], reply_count: (replies || []).length });
  });

  // ── P2 (t_ecb8b951): PM 라우팅 + 턴 런타임 dispatch 배선 — GROUP_TURN_DISPATCH 게이트 기본 OFF ──
  app.post('/:id/dispatch', { preHandler: requireAuth }, async (req) => {
    if (!dispatchEnabled()) throw new ApiError('NOT_FOUND', 'dispatch 엔드포인트가 비활성화되었습니다.');
    const room = await ownedRoom(req.db, req.userId, (req.params as { id: string }).id);
    const body = req.body as { message_id?: unknown };
    const messageId = typeof body?.message_id === 'string' && UUID.test(body.message_id) ? body.message_id : null;
    if (!messageId) throw badRequest('message_id는 유효한 UUID여야 합니다.');
    const { data: anchor, error: anchorError } = await req.db.from('group_messages').select('*').eq('id', messageId).eq('room_id', room.id).maybeSingle();
    if (anchorError || !anchor) throw new ApiError('NOT_FOUND', '앵커 메시지를 찾을 수 없습니다.');
    if (anchor.author_type !== 'user') throw badRequest('dispatch 앵커는 사용자 발화여야 합니다.');

    const { data: members } = await req.db.from('group_room_members').select('*').eq('room_id', room.id);
    const agentIds = (members || []).filter((m: any) => m.member_type === 'agent').map((m: any) => m.member_id as string);
    if (agentIds.length === 0) throw badRequest('방에 에이전트 멤버가 없습니다.');
    const { data: agentRows } = await req.db.from('agents').select('id,name,description').eq('owner_id', req.userId).in('id', agentIds);
    const cards = (agentRows || []).map((a: any) => ({
      agent_id: a.id as string, name: String(a.name ?? a.id), card: String(a.description ?? '[역할카드 미설정]'),
    }));

    let replyTo: { authorType: 'user' | 'agent'; authorId: string } | null = null;
    if (anchor.parent_id) {
      const { data: parent } = await req.db.from('group_messages').select('*').eq('id', anchor.parent_id).maybeSingle();
      if (parent) replyTo = { authorType: parent.author_type, authorId: parent.author_id };
    }

    const routed = await routePmTurn({
      roomId: room.id, ownerId: req.userId, messageId: anchor.id, message: anchor.content,
      roleCards: cards, mentions: anchor.mentions || [], replyTo, threadSummary: null,
    });
    if (routed.decision.responders.length === 0) {
      return ok({
        decision: routed.decision, route_source: routed.route_source, clarify: routed.clarify,
        clarify_utterance: routed.clarify_utterance, degraded: routed.degraded, turn_id: null, utterances: [],
      });
    }

    const envelopes = await buildAgentEnvelopes(req.db, {
      roomId: room.id, ownerId: req.userId, anchorMessageId: anchor.id, decision: routed.decision,
    });
    const { data: turn, error: turnError } = await req.db.from('group_turns').insert({
      room_id: room.id, start_message_id: anchor.id, status: 'open', utterance_count: 0, token_count: 0,
    }).select().single();
    if (turnError || !turn) throw new ApiError('INTERNAL_ERROR', '턴 생성에 실패했습니다.');

    const agentNames: Record<string, string> = {};
    for (const c of cards) agentNames[c.name] = c.agent_id;
    const speak = async (agentId: string, ctx: SpeakContext) => {
      const card = cards.find((c: { agent_id: string; name: string; card: string }) => c.agent_id === agentId);
      const e = ctx.envelope;
      const system = [
        '당신은 그룹채팅의 에이전트입니다. 대화의 전부는 아래 컨텍스트(PM 요약 + 자기 스레드)뿐입니다.',
        `당신의 역할카드: ${card?.card ?? ''}`,
        e ? `PM 요약: ${e.pm_summary}` : 'PM 요약: 없음',
        e ? `자기 스레드: ${JSON.stringify(e.own_thread.map((t) => ({ author: t.author_type, text: t.content })))}` : '',
        e && e.handoffs.length ? `승인된 전달 텍스트:\n${e.handoffs.join('\n')}` : '',
        routed.decision.mode === 'sequence'
          ? '대화를 다른 에이전트에게 이어주려면 {"text":"...","pass_to":"에이전트 이름 또는 id"} JSON으로, 불필요하면 pass_to:null으로 출력하세요.'
          : '평문으로 답변하세요.',
      ].filter(Boolean).join('\n');
      const res = await chatCompletion({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: e ? e.anchor.content : String(ctx.spoken.map((s) => s.text).join('\n')) },
        ],
        enableThinking: false,
      });
      let text = res.text.trim();
      let pass_to: string | null = null;
      if (routed.decision.mode === 'sequence') {
        const s = text.indexOf('{'); const en = text.lastIndexOf('}');
        if (s >= 0 && en > s) {
          try {
            const o = JSON.parse(text.slice(s, en + 1));
            if (typeof o.text === 'string') {
              text = o.text;
              pass_to = o.pass_to == null || o.pass_to === '' ? null : String(o.pass_to);
            }
          } catch { /* 프로토콜 폴백: 평문 그대로 발화 */ }
        }
      }
      return { text, pass_to, tokens: res.usage?.total_tokens ?? 0 };
    };
    const summarize = async ({ reason, utterances: u }: { reason: string; utterances: { agent_id: string; text: string }[] }) => {
      const res = await chatCompletion({
        messages: [
          { role: 'system', content: '당신은 그룹채팅 PM입니다. 이 턴의 논의를 2~3문장(한국어)으로 요약하고 대화가 멈춘 이유를 한 문장으로 알려주세요.' },
          { role: 'user', content: `정지 사유: ${reason}\n` + u.map((x) => `- ${x.agent_id}: ${x.text}`).join('\n') },
        ],
        enableThinking: false,
      });
      return { text: res.text, tokens: res.usage?.total_tokens ?? 0 };
    };

    const result = await runAgentTurns(req.db, {
      roomId: room.id, ownerId: req.userId, turnId: turn.id, anchorMessageId: anchor.id,
      mode: routed.decision.mode, envelopes, agentIds: new Set(agentIds), agentNames,
      speak, summarize,
    });
    return ok({
      decision: routed.decision, route_source: routed.route_source, clarify: routed.clarify,
      turn_id: turn.id, status: result.status, stop_reason: result.stop_reason,
      utterances: result.messages, summary: result.summary,
      pm_audit: { mention_reply_to: routed.audit.mention_reply_to, route: routed.audit, model: routed.model, usage: routed.usage, attempts: routed.attempts },
    });
  });
}
