// t_ea0b1f95 재구현 검증 — 컨텍스트 경계 11+ 케이스 (금지어 marker OTHER*/FULLCONV* 부재 단언 포함)
import { describe, expect, it } from 'vitest';
import {
  buildAgentEnvelopes, ContextBoundaryError, GCB_BOUNDARY_MARKER, GCB_NO_SUMMARY, stubRouteDecider,
  type RouteDecision,
} from '../src/lib/groupChatContext';
import { fakeDb, OWNER, A1, A2, ROOM } from './fakeDb';

const anchorId = 'm-anchor';
function store(over: Record<string, any[]> = {}) {
  return {
    group_rooms: [{ id: ROOM, owner_id: OWNER }],
    group_room_members: [
      { room_id: ROOM, member_type: 'user', member_id: OWNER },
      { room_id: ROOM, member_type: 'agent', member_id: A1 },
      { room_id: ROOM, member_type: 'agent', member_id: A2 },
    ],
    group_messages: [
      { id: 'r1', room_id: ROOM, parent_id: null, author_type: 'user', author_id: OWNER, content: 'ROOT-USER', kind: 'text', created_at: '2026-01-01T00:00:00Z' },
      { id: 'a1', room_id: ROOM, parent_id: 'r1', author_type: 'agent', author_id: A2, content: 'OTHER-AGENT-PRIVATE', kind: 'text', created_at: '2026-01-01T00:01:00Z' },
      { id: 'a2', room_id: ROOM, parent_id: 'r1', author_type: 'agent', author_id: A1, content: 'SELF-AGENT-TEXT', kind: 'text', created_at: '2026-01-01T00:02:00Z' },
      { id: anchorId, room_id: ROOM, parent_id: 'r1', author_type: 'user', author_id: OWNER, content: '질문입니다', mentions: [A1], kind: 'text', created_at: '2026-01-01T00:03:00Z' },
      { id: 'u2', room_id: ROOM, parent_id: 'r1', author_type: 'user', author_id: OWNER, content: 'COMMON-USER', kind: 'text', created_at: '2026-01-01T00:04:00Z' },
      { id: 'r2', room_id: ROOM, parent_id: null, author_type: 'user', author_id: OWNER, content: 'FULLCONV-OTHER-THREAD-ROOT', kind: 'text', created_at: '2026-01-01T00:05:00Z' },
      { id: 'x1', room_id: ROOM, parent_id: 'r2', author_type: 'user', author_id: OWNER, content: 'FULLCONV-OTHER-THREAD', kind: 'text', created_at: '2026-01-01T00:06:00Z' },
      { id: 's1', room_id: ROOM, parent_id: null, author_type: 'user', author_id: OWNER, content: 'PM-SUMMARY-LATEST', kind: 'summary', created_at: '2026-01-01T00:07:00Z' },
    ],
    ...over,
  };
}
const D = (responders: string[], mode: RouteDecision['mode'] = 'single', confidence = 0.9): RouteDecision => ({ responders, mode, confidence });

function payloadString(e: any) { return JSON.stringify(e); }

