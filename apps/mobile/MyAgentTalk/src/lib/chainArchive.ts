// 사이드체인 아카이브 스토어 (t_00fe9b0f — 대표님 10/4: "쓰레드가 완료되면 내가 닫을 수 있어야 돼").
// 닫기 = #555 아카이브 시맨틱: 물리 삭제 없이 '리스트에서 접기'만 — 원 질문 뱃지 'n closed'로 재개방 가능
// (상태가 다시 빨강/주황로 돌아올 수 있으므로 영구 삭제가 아니다).
// 세션 스코프 localStorage(draftStore와 동일 철학: 네이티브/차단 브라우저는 조용히 no-op, 메모리만 유지).
// 발행자=본 파일(단일 원천), 구독=우측 패널/트래커 뱃지 — ChatScreen의 railStore publish처럼 화면이 중재하지 않는다.
import { parseArchiveMap, serializeArchiveMap, type ArchiveMap } from './chainLogic';

const KEY = (sessionId: string) => `at-chain-archive-${sessionId}`;

function store(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

type Listener = () => void;

let sessionId: string | null = null;
let current: ArchiveMap = {};
const listeners = new Set<Listener>();
const memoryFallback = new Map<string, ArchiveMap>(); // localStorage 부재 환경(네이티브)의 세션별 메모리

function load(sid: string): ArchiveMap {
  const ls = store();
  if (ls) return parseArchiveMap(ls.getItem(KEY(sid)));
  return memoryFallback.get(sid) ?? {};
}

function persist(map: ArchiveMap): void {
  if (sessionId === null) return;
  const ls = store();
  if (ls) {
    try {
      const raw = serializeArchiveMap(map);
      if (Object.keys(map).length) ls.setItem(KEY(sessionId), raw);
      else ls.removeItem(KEY(sessionId));
    } catch { /* 할당 실패 — 메모리 상태는 유지 */ }
  } else {
    memoryFallback.set(sessionId, map);
  }
}

function emit(): void {
  listeners.forEach((l) => { try { l(); } catch { /* 구독자 오류 격리 */ } });
}

export const chainArchive = {
  /** 화면 마운트/세션 전환 시 호출 — 그 세션의 아카이브로 스위치(이전 세션 닫힘 상태가 붙으면 안 됨) */
  bind(sid: string | null): void {
    if (sid === sessionId) return;
    sessionId = sid;
    current = sid ? load(sid) : {};
    emit();
  },
  get sessionId(): string | null { return sessionId; },
  get(): ArchiveMap { return current; },
  isClosed(rootId: string): boolean { return Object.prototype.hasOwnProperty.call(current, rootId); },
  close(rootId: string): void {
    if (!rootId || current[rootId]) return;
    current = { ...current, [rootId]: new Date().toISOString() };
    persist(current);
    emit();
  },
  reopen(rootId: string): void {
    if (!current[rootId]) return;
    const next = { ...current };
    delete next[rootId];
    current = next;
    persist(current);
    emit();
  },
  /** 일괄 닫기 (우측 헤더 '완료된 것 정리') — 반환값은 undo용 스냅샷 */
  closeMany(rootIds: string[]): ArchiveMap {
    const snapshot = current;
    if (!rootIds.length) return snapshot;
    const now = new Date().toISOString();
    const next = { ...current };
    for (const id of rootIds) next[id] = now;
    current = next;
    persist(current);
    emit();
    return snapshot;
  },
  undo(snapshot: ArchiveMap): void {
    current = snapshot;
    persist(current);
    emit();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};
