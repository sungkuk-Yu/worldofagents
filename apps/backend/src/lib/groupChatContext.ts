// 그룹채팅 P1 — 컨텍스트 경계 (t_ea0b1f95 정본 계약, feat/groupchat-p0@d9cc544e 재구현)
// "에이전트에는 전체 대화 대신 PM 요약+자기 스레드만 전달"을 페이로드 수준에서 구현·보증한다.
// 다른 스레드·방 전체 대화는 조회 자체가 발생하지 않는다(구조적 봉쇄). fail-closed.

/** 최소 구조적 supabase-like 클라이언트(req.db) — 화이트리스트 밖 조회는 런타임 차단. */
export type BoundaryDb = { from(table: string): any };

export type RouteMode = 'single' | 'parallel' | 'sequence';

export interface RouteDecision {
  responders: string[];
  mode: RouteMode;
  confidence: number; // [0,1]
}

export interface RouterInput {
  roomId: string;
  ownerId: string;
  messageId: string;
  userText: string;
  roleCards: { agent_id: string; card: string }[];
  threadSummary: string | null;
}

export type RouteDecider = (input: RouterInput) => Promise<RouteDecision>;

/** 라우터 구현 전 독립 개발용 스텁. */
export function stubRouteDecider(fixed: RouteDecision): RouteDecider {
  return async () => fixed;
}

export const GCB_BOUNDARY_MARKER = 'GCX-B-1:gcx-boundary-v1';
export const GCB_NO_SUMMARY = '— PM 요약 없음 —';
const SUMMARY_MAX_CHARS = 4000;

/** 실 요청 페이로드 스냅샷 검증 앵커(boundary_marker) 포함 에이전트 컨텍스트. */
export interface AgentEnvelopeMessage {
  id: string;
  parent_id: string | null;
  author_type: 'user' | 'agent';
  author_id: string;
  content: string;
  kind: string;
  created_at: string;
}

export interface AgentEnvelope {
  agent_id: string;
  mode: RouteMode;
  sequence_index: number;
  pm_summary: string;
  root: AgentEnvelopeMessage | null; // 비가면 null
  anchor: AgentEnvelopeMessage;
  own_thread: AgentEnvelopeMessage[];
  handoffs: string[];
  boundary_marker: typeof GCB_BOUNDARY_MARKER;
}

export type ContextBoundaryCode =
  | 'CONTEXT_NOT_FOUND'
  | 'CONTEXT_QUERY_FAILED'
  | 'CONTEXT_CONTRACT_VIOLATION'
  | 'CONTEXT_LEAK_DETECTED';

export class ContextBoundaryError extends Error {
  code: ContextBoundaryCode;
  constructor(code: ContextBoundaryCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ContextBoundaryError';
    this.code = code;
  }
}

// 조회 테이블 화이트리스트 — 우회 조회(전체 대화·users·agents 등)는 호출 단계에서 차단.
const WHITELIST = new Set(['group_rooms', 'group_room_members', 'group_messages']);

function table(db: BoundaryDb, name: string) {
  if (!WHITELIST.has(name)) {
    throw new ContextBoundaryError('CONTEXT_CONTRACT_VIOLATION', `화이트리스트 밖 조회: ${name}`);
  }
  return db.from(name);
}

async function rows(
  db: BoundaryDb,
  name: string,
  build: (q: any) => any,
): Promise<any[]> {
  const { data, error } = await build(table(db, name).select('*'));
  if (error) throw new ContextBoundaryError('CONTEXT_QUERY_FAILED', `조회 실패(${name}): ${error.message ?? error}`);
  return data ?? [];
}

function toEnvelopeMessage(m: any): AgentEnvelopeMessage {
  return {
    id: m.id,
    parent_id: (m.parent_id as string | null) ?? null,
    author_type: m.author_type,
    author_id: m.author_id,
    content: m.content,
    kind: m.kind ?? 'text',
    created_at: m.created_at,
  };
}

function normalizeResponders(decision: RouteDecision): string[] {
  const seen: string[] = [];
  for (const r of decision.responders) {
    if (typeof r !== 'string' || !r) continue;
    if (!seen.includes(r)) seen.push(r);
  }
  if (decision.mode === 'single' && seen.length > 1) return seen.slice(0, 1);
  return seen;
}

export interface BuildEnvelopesInput {
  roomId: string;
  ownerId: string;
  anchorMessageId: string; // group_turns.start_message_id — 사용자 발화 강제
  decision: RouteDecision;
  pmSummary?: string | null;
  handoffs?: Record<string, string[]>; // sequence 승인 전달만(D3)
}

/**
 * responder당 envelope 1건(sequence면 responders 순서). 빈 responders → 0건(D5 clarify 신호,
 * 어떤 mode든 무조건 통과 — 에이전트 호출 금지가 먼저).
 */
