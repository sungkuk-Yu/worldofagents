// 컨텍스트 패널 카드 인스펙터 — 채팅 화면에서 '포커스된 카드'를 우측 상시 패널에 비추는 버스.
// 화면 간 props 드릴 대신 모듈 스코프 스토어(useChatSession과 동일 철학). PC 3패널 전용 사용.
type Listener = () => void;

let inspectedId: string | null = null;
const listeners = new Set<Listener>();

export const inspectStore = {
  get(): string | null {
    return inspectedId;
  },
  set(id: string | null): void {
    if (inspectedId === id) return;
    inspectedId = id;
    listeners.forEach((l) => { try { l(); } catch { /* 구독자 오류 격리 */ } });
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};
