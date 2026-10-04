// 스레드 레일 버스 (t_fd869e5b 요구1, 대표님 10/4: "왼쪽편의 공간은 슬랙처럼 쓰레드가 발생하는 공간으로")
// 채팅 화면(useChatSession)이 소유한 스레드 인덱스/세션 메타를 레일이 구독한다 — props 드릴 대신
// 모듈 스코프 스토어 (inspectStore·useChatSession과 동일 철학). 단일 발행자는 ChatScreen뿐이다(이중 원천 금지).
import type { ThreadIndexEntry } from './chatLogic';

export interface RailState {
  sessionId: string | null;
  threads: ThreadIndexEntry[];
  /** ThreadPanel(target) 생성에 필요한 현재 채팅 메타 — 세션 없으면 null */
  meta: {
    agentName: string;
    sessionTitle?: string;
    presetCategory?: string;
    canFork: boolean;
    /** 현재 세션의 에이전트 id (라우트 파라 원료, 모르면 null) — 좌측 레일 '같은 에이전트' 게이트용 (t_00fe9b0f) */
    agentId?: string | null;
  } | null;
  /** 현재 방의 최신 확정 발화 id — 좌측 레일 '새프로젝트(하드포크)' 생성 버튼의 포크 지점 (t_00fe9b0f) */
  lastMessageId?: string | null;
}

type Listener = () => void;

const EMPTY: RailState = { sessionId: null, threads: [], meta: null, lastMessageId: null };

let current: RailState = EMPTY;
const listeners = new Set<Listener>();

export const railStore = {
  get(): RailState { return current; },
  publish(next: RailState): void {
    current = next;
    listeners.forEach((l) => { try { l(); } catch { /* 구독자 오류 격리 */ } });
  },
  reset(): void { railStore.publish(EMPTY); },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};
