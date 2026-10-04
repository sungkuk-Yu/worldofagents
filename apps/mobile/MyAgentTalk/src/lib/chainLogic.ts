// 체인 관리 순수 로직 (t_00fe9b0f — 포크 관리 모델, 대표님 10/4: "비트코인/가상화폐 포크 관리를 잘 모사").
// 용어 매핑(UI 노출은 chain.* i18n): 메인 체인=가운데 스트림, 사이드체인=쓰레드(답글) 카드,
// 하드포크=새프로젝트(fork 세션). 상태색 3종=합의 상태 — 실데이터 신호만(추측 색상 금지):
//   pending(주황)=답변 계산 중 / confirmed(초록)=완료 / stalled(빨강)=확인 대기(승인·선택) 또는 재시도.
// 재질문 2.5s 초과 미응답은 자동 진행(auto-proceed)이므로 빨강이 아닌 진행(주황)으로 둔다 — needsConfirm은
// 서버 reply.pending 스냅샷/공감 미해소 실데이터에서만 온다 (questionTracker의 판정 재사용, 3차 추론 없음).
// 닫기 = 아카이브 시맨틱(#555): 물리 삭제 없이 리스트에서 접고 원 질문 뱃지 'n closed'로 재접근.
import type { ThreadIndexEntry } from './chatLogic';
import type { TrackerRow } from './questionTracker';

export type ChainStatus = 'pending' | 'confirmed' | 'stalled';

export interface SideChainCard {
  rootId: string;
  /** 원 질문 높이(순번) — 메인 체인 블록 번호 */
  seq: number;
  excerpt: string;
  replyCount: number;
  lastActivity: string;
  ended: boolean;
  status: ChainStatus;
  /** 아카이브(닫기) 상태 — 리스트에서 접힘, 'n closed' 카운터로 재접근 가능 */
  closed: boolean;
}

/**
 * 스레드 인덱스(buildThreadIndex) × 트래커 행(buildQuestionTracker) → 사이드체인 카드.
 * #554 정합: 실질 질문만 — 트래커에서 오염 행(확인 발화·재질문)은 이미 제외되므로,
 * 행이 잡히지 않는 루트는 진행(pending)으로 최소 보전(색 추측 금지 → 계산 중으로만).
 */
export function buildSideChainCards(
  threads: ThreadIndexEntry[],
  trackerRows: TrackerRow[],
  closedRootIds: ReadonlySet<string> = new Set(),
): SideChainCard[] {
  const rowByMessage = new Map(trackerRows.map((r) => [r.messageId, r]));
  const out: SideChainCard[] = threads.map((th) => {
    const row = rowByMessage.get(th.rootId);
    let status: ChainStatus;
    if (row && (row.failed || row.needsConfirm)) status = 'stalled';
    else if (row && row.stage === 3) status = 'confirmed';
    else if (!row && th.ended) status = 'confirmed'; // 행 축약(24h)로 빠져도 종료 스레드는 완료
    else status = 'pending';
    return {
      rootId: th.rootId, seq: th.rootSeq, excerpt: th.rootText,
      replyCount: th.replyCount, lastActivity: th.lastActivity, ended: th.ended,
      status, closed: closedRootIds.has(th.rootId),
    };
  });
  // 롱체인 룰: rootId 유니크(인덱스가 루트별 1행) → 물리 중복 없음. 최신 활동 체인이 본문,
  // 접힌 것(아카이브)은 closed=true로 유지 — 물리 삭제 없음("각 사용자 DB로 기록" 9/27 계승).
  // 정렬: 활성 > 종료, 그룹 내 최신 활동순 (마감된 것은 리스트 하단).
  return out.sort((a, b) => (a.closed === b.closed
    ? (a.ended === b.ended ? (b.lastActivity > a.lastActivity ? 1 : -1) : a.ended ? 1 : -1)
    : a.closed ? 1 : -1));
}

