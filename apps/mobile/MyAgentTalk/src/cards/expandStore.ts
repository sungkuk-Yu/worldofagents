// 카드 펼침 상태 저장소 (#51 규칙 6·7 → t_3116c5bc semantics 전환)
// - 각 카드 독립 상태 (아코디언 아님 — 여러 카드를 동시에 열어 비교 가능)
// - FlatList 재활용으로 컴포넌트 상태가 사라져도 화면(세션) 안에서 선택 유지
// - 모듈 스코프 Map이라 앱 재시작 시 초기화 — 영속 저장 불요 (지시 사항)
// t_3116c5bc: 기본값이 '펼침'으로 바뀌며 3상태 —
//   peek(id)=undefined → auto(본문 실측이 1화면 초과면 접힘), true/false → 사용자 수동 선택.
// 실측 높이 캐시(heights)도 같은 수명주기로 보유 — FlatList 재활용 시 재측정 전까지 유지.
type Listener = () => void;

const choice = new Map<string, boolean>();
const heights = new Map<string, number>();
const listeners = new Set<Listener>();

export const expandStore = {
  /** 사용자 선택 없음 = undefined (auto). */
  peek(id: string): boolean | undefined {
    return choice.get(id);
  },
  /** 펼쳐짐 여부 — 사용자 선택 우선, 없으면 auto(기본 펼침). 카드 실측 초과 여부는 CardFrame이 overlays. */
  get(id: string): boolean {
    return choice.get(id) ?? true;
  },
  /** 본문 실측 높이(px) 캐시 — 미측정 0. */
  height(id: string): number {
    return heights.get(id) ?? 0;
  },
  /** 본문 실측 반영. 값이 바뀌었을 때만 알림(측정 루프 방지의 idempotent 게이트). */
  setHeight(id: string, value: number): boolean {
    const prev = heights.get(id) ?? 0;
    if (Math.abs(prev - value) < 2) return false;
    heights.set(id, value);
    listeners.forEach((listener) => listener());
    return true;
  },
  set(id: string, value: boolean): void {
    if (choice.get(id) === value) return;
    choice.set(id, value);
    listeners.forEach((listener) => listener());
  },
  toggle(id: string, current: boolean): void {
    this.set(id, !current);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** 테스트/화면 이탈 정리용 — 운영 코드에서 일괄 초기화는 사용하지 않는다. */
  clear(): void {
    choice.clear();
    heights.clear();
    listeners.forEach((listener) => listener());
  },
};
