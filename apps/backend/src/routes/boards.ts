/**
 * /api/boards + /api/cards — 사용자별 칸반 보드 (마이그레이션 004, t_3b38c9be)
 *
 * ⚠️ board_cards는 기존 tasks 테이블(세션 스코프, 에이전트 실행 추적용)과 별개다.
 * board_cards는 사용자 개인 보드의 카드로 session_id/task FK가 없다 (api-design.md 구분 명시).
 *
 * 소유권: boards.user_id 직접 소유, board_cards는 board_id → boards.user_id로 결정.
 * 타 사용자의 보드/카드는 존재 자체를 404로 숨긴다 (002 확립 패턴).
 */
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok, ApiError, ERROR_CODES, badRequest } from '../lib/errors';
import { selectAllRows, getOwnedMessage } from '../lib/helpers';
import { messageToCard } from '../lib/recordTransform';
import { DbClient } from '../lib/supabase';
import { BoardCardsRow, BoardCardStatus, BoardsRow } from '../types/db';

const CARD_STATUSES: readonly BoardCardStatus[] = ['todo', 'doing', 'review', 'done'] as const;

/** 보드 소유권 확인 — 타 사용자/없는 보드는 모두 404 */
async function getOwnedBoard(db: DbClient, userId: string, boardId: string): Promise<BoardsRow> {
  const { data, error } = await db.from('boards').select('*')
    .eq('id', boardId).eq('user_id', userId).maybeSingle();
  if (error || !data) throw new ApiError(ERROR_CODES.NOT_FOUND, '보드를 찾을 수 없습니다.', { board_id: boardId });
  return data as BoardsRow;
}

/** 카드 소유권 확인 (보드 경유) — 타 사용자 카드는 404 */
async function getOwnedCard(db: DbClient, userId: string, cardId: string): Promise<{ card: BoardCardsRow; board: BoardsRow }> {
  const { data, error } = await db.from('board_cards').select('*').eq('id', cardId).maybeSingle();
  if (error || !data) throw new ApiError(ERROR_CODES.NOT_FOUND, '카드를 찾을 수 없습니다.', { card_id: cardId });
  const board = await getOwnedBoard(db, userId, (data as BoardCardsRow).board_id);
  return { card: data as BoardCardsRow, board };
}

/** 컬럼 내 다음 position — 기존 최대값 + 1000 (드래그 삽입은 사이 값 사용) */
async function nextCardPosition(db: DbClient, boardId: string, status: BoardCardStatus): Promise<number> {
  const rows = await selectAllRows(db, 'board_cards', { board_id: boardId, status });
  const max = rows.reduce((acc, r) => Math.max(acc, Number(r.position) || 0), 0);
  return max + 1000;
}

function pickBoardFields(body: unknown, partial: boolean) {
  const b = (body ?? {}) as { name?: unknown; description?: unknown };
  const out: Record<string, unknown> = {};
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) throw badRequest('name은 비어 있지 않은 문자열이어야 합니다.');
    if (b.name.length > 200) throw badRequest('name은 200자를 초과할 수 없습니다.');
    out.name = b.name.trim();
  }
  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== 'string') throw badRequest('description은 문자열 또는 null이어야 합니다.');
    out.description = b.description;
  }
  if (!partial && out.name === undefined) throw badRequest('보드 이름(name)은 필수입니다.');
  return out;
}

