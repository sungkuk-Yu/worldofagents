/**
 * 칸반 순수 로직 — Wave 2 (t_174b66d2)
 * 백엔드 /api/boards·/api/cards 계약(api-design.md, 마이그레이션 004)과 동일 형식의
 * 컬럼/position 계산을 UI 없이 수행하는 모듈. 단위 테스트 대상.
 *
 * position 규칙(백엔드 boards.ts와 동일): 컬럼 끝 = max+1000, 사이 삽입 = 인접 값의 중간점.
 * 낙관적 업데이트(드롭 즉시 이동 → PATCH 실패 시 원래 컬럼/position 롤백)에서
 * 롤백 기준을 화면이 아니라 이 함수 결과(이전 스냅샷)로 갖기 위해 이동 계산은 순수 함수로 분리한다.
 */

export const BOARD_COLUMNS = ['todo', 'doing', 'review', 'done'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const isBoardColumn = (value: unknown): value is BoardColumn =>
  typeof value === 'string' && (BOARD_COLUMNS as readonly string[]).includes(value);

/** 보드 카드 — GET /api/boards/:id 응답 data.cards와 동일 셸(서버 직렬화 필드) */
export interface BoardCardDto {
  id: string;
  board_id: string;
  title: string;
  body: string;
  status: string;
  priority: number;
  position: number;
  assignee: string | null;
  labels: string[];
  source_message_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ColumnMap = Record<BoardColumn, BoardCardDto[]>;

const sortColumn = (cards: BoardCardDto[]) =>
  [...cards].sort((a, b) => (a.position - b.position) || (a.id < b.id ? -1 : 1));

/** 카드를 4개 컬럼으로 분류 + 컬럼 내 position 오름차순. 미지의 status는 todo로 폴백(서버가 400을 내기 전 방어). */
export function groupCardsByColumn(cards: BoardCardDto[]): ColumnMap {
  const map: ColumnMap = { todo: [], doing: [], review: [], done: [] };
  for (const card of cards) {
    const column = isBoardColumn(card.status) ? card.status : 'todo';
    map[column].push(card);
  }
  for (const column of BOARD_COLUMNS) map[column] = sortColumn(map[column]);
  return map;
}

/**
 * 두 인접 position 사이 값 — 백엔드 nextCardPosition(max+1000) 간격과 동일한 스케일.
 * before만 있으면 뒤로 +1000, after만 있으면 앞으로 -1000, 둘 다 없으면 1000.
 * 중간점이 정수로 좁혀지지 않으면(Math.floor(a)+1===b) a에 0.5를 더해 사이를 확보한다(서버 position은 float 허용).
 */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  const a = typeof before === 'number' && Number.isFinite(before) ? before : null;
  const b = typeof after === 'number' && Number.isFinite(after) ? after : null;
  if (a === null && b === null) return 1000;
  if (a !== null && b === null) return a + 1000;
  if (a === null && b !== null) return b - 1000;
  const x = a as number;
  const y = b as number;
  if (y - x > 1) return Math.round(((x + y) / 2) * 1000) / 1000;
  return x + 0.5; // 초밀착 구간 — float로 강제 삽입
}

/**
 * 컬럼 목록(columnCards)의 toIndex 자리에 카드를 떨어뜨릴 때의 새 position.
 * toIndex=0 → 앞 카드들보다 작게, toIndex=length → 뒤보다 크게. 드래그 중인 카드 자신은
 * 호출자가 제거한 목록을 넘기는 것이 계약(이동 후 인덱스 기준).
 */
export function dropPosition(columnCards: BoardCardDto[], toIndex: number): number {
  const sorted = sortColumn(columnCards);
  const index = Math.max(0, Math.min(toIndex, sorted.length));
  const before = index > 0 ? sorted[index - 1].position : null;
  const after = index < sorted.length ? sorted[index].position : null;
  return positionBetween(before, after);
}

export interface MoveResult {
  status: BoardColumn;
  position: number;
  /** PATCH /api/cards/:id body — 화면은 이 객체를 그대로 서버로 보낸다 */
  patch: { status: BoardColumn; position: number };
}

/**
 * 이동 확정 — 카드(현재 컬럼 목록 기준)를 toStatus의 toIndex에 삽입한 결과를 계산한다.
 * 같은 컬럼 내 재정렬도 지원. 반환 patch.position이 인접 중간점이므로 서버는 그대로 저장만 하면 된다.
 */
export function moveCard(
  cards: BoardCardDto[], cardId: string, toStatus: BoardColumn, toIndex: number
): MoveResult | null {
  const card = cards.find((c) => c.id === cardId);
  if (!card) return null;
  const target = cards.filter((c) => c.id !== cardId && (isBoardColumn(c.status) ? c.status : 'todo') === toStatus);
  const position = dropPosition(target, toIndex);
  return { status: toStatus, position, patch: { status: toStatus, position } };
}

/** 컬럼 헤더 표시용 — 카드 수 배지 */
export const columnCounts = (map: ColumnMap): Record<BoardColumn, number> => ({
  todo: map.todo.length, doing: map.doing.length, review: map.review.length, done: map.done.length,
});

/** from-message 카드 라벨(from-message/dialogue_type) — 보드 카드 배지 필터용 */
export const isFromMessageCard = (card: BoardCardDto): boolean =>
  Array.isArray(card.labels) && card.labels.includes('from-message');
