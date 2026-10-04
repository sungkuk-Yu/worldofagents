// t_710b5d28 — 대화 목록 낙관 캐시 (첫 진입 '지연' 체감의 주범: 부트 후 RTT 동안 스피너만 보이던 창)
// 정책: 서버 refresh 성공 시 스냅샷을 localStorage에 쓴다 → 다음 부트(서버 응답 이전)에 그 스냅샷으로
//       목록을 즉시 렌더(서버 응답이 오면 그대로 대체 — 캐논은 서버, 캐시는 체감만 담당).
// 계정 격리: 키에 토큮의 서명부(payload 시그니처 아님 — JWT 3번째 세그먼트) 해시를 포함한다.
//   다른 계정으로 재로그인하면 이전 계정 스냅샷이 절대 읽히지 않는다(제목/라인업 잔상 유출 방지).
// 용량: 행 50개·본문 20KB 상한 초과 시 파기(읽기 실패는 조용히 미스 — 캐시는 best-effort).
import type { AgentSummary, SessionSummary } from './api';

export const SESSION_CACHE_MAX_ROWS = 50;
export const SESSION_CACHE_MAX_BYTES = 20 * 1024;

// 저장 형태 (버전 필드로 호환성 검사)
export interface SessionSnapshot {
  v: 1;
  sessions: SessionSummary[];
  agents: AgentSummary[];
  at: number; // 기록 시각(ms) — 표시만, 만료 판정 없음(서버가 매 부트 캐논 대체)
}

/** 토큮 지문: JWT 서명 세그먼트의 비암호 해시(djb2). 토큰 원문은 어디에도 저장하지 않는다. */
export function tokenFingerprint(token: string): string {
  const seg = token.split('.')[2] || token;
  let h = 5381;
  for (let i = 0; i < seg.length; i++) h = ((h << 5) + h + seg.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function sessionCacheKey(token: string): string {
  return `at-sesslist-v1.${tokenFingerprint(token)}`;
}

function store(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null; // 사모드/차단 브라우저 — 캐시 없이 현행(스피너) 경로 그대로
  }
}

/** 서버 응답 정규화: 배열이 아니면 빈 배열, 50행 절두, id 문자열 보장. */
export function normalizeSnapshot(sessions: unknown, agents: unknown): SessionSnapshot | null {
  if (!Array.isArray(sessions) || !Array.isArray(agents)) return null;
  const okSession = (s: unknown): s is SessionSummary =>
    !!s && typeof s === 'object' && typeof (s as SessionSummary).id === 'string';
  const okAgent = (a: unknown): a is AgentSummary =>
    !!a && typeof a === 'object' && typeof (a as AgentSummary).id === 'string';
  return {
    v: 1,
    sessions: sessions.filter(okSession).slice(0, SESSION_CACHE_MAX_ROWS),
    agents: agents.filter(okAgent).slice(0, SESSION_CACHE_MAX_ROWS),
    at: Date.now(),
  };
}

export function writeSessionCache(token: string, sessions: unknown, agents: unknown): void {
  const ls = store();
  if (!ls || !token) return;
  const snap = normalizeSnapshot(sessions, agents);
  if (!snap) return;
  try {
    const json = JSON.stringify(snap);
    if (json.length > SESSION_CACHE_MAX_BYTES) return; // 이상 형태 — 조용히 파기
    ls.setItem(sessionCacheKey(token), json);
  } catch { /* 용량/차단 — 무시 */ }
}

export function readSessionCache(token: string | null): SessionSnapshot | null {
  const ls = store();
  if (!ls || !token) return null;
  try {
    const raw = ls.getItem(sessionCacheKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.agents)) return null;
    return parsed;
  } catch {
    return null; // 파손 캐시 = 미스
  }
}

/** 로그아웃 시 자기 스냅샷만 제거(계정별 키라 남의 계정에 영향 없음). */
export function clearSessionCache(token: string | null): void {
  const ls = store();
  if (!ls || !token) return;
  try { ls.removeItem(sessionCacheKey(token)); } catch { /* 무시 */ }
}