function pickCardFields(body: unknown, partial: boolean) {
  const b = (body ?? {}) as {
    title?: unknown; body?: unknown; status?: unknown; priority?: unknown;
    position?: unknown; assignee?: unknown; labels?: unknown;
  };
  const out: Record<string, unknown> = {};
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || !b.title.trim()) throw badRequest('title은 비어 있지 않은 문자열이어야 합니다.');
    if (b.title.length > 300) throw badRequest('title은 300자를 초과할 수 없습니다.');
    out.title = b.title.trim();
  }
  if (b.body !== undefined) {
    if (typeof b.body !== 'string') throw badRequest('body는 문자열이어야 합니다.');
    out.body = b.body;
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !(CARD_STATUSES as readonly string[]).includes(b.status)) {
      throw badRequest(`status는 ${CARD_STATUSES.join('/')} 중 하나여야 합니다.`);
    }
    out.status = b.status;
  }
  if (b.priority !== undefined) {
    if (typeof b.priority !== 'number' || !Number.isFinite(b.priority)) throw badRequest('priority는 숫자여야 합니다.');
    out.priority = Math.trunc(b.priority);
  }
  if (b.position !== undefined) {
    if (typeof b.position !== 'number' || !Number.isFinite(b.position)) throw badRequest('position은 숫자여야 합니다.');
    out.position = b.position;
  }
  if (b.assignee !== undefined) {
    if (b.assignee !== null && (typeof b.assignee !== 'string' || b.assignee.length > 100)) {
      throw badRequest('assignee는 100자 이하 문자열 또는 null이어야 합니다.');
    }
    out.assignee = b.assignee;
  }
  if (b.labels !== undefined) {
    if (!Array.isArray(b.labels) || b.labels.some(l => typeof l !== 'string')) throw badRequest('labels는 문자열 배열이어야 합니다.');
    out.labels = Array.from(new Set(b.labels.map(l => l.trim()).filter(Boolean))).slice(0, 30);
  }
  if (!partial && out.title === undefined) throw badRequest('카드 제목(title)은 필수입니다.');
  return out;
}

/** 카드 직렬화 — 목록/단일 응답 공통 */
function serializeCard(row: BoardCardsRow) {
  return { ...row, status: row.status ?? 'todo', priority: row.priority ?? 0, position: row.position ?? 0, labels: row.labels ?? [], assignee: row.assignee ?? null };
}

export async function boardRoutes(app: FastifyInstance) {
  // GET /api/boards — 내 보드 목록
  app.get('/', { preHandler: requireAuth }, async (request) => {
    const boards = await selectAllRows(request.db, 'boards', { user_id: request.userId });
    boards.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return ok(boards);
  });

  // POST /api/boards — 보드 생성
  app.post('/', { preHandler: requireAuth }, async (request, reply) => {
    const fields = pickBoardFields(request.body, false);
    const { data, error } = await request.db.from('boards').insert({
      user_id: request.userId,
      name: fields.name,
      description: fields.description ?? null,
    }).select().single();
    if (error || !data) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '보드 생성 실패', { detail: error?.message });
    return reply.status(201).send(ok(data));
  });

  // GET /api/boards/:id — 보드 상세 + 카드 전체 (컬럼별 position 오름차순)
  app.get('/:id', { preHandler: requireAuth }, async (request) => {
    const board = await getOwnedBoard(request.db, request.userId, (request.params as { id: string }).id);
    const cards = ((await selectAllRows(request.db, 'board_cards', { board_id: board.id })) as BoardCardsRow[])
      .map(serializeCard);
    cards.sort((a, b) => a.position - b.position || String(a.created_at).localeCompare(String(b.created_at)));
    const columns: Record<string, BoardCardsRow[]> = { todo: [], doing: [], review: [], done: [] };
    for (const card of cards) columns[card.status]?.push(card);
    return ok({ ...board, cards, columns, card_total: cards.length });
  });

  // PATCH /api/boards/:id — 보드 이름/설명 수정
  app.patch('/:id', { preHandler: requireAuth }, async (request) => {
    const board = await getOwnedBoard(request.db, request.userId, (request.params as { id: string }).id);
    const fields = pickBoardFields(request.body, true);
    if (!Object.keys(fields).length) return ok(board);
    const { data, error } = await request.db.from('boards').update(fields)
      .eq('id', board.id).eq('user_id', request.userId).select().single();
    if (error || !data) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '보드 수정 실패', { detail: error?.message });
    return ok(data);
  });

  // DELETE /api/boards/:id — 보드 삭제 (카드는 FK ON DELETE CASCADE)
  app.delete('/:id', { preHandler: requireAuth }, async (request) => {
    const board = await getOwnedBoard(request.db, request.userId, (request.params as { id: string }).id);
    // devstore는 FK cascade를 시뮬레이션하지 않으므로 카드를 먼저 정리한다 (실DB는 cascade와 동일 결과).
    await request.db.from('board_cards').delete().eq('board_id', board.id);
    const { error } = await request.db.from('boards').delete()
      .eq('id', board.id).eq('user_id', request.userId);
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '보드 삭제 실패', { detail: error.message });
    return ok({ deleted: true, id: board.id });
  });

  // POST /api/boards/:id/cards — 카드 생성
  app.post('/:id/cards', { preHandler: requireAuth }, async (request, reply) => {
    const board = await getOwnedBoard(request.db, request.userId, (request.params as { id: string }).id);
    const fields = pickCardFields(request.body, false);
    const status = (fields.status as BoardCardStatus | undefined) ?? 'todo';
    const position = fields.position !== undefined
      ? (fields.position as number)
      : await nextCardPosition(request.db, board.id, status);
    const { data, error } = await request.db.from('board_cards').insert({
      board_id: board.id,
      title: fields.title,
      body: fields.body ?? '',
      status,
      priority: fields.priority ?? 0,
      position,
      assignee: fields.assignee ?? null,
      labels: fields.labels ?? [],
      source_message_id: null,
    }).select().single();
    if (error || !data) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '카드 생성 실패', { detail: error?.message });
    return reply.status(201).send(ok(serializeCard(data as BoardCardsRow)));
  });

  // POST /api/boards/:id/cards/from-message — 대화 메시지를 카드로 생성
  app.post('/:id/cards/from-message', { preHandler: requireAuth }, async (request, reply) => {
    const board = await getOwnedBoard(request.db, request.userId, (request.params as { id: string }).id);
    const body = (request.body ?? {}) as { message_id?: unknown; title?: string; status?: string; assignee?: string | null; labels?: string[]; priority?: number };
    if (typeof body.message_id !== 'string' || !body.message_id.trim()) throw badRequest('message_id는 필수입니다.');
    const { message, session } = await getOwnedMessage(request.db, request.userId, body.message_id.trim());
    const card = messageToCard({ message, session }, body);
    if (!(CARD_STATUSES as readonly string[]).includes(card.status)) throw badRequest('status가 올바르지 않습니다.');
    const position = await nextCardPosition(request.db, board.id, card.status as BoardCardStatus);
    const { data, error } = await request.db.from('board_cards').insert({
      board_id: board.id,
      title: card.title,
      body: card.body,
      status: card.status,
      priority: card.priority,
      position,
      assignee: card.assignee,
      labels: card.labels,
      source_message_id: message.id,
    }).select().single();
    if (error || !data) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '카드 생성 실패', { detail: error?.message });
    return reply.status(201).send(ok(serializeCard(data as BoardCardsRow)));
  });
}

