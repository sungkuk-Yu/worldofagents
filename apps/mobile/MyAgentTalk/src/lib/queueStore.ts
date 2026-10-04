// 전역 큐 상태 버스 — 진행 중 질문 시각화(t_140ecc15)의 비-prop 소비자용 모듈 스코프 스토어.
// inspectStore와 동일 철학(화면 간 props 드릴 대신 모듈 스코프, 단일 원천은 useChatSession):
// 카드 레지스트리(StreamCard — props로 화면 상태를 받을 수 없는 렌더 경로)와 메시지 행 마커
// (QueueMessageMark)가 렌더 시점에 읽는다.
// 쓰기 소유권: useChatSession의 메인 세션(루트 세션)만 — 스레드 세션이 덮어쓰면 메인 피드의
// 배지/문구가 스레드 창으로 오염된다. 스레드(rootMessageId) 경로에서는 set 호출 자체가 없다.
// 읽기 규범: get()은 마지막 set의 스냅샷(불변 참조) — re-render마다 새 객체를 만들지 않는다.
import type { QueueView } from './queueVisibility';
import { deriveQueueView } from './queueVisibility';

type Listener = () => void;

let view: QueueView = deriveQueueView([], [], []);
const listeners = new Set<Listener>();

export const queueStore = {
  get(): QueueView {
    return view;
  },
  /** 메인 세션 파생 결과로 교체 (useChatSession의 queueView useMemo가 유일한 산출자). */
  set(next: QueueView): void {
    if (view === next) return;
    view = next;
    listeners.forEach((l) => { try { l(); } catch { /* 구독자 오류 격리 */ } });
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};