export const CHAIN_COLORS: Record<ChainStatus, string> = {
  pending: '#D97706',   // colors.statusWarn — 답변 계산 중(mempool 미채택)
  confirmed: '#16A34A', // colors.statusOk — 완료(컨펌)
  stalled: '#DC2626',   // colors.statusErr — 합의 안 돼 멈춤(승인·선택 대기/재시도)
};

/** 닫기 가능 = confirmed 전용 (대표님 10/4: "쓰레드가 완료되면 내가 닫을 수 있어야 돼"). */
export const canCloseChain = (card: SideChainCard): boolean => card.status === 'confirmed';

/** 일괄 닫기 대상 — 현재 초록(미클로즈) 카드 id 목록 */
export const closableConfirmedIds = (cards: SideChainCard[]): string[] =>
  cards.filter((c) => !c.closed && c.status === 'confirmed').map((c) => c.rootId);

// ── 아카이브 저장 포맷 (localStorage; draftStore와 동일 철학 — 네이티브/차단 브라우저는 no-op) ──
export type ArchiveMap = Record<string, string>; // rootId → close 시각(ISO)

export function parseArchiveMap(raw: unknown): ArchiveMap {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: ArchiveMap = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {}; // 오염 데이터는 빈 지도로 복귀 (리스트가 죽으면 안 된다)
  }
}

export function serializeArchiveMap(map: ArchiveMap): string {
  return JSON.stringify(map);
}

export const closedRootSet = (map: ArchiveMap): Set<string> => new Set(Object.keys(map));

// ── 하드포크(새프로젝트) 리스트 — 세션 목록에서 같은 에이전트의 체인만 골라 계보 2단계 붙인다 ──
export interface ProjectRow {
  id: string;
  title: string;
  isCurrent: boolean;
  /** 최근 활동(행 우측 '제목+최근 시각' 스펙) */
  lastActivity?: string;
  /** 포크 지점 높이(turn_index) — 원본 체인의 블록 번호. 현 체인이 갈라진 지점. */
  height?: number;
  forkedAt?: string;
  parentTitle?: string;
  grandTitle?: string;
}

interface SessionLite {
  id: string;
  title?: string;
  agent_id?: string;
  last_activity_at?: string;
  forked_from?: { session_id?: unknown; turn_index?: unknown; forked_at?: unknown };
}

const strOr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * 세션 목록(GET /api/sessions) → 좌측 프로젝트 리스트 행.
 * 에이전트 게이트: agentId를 알면 그 에이전트의 세션만(현재 세션은 agentId 불일치에도 포함 —
 * 목록 API의 agent_id 결측 방어), 순서: 최근 활동순. 계보는 forked_from.session_id 체이로
 * parent → grandparent 제목을 2단계까지만 해석(사이클·미소속 참조는 조용히 끊는다).
 */
export function buildProjectRows(sessions: SessionLite[], currentSessionId: string | null, agentId?: string | null): ProjectRow[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const mine = sessions.filter((s) => (s.id === currentSessionId) || (!agentId || s.agent_id === agentId));
  return mine
    .sort((a, b) => ((b.last_activity_at ?? '') > (a.last_activity_at ?? '') ? 1 : -1))
    .map((s) => {
      const link = s.forked_from && typeof s.forked_from === 'object' ? s.forked_from : undefined;
      const parent = link ? byId.get(strOr(link.session_id) ?? '') : undefined;
      const gLink = parent?.forked_from && typeof parent.forked_from === 'object' ? parent.forked_from : undefined;
      const grand = gLink ? byId.get(strOr(gLink.session_id) ?? '') : undefined;
      return {
        id: s.id,
        title: s.title || '',
        isCurrent: s.id === currentSessionId,
        lastActivity: strOr(s.last_activity_at),
        height: typeof link?.turn_index === 'number' ? link.turn_index : undefined,
        forkedAt: strOr(link?.forked_at),
        parentTitle: parent?.title || parent?.id,
        grandTitle: grand?.title || grand?.id,
      };
    });
}