/** /api/cards — 카드 단위 라우트 (보드 프리픽스 밖에 등록) */
export async function cardRoutes(app: FastifyInstance) {
  // GET /api/cards/:cardId — 카드 상세
  app.get('/:cardId', { preHandler: requireAuth }, async (request) => {
    const { card } = await getOwnedCard(request.db, request.userId, (request.params as { cardId: string }).cardId);
    return ok(serializeCard(card));
  });

  // PATCH /api/cards/:cardId — 카드 수정 (status/position 이동 포함)
  // status 변경 시 position 미지정이면 새 컬럼 끝에 배치한다.
  app.patch('/:cardId', { preHandler: requireAuth }, async (request) => {
    const { card } = await getOwnedCard(request.db, request.userId, (request.params as { cardId: string }).cardId);
    const fields = pickCardFields(request.body, true);
    if (!Object.keys(fields).length) return ok(serializeCard(card));
    if (fields.status !== undefined && fields.position === undefined && fields.status !== card.status) {
      fields.position = await nextCardPosition(request.db, card.board_id, fields.status as BoardCardStatus);
    }
    const { data, error } = await request.db.from('board_cards').update(fields)
      .eq('id', card.id).eq('board_id', card.board_id).select().single();
    if (error || !data) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '카드 수정 실패', { detail: error?.message });
    return ok(serializeCard(data as BoardCardsRow));
  });

  // DELETE /api/cards/:cardId — 카드 삭제
  app.delete('/:cardId', { preHandler: requireAuth }, async (request) => {
    const { card } = await getOwnedCard(request.db, request.userId, (request.params as { cardId: string }).cardId);
    const { error } = await request.db.from('board_cards').delete()
      .eq('id', card.id).eq('board_id', card.board_id);
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '카드 삭제 실패', { detail: error.message });
    return ok({ deleted: true, id: card.id });
  });
}
