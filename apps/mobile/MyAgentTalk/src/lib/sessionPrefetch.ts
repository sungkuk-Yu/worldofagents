// t_710b5d28 — 진입 prefetch (탭 시점 = fetch 출발, 마운트 후 왕복 제거)
// useChatSession에서 분리한 이유: 목록 화면이 그 훅을 import하면 채팅 모듈 전체(chatLogic·cardLogic…)가
// 부트 그래프에 끌려 __common(카드 스택·victory 포함)이 eager 강제로드된다. 리스는 부트 그래프에
// 새 의존을 추가하지 말 것 — 이 파일은 api.ts(entry 기존 의존)만 쓴다.
//
// 계약 1 (채팅 히스토리): 세션 행 onPress에서 prefetchSessionMessages(id) → 첫 init refresh의
//   GET을 1회 소비. 서버에 Cache-Control이 없어(실측 10/4: 응답 헤더 없음) HTTP 캐시 재사용은
//   불가 — in-memory single-use로 대신한다. TTL 초과/오답은 무효(정상 fetch 폴백), 소비 즉시
//   삭제라 focus 재refresh는 반드시 서버를 읽는다(캐논 계약 유지). 실패 prefetch는 조용히 버려진다.
// 계약 2 (부트 목록): 부트스트랩 시 토큰이 있으면 listAgents+listSessions를 스플래시·폰트 로드와
//   병렬로 출발. DialogueList 첫 refresh가 신선한 결과 있으면 1회 소비(없으면 정상 fetch).
//   낙관 캐시와 합세: 행 = 캐시 즉시 페인트, 서버 데이터 = 도착 즉시 대체.
import { api, type ApiEnvelope, type ServerChatMessage } from './api';

const PREFETCH_TTL_MS = 5000;

interface HistoryEntry { promise: Promise<ApiEnvelope<ServerChatMessage[]> | null>; at: number }
const historyPrefetch = new Map<string, HistoryEntry>();
const HISTORY_PAGE_SIZE = 30; // useChatSession.PAGE_SIZE와 동일 유지(소비측이 limit 무시, 재조회 시 동일 커서 계약)

export function prefetchSessionMessages(sessionId: string): void {
  if (historyPrefetch.has(sessionId)) return; // 이중 탭 = 단일 왕복
  historyPrefetch.set(sessionId, {
    promise: api.getMessages(sessionId, { limit: HISTORY_PAGE_SIZE }).catch(() => null),
    at: Date.now(),
  });
}

/** init refresh용 소비: 신선한 prefetch 있으면 회수(1회), 없으면 null → 호출자 정상 fetch. */
export async function consumePrefetchedHistory(sessionId: string): Promise<ApiEnvelope<ServerChatMessage[]> | null> {
  const entry = historyPrefetch.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.at > PREFETCH_TTL_MS) { historyPrefetch.delete(sessionId); return null; }
  historyPrefetch.delete(sessionId);
  return await entry.promise;
}

interface BootListsEntry { promise: Promise<null | { agents: Awaited<ReturnType<typeof api.listAgents>>; sessions: Awaited<ReturnType<typeof api.listSessions>> }>; at: number }
let bootLists: BootListsEntry | null = null;

export function prefetchBootLists(): void {
  if (bootLists) return; // 부트 1회 — focus 재refresh는 서버 캐논을 읽는다
  bootLists = {
    at: Date.now(),
    promise: Promise.all([api.listAgents(), api.listSessions()])
      .then(([agents, sessions]) => (agents.ok && sessions.ok ? { agents, sessions } : null))
      .catch(() => null),
  };
}

export async function consumeBootLists(): Promise<{ agents: Awaited<ReturnType<typeof api.listAgents>>; sessions: Awaited<ReturnType<typeof api.listSessions>> } | null> {
  const entry = bootLists;
  if (!entry) return null;
  if (Date.now() - entry.at > PREFETCH_TTL_MS * 4) { bootLists = null; return null; } // 20s — 부트 레이스 창만 커버
  bootLists = null; // 회수 즉시 소멸 (focus 리프레시 = 서버 캐논 보장)
  return await entry.promise;
}
