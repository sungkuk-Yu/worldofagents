// 카드 펼침 상태 저장소 (#51 규칙 6·7)
// - 각 카드 독립 상태 (아코디언 아님 — 여러 카드를 동시에 열어 비교 가능)
// - FlatList 재활용으로 컴포넌트 상태가 사라져도 화면(세션) 안에서 펼쳐둔 상태 유지
// - 모듈 스코프 Map이라 앱 재시작 시 초기화 — 영속 저장 불요 (지시 사항)
type Listener = () => void;

const expanded = new Map<string, boolean>();
const listeners = new Set<Listener>();

export const expandStore = {
  get(id: string): boolean {
    return expanded.get(id) === true;
  },
  set(id: string, value: boolean): void {
    if (expanded.get(id) === value) return;
    if (value) expanded.set(id, true);
    else expanded.delete(id);
    listeners.forEach((listener) => listener());
  },
  toggle(id: string): void {
    expandStore.set(id, !expandStore.get(id));
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** 테스트/화면 이탈 정리용 — 운영 코드에서 일괄 초기화는 사용하지 않는다. */
  clear(): void {
    expanded.clear();
    listeners.forEach((listener) => listener());
  },
};