describe('groupChatContext — 고정 라우터 인터페이스', () => {
  it('1) stubRouteDecider가 RouterInput→RouteDecision 계약을 지킨다', async () => {
    const decider = stubRouteDecider(D([A1]));
    const d = await decider({ roomId: ROOM, ownerId: OWNER, messageId: anchorId, userText: 'q', roleCards: [], threadSummary: null });
    expect(d).toEqual({ responders: [A1], mode: 'single', confidence: 0.9 });
  });

  it('2) 빈 responders → envelope 0건 (D5, 어떤 mode든 통과·호출 금지)', async () => {
    const envs = await buildAgentEnvelopes(fakeDb(store()), { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([], 'sequence') });
    expect(envs).toHaveLength(0);
  });

  it('3) single: 자기 스레드+PM 요약만 — 페이로드에 금지 마커 없음', async () => {
    const envs = await buildAgentEnvelopes(fakeDb(store()), { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1]) });
    expect(envs).toHaveLength(1);
    const e = envs[0];
    expect(e.agent_id).toBe(A1);
    expect(e.boundary_marker).toBe(GCB_BOUNDARY_MARKER);
    expect(e.pm_summary).toBe('PM-SUMMARY-LATEST');
    const p = payloadString(e);
    expect(p).not.toContain('FULLCONV');
    expect(p).not.toContain('OTHER-AGENT-PRIVATE');
    const texts = e.own_thread.map((m) => m.content);
    expect(texts).toEqual(expect.arrayContaining(['ROOT-USER', 'SELF-AGENT-TEXT', '질문입니다', 'COMMON-USER']));
  });

  it('4) parallel: responder당 1건', async () => {
    const envs = await buildAgentEnvelopes(fakeDb(store()), { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1, A2], 'parallel') });
    expect(envs.map((e) => e.agent_id).sort()).toEqual([A1, A2].sort());
    // A2는 OTHER-AGENT-PRIVATE(self 작성)을 본인 스레드에 포함
    expect(payloadString(envs.find((e) => e.agent_id === A2)!)).toContain('OTHER-AGENT-PRIVATE');
  });

  it('5) single dedup: [A1,A1] → 1건 (중복=정규화)', async () => {
    const envs = await buildAgentEnvelopes(fakeDb(store()), { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1, A1], 'single') });
    expect(envs).toHaveLength(1);
  });

  it('6) sequence: responders 순서 + handoffs 승인 텍스트만 진입 (D3)', async () => {
    const envs = await buildAgentEnvelopes(fakeDb(store()), {
      roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1, A2], 'sequence'),
      handoffs: { [A2]: ['요약된 승인 전달입니다'] },
    });
    expect(envs[0].sequence_index).toBe(0);
    expect(envs[1].sequence_index).toBe(1);
    expect(envs[1].handoffs).toEqual(['요약된 승인 전달입니다']);
    expect(envs[0].handoffs).toEqual([]);
  });

  it('7) D1 root 미충족 → root null+제외', async () => {
    // root를 A2가 작성하고 A1을 mention하지 않은 스레드
    const st = store();
    st.group_messages = st.group_messages.map((m) => m.id === 'r1'
      ? { ...m, author_type: 'agent', author_id: A2, mentions: [] } : m);
    const envs = await buildAgentEnvelopes(fakeDb(st), { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1]) });
    expect(envs[0].root).toBeNull();
    expect(envs[0].own_thread.find((m) => m.id === 'r1')).toBeUndefined();
  });

  it('8) 앵커가 에이전트 발화 → throw (스파인 누출 봉쇄)', async () => {
    await expect(buildAgentEnvelopes(fakeDb(store()), { roomId: ROOM, ownerId: OWNER, anchorMessageId: 'a2', decision: D([A1]) }))
      .rejects.toMatchObject({ code: 'CONTEXT_CONTRACT_VIOLATION' });
  });

  it('9) D2 폴백: pmSummary 인자 우선, 명시 null은 원문 대체 금지', async () => {
    const db = fakeDb(store());
    const withArg = await buildAgentEnvelopes(db, { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1]), pmSummary: 'INJECTED-SUMMARY' });
    expect(withArg[0].pm_summary).toBe('INJECTED-SUMMARY');
    const nullSum = await buildAgentEnvelopes(db, { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1]), pmSummary: null });
    expect(nullSum[0].pm_summary).toBe(GCB_NO_SUMMARY);
  });

  it('10) D3 누출 가드: 제외 발화 원문 포함 handoff → CONTEXT_LEAK_DETECTED', async () => {
    await expect(buildAgentEnvelopes(fakeDb(store()), {
      roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1, A2], 'sequence'),
      handoffs: { [A2]: ['OTHER-AGENT-PRIVATE'] },
    })).rejects.toMatchObject({ code: 'CONTEXT_LEAK_DETECTED' });
  });

  it('11) D4: 미등록 responder → throw', async () => {
    await expect(buildAgentEnvelopes(fakeDb(store()), { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D(['00000000-0000-4000-8000-000000000099']) }))
      .rejects.toMatchObject({ code: 'CONTEXT_CONTRACT_VIOLATION' });
  });

  it('12) 조회 실패 → CONTEXT_QUERY_FAILED (fail-closed, 원문 대체 없음)', async () => {
    const db = fakeDb(store(), { failTables: new Set(['group_messages']) });
    await expect(buildAgentEnvelopes(db, { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1]) }))
      .rejects.toBeInstanceOf(ContextBoundaryError);
    await expect(buildAgentEnvelopes(db, { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1]) }))
      .rejects.toMatchObject({ code: 'CONTEXT_QUERY_FAILED' });
  });

  it('13) 화이트리스트: group_* 3테이블 외 조회 자체가 발생하지 않는다', async () => {
    const db = fakeDb(store());
    await buildAgentEnvelopes(db, { roomId: ROOM, ownerId: OWNER, anchorMessageId: anchorId, decision: D([A1, A2], 'parallel') });
    expect(new Set(db.queries)).toEqual(new Set(['group_rooms', 'group_room_members', 'group_messages']));
  });

  it('14) 방 소유 불일치/앵커 없음 → CONTEXT_NOT_FOUND', async () => {
    const db = fakeDb(store());
    await expect(buildAgentEnvelopes(db, { roomId: ROOM, ownerId: 'other', anchorMessageId: anchorId, decision: D([A1]) }))
      .rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' });
    await expect(buildAgentEnvelopes(db, { roomId: ROOM, ownerId: OWNER, anchorMessageId: 'missing', decision: D([A1]) }))
      .rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' });
  });
});