export async function buildAgentEnvelopes(
  db: BoundaryDb,
  input: BuildEnvelopesInput,
): Promise<AgentEnvelope[]> {
  const { roomId, ownerId, anchorMessageId, decision } = input;
  if (!decision || !Array.isArray(decision.responders)
    || !['single', 'parallel', 'sequence'].includes(decision.mode)
    || typeof decision.confidence !== 'number' || !isFinite(decision.confidence)) {
    throw new ContextBoundaryError('CONTEXT_CONTRACT_VIOLATION', 'RouteDecision 계약 불일치');
  }
  const responders = normalizeResponders(decision);
  if (responders.length === 0) return []; // D5: 빈 responders = 호출 금지 신호

  // 방 소유 검증
  const rooms = await rows(db, 'group_rooms', (q) => q.eq('id', roomId).eq('owner_id', ownerId));
  if (rooms.length === 0) throw new ContextBoundaryError('CONTEXT_NOT_FOUND', `방 없음/소유 불일치: ${roomId}`);

  // D4: responders 서버 재검증 (group_room_members agent)
  const members = await rows(db, 'group_room_members', (q) => q.eq('room_id', roomId).eq('member_type', 'agent'));
  const agentIds = new Set(members.map((m: any) => m.member_id as string));
  for (const r of responders) {
    if (!agentIds.has(r)) {
      throw new ContextBoundaryError('CONTEXT_CONTRACT_VIOLATION', `미등록 responder: ${r}`);
    }
  }

  // 앵커 (D1: 사용자 발화 강제 — 에이전트 발화면 스파인 누출 벡터 봉쇄)
  const anchors = await rows(db, 'group_messages', (q) => q.eq('id', anchorMessageId).eq('room_id', roomId));
  if (anchors.length === 0) throw new ContextBoundaryError('CONTEXT_NOT_FOUND', `앵커 메시지 없음: ${anchorMessageId}`);
  const anchor = anchors[0];
  if (anchor.author_type !== 'user') {
    throw new ContextBoundaryError('CONTEXT_CONTRACT_VIOLATION', '앵커는 사용자 발화여야 합니다');
  }

  // 스레드 = root + replies (P0 GET threads와 동일 eq(room_id)·eq(parent_id) 경로)
  const rootId = (anchor.parent_id as string | null) ?? anchor.id;
  let root: any = anchor;
  if (anchor.parent_id) {
    const roots = await rows(db, 'group_messages', (q) => q.eq('id', rootId).eq('room_id', roomId));
    if (roots.length === 0) throw new ContextBoundaryError('CONTEXT_NOT_FOUND', `root 없음: ${rootId}`);
    root = roots[0];
  }
  const replies = await rows(db, 'group_messages', (q) =>
    q.eq('room_id', roomId).eq('parent_id', rootId).order('created_at', { ascending: true }));

  // D2: 요약 폴백 pmSummary 인자 → 방 최신 kind='summary' 1행(4000자 컷) → 없음 문구.
  // 조회 실패는 CONTEXT_QUERY_FAILED로 중단(원문 대체 없음).
  let pmSummary: string;
  if (typeof input.pmSummary === 'string' && input.pmSummary.trim()) {
    pmSummary = input.pmSummary.slice(0, SUMMARY_MAX_CHARS);
  } else if (input.pmSummary === undefined) {
    const summaries = await rows(db, 'group_messages', (q) =>
      q.eq('room_id', roomId).eq('kind', 'summary').order('created_at', { ascending: false }).limit(1));
    pmSummary = summaries.length ? String(summaries[0].content).slice(0, SUMMARY_MAX_CHARS) : GCB_NO_SUMMARY;
  } else {
    pmSummary = GCB_NO_SUMMARY; // 명시 null → 원문 대체 금지(fail-closed)
  }

  // D1 자기 스레드 필터: {앵커, 사용자 발화, self 작성, mentions에 self}
  const threadCandidates: any[] = [];
  const seenIds = new Set<string>();
  const pushUnique = (m: any) => { if (m && !seenIds.has(m.id)) { seenIds.add(m.id); threadCandidates.push(m); } };
  if (root.id !== anchor.id) pushUnique(root);
  for (const m of replies) pushUnique(m);
  pushUnique(anchor);

  const excludedVerbatim: string[] = [];
  const envelopes: AgentEnvelope[] = [];
  for (let i = 0; i < responders.length; i++) {
    const agentId = responders[i];
    const own = threadCandidates.filter((m) =>
      m.id === anchor.id
      || m.author_type === 'user'
      || m.author_id === agentId
      || (Array.isArray(m.mentions) && m.mentions.includes(agentId)));
    const includedIds = new Set(own.map((m: any) => m.id as string));
    for (const m of threadCandidates) {
      if (!includedIds.has(m.id)) excludedVerbatim.push(String(m.content));
    }

    // root도 D1 조건 미충족이면 페이로드에서 null+제외
    const rootIn = root.id === anchor.id || includedIds.has(root.id)
      ? (root.id === anchor.id && !includedIds.has(root.id) ? null : toEnvelopeMessage(root))
      : null;

    const handoffs: string[] = [];
    if (decision.mode === 'sequence' && input.handoffs) {
      for (const t of input.handoffs[agentId] ?? []) {
        const text = String(t);
        // D3 누출 가드: 제외 발화 원문 포함 시 차단
        for (const ex of excludedVerbatim) {
          if (ex.length > 0 && text.includes(ex)) {
            throw new ContextBoundaryError('CONTEXT_LEAK_DETECTED', '제외 발화 원문이 handoff에 포함');
          }
        }
        handoffs.push(text);
      }
    }

    envelopes.push({
      agent_id: agentId,
      mode: decision.mode,
      sequence_index: decision.mode === 'sequence' ? i : 0,
      pm_summary: pmSummary,
      root: rootIn,
      anchor: toEnvelopeMessage(anchor),
      own_thread: own.map(toEnvelopeMessage),
      handoffs,
      boundary_marker: GCB_BOUNDARY_MARKER,
    });
  }
  return envelopes;
}
