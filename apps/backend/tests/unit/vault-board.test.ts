/**
 * 사용자별 볼트(vault_notes) + 칸반(boards/board_cards) 단위 테스트 (마이그레이션 004, t_3b38c9be)
 *
 * 검증 범위:
 * - 노트 CRUD / 폴더 트리 / 검색 / from-message 변환
 * - 보드·카드 CRUD / status 이동(position 자동 배치) / from-message 카드
 * - 크로스 계정 격리: B는 A의 노트/보드/카드에 절대 접근 불가 (404로 존재 숨김)
 * - 회원탈퇴(DELETE /api/me) cascade — devstore 시뮬레이션
 *
 * 주의: helpers.createTestApp은 resetStore로 스토어 싱글턴을 교체하지만 supabaseAdmin은
 * import 시점 스토어를 계속 참조한다 — favorites/thread-fork.test.ts와 동일하게
 * build()만 호출해 getStore()와 라우트 DB의 정합성을 유지한다 (vitest 파일별 모듈 격리).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, build } from '../../src/index';
import { signup, createFullStack, bearer } from '../helpers';
import { getStore } from '../../src/lib/supabase';
import { normalizeFolder, messageToNote, messageToCard } from '../../src/lib/recordTransform';
import { buildFolderTree } from '../../src/routes/vault';

let aToken: string;
let aId: string;
let bToken: string;
let bId: string;
let aMessageId: string;
let aSessionId: string;

beforeAll(async () => {
  await build();
  const a = await signup(app, 'alice-vault@test.io');
  aToken = a.token;
  aId = a.userId;
  const b = await signup(app, 'bob-vault@test.io');
  bToken = b.token;
  bId = b.userId;
  // A의 대화 메시지 확보 (from-message 변환 대상)
  const stack = await createFullStack(app, aToken);
  aSessionId = stack.session.id;
  const msgRes = await app.inject({
    method: 'POST',
    url: `/api/sessions/${aSessionId}/messages`,
    headers: bearer(aToken),
    payload: { content: '볼트에 저장할 중요한 메모입니다' },
  });
  aMessageId = msgRes.json().data.answer_message_id || msgRes.json().data.user_message_id;
  expect(aMessageId).toBeTruthy();
});

afterAll(async () => {
  await app.close();
});

// ── 순수 함수 ─────────────────────────────────────────
describe('recordTransform 순수 함수', () => {
  it('normalizeFolder — 루트/중복슬래시/후행슬래시 정규화', () => {
    expect(normalizeFolder('/')).toBe('/');
    expect(normalizeFolder(undefined)).toBe('/');
    expect(normalizeFolder('업무/메모')).toBe('/업무/메모');
    expect(normalizeFolder('//업무//메모//')).toBe('/업무/메모');
    expect(normalizeFolder('  ')).toBe('/');
  });

  it('messageToNote — 메타 헤더 + 원문 보존 + 제목 파생', () => {
    const message = {
      id: 'm1', session_id: 's1', role: 'agent', content: '# 결론\n\n본문 내용',
      dialogue_type: 'info_card', created_at: '2026-09-26T01:02:03.000Z',
    } as any;
    const session = { id: 's1' } as any;
    const note = messageToNote({ message, session, agentName: '김비서' });
    expect(note.content).toContain('# 결론');
    expect(note.content).toContain('본문 내용');
    expect(note.content).toContain('speaker: 에이전트 · 김비서');
    expect(note.content).toContain('dialogue_type: info_card');
    expect(note.content).toContain('message_id: m1');
    expect(note.title).toBe('결론');
    expect(note.folder).toBe('/대화');
    expect(note.tags).toContain('대화저장');
  });

  it('messageToCard — 제목 파생 + from-message 라벨', () => {
    const message = { id: 'm2', content: '- [ ] 할 일 첫줄\n두번째', dialogue_type: 'task_flow' } as any;
    const card = messageToCard({ message, session: { id: 's1' } as any });
    expect(card.title).toBe('할 일 첫줄');
    expect(card.status).toBe('todo');
    expect(card.labels).toEqual(expect.arrayContaining(['from-message', 'task_flow']));
  });

  it('buildFolderTree — 중간 폴더 자동 생성 + 정렬', () => {
    const tree = buildFolderTree(['/b/c', '/a', '/b/c', '/']);
    expect(tree.path).toBe('/');
    expect(tree.children.map(c => c.name)).toEqual(['a', 'b']);
    expect(tree.children[1].children[0].path).toBe('/b/c');
  });
});

// ── 노트 CRUD ─────────────────────────────────────────
describe('vault 노트 CRUD', () => {
  let noteId: string;

  it('POST /api/vault/notes → 201 + devstore 실 행 (user_id 소유)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/vault/notes', headers: bearer(aToken),
      payload: { title: '첫 노트', content: '마크다운 [[링크]] 보존', folder: '업무/2026', tags: ['중요', '중요', 'x'] },
    });
    expect(res.statusCode).toBe(201);
    const note = res.json().data;
    noteId = note.id;
    expect(note.user_id).toBe(aId);
    expect(note.folder).toBe('/업무/2026');
    expect(note.tags).toEqual(['중요', 'x']); // 중복 제거
    expect(note.content).toContain('[[링크]]'); // wikilink 원문 보존
    // devstore 실 행 read-back
    const rows = getStore().tables.vault_notes.filter(r => r.id === noteId);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(aId);
  });

  it('POST validation — title 누락 400, tags 비문자열 400', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/api/vault/notes', headers: bearer(aToken), payload: { content: 'x' } });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({ method: 'POST', url: '/api/vault/notes', headers: bearer(aToken), payload: { title: 'ok', tags: [1, 2] } });
    expect(r2.statusCode).toBe(400);
  });

  it('GET 목록 + 폴더/태그 필터 + 페이지네이션', async () => {
    await app.inject({ method: 'POST', url: '/api/vault/notes', headers: bearer(aToken), payload: { title: '두번째', folder: '/업무', tags: ['기타'] } });
    const all = await app.inject({ method: 'GET', url: '/api/vault/notes', headers: bearer(aToken) });
    expect(all.statusCode).toBe(200);
    expect(all.json().data.length).toBeGreaterThanOrEqual(2);
    expect(all.json().meta.total).toBeGreaterThanOrEqual(2);
    const byFolder = await app.inject({ method: 'GET', url: '/api/vault/notes?folder=/업무', headers: bearer(aToken) });
    expect(byFolder.json().data.every((n: any) => n.folder === '/업무')).toBe(true);
    const byTag = await app.inject({ method: 'GET', url: '/api/vault/notes?tag=중요', headers: bearer(aToken) });
    expect(byTag.json().data.length).toBe(1);
    const page = await app.inject({ method: 'GET', url: '/api/vault/notes?limit=1&offset=0', headers: bearer(aToken) });
    expect(page.json().data).toHaveLength(1);
    expect(page.json().meta.has_more).toBe(true);
  });

  it('GET /:id + PATCH 부분 수정 + updated_at 갱신', async () => {
    const get1 = await app.inject({ method: 'GET', url: `/api/vault/notes/${noteId}`, headers: bearer(aToken) });
    expect(get1.statusCode).toBe(200);
    expect(get1.json().data.title).toBe('첫 노트');

    const patch = await app.inject({
      method: 'PATCH', url: `/api/vault/notes/${noteId}`, headers: bearer(aToken),
      payload: { title: '수정된 노트', folder: '/업무/2026/9월', backlinks: [{ id: 'x', title: 'y' }] },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.title).toBe('수정된 노트');
    expect(patch.json().data.folder).toBe('/업무/2026/9월');
    expect(patch.json().data.backlinks).toEqual([{ id: 'x', title: 'y' }]);
    // content 미지정 시 원문 보존
    expect(patch.json().data.content).toContain('[[링크]]');
    expect(new Date(patch.json().data.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(get1.json().data.updated_at).getTime());
  });

  it('GET /api/vault/tree — 폴더 트리 + note_count', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vault/tree', headers: bearer(aToken) });
    expect(res.statusCode).toBe(200);
    const { tree, note_total } = res.json().data;
    expect(note_total).toBeGreaterThanOrEqual(2);
    expect(tree.path).toBe('/');
    const paths: string[] = [];
    const walk = (n: any) => { paths.push(n.path); n.children.forEach(walk); };
    walk(tree);
    expect(paths).toContain('/업무');
    expect(paths).toContain('/업무/2026/9월');
  });

  it('GET /api/vault/search — title/content ILIKE 동등 + q 필수', async () => {
    const hit = await app.inject({ method: 'GET', url: '/api/vault/search?q=링크', headers: bearer(aToken) });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().data.length).toBe(1);
    expect(hit.json().data[0].id).toBe(noteId);
    expect(hit.json().data[0].snippet).toContain('링크');
    const byTitle = await app.inject({ method: 'GET', url: '/api/vault/search?q=수정된', headers: bearer(aToken) });
    expect(byTitle.json().data.length).toBe(1);
    const miss = await app.inject({ method: 'GET', url: '/api/vault/search?q=없는단어zzz', headers: bearer(aToken) });
    expect(miss.json().data).toHaveLength(0);
    const noQ = await app.inject({ method: 'GET', url: '/api/vault/search', headers: bearer(aToken) });
    expect(noQ.statusCode).toBe(400);
    const unauth = await app.inject({ method: 'GET', url: '/api/vault/search?q=x' });
    expect(unauth.statusCode).toBe(401);
  });

  it('POST /api/vault/notes/from-message — 메시지→마크다운 노트 변환 저장', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/vault/notes/from-message', headers: bearer(aToken),
      payload: { message_id: aMessageId },
    });
    expect(res.statusCode).toBe(201);
    const note = res.json().data;
    expect(note.source_message_id).toBe(aMessageId);
    expect(note.source_session_id).toBe(aSessionId);
    expect(note.user_id).toBe(aId);
    expect(note.content).toContain('dialogue_type:');
    expect(note.tags).toContain('대화저장');
    // devstore 실 행 read-back
    expect(getStore().tables.vault_notes.some(r => r.id === note.id && r.source_message_id === aMessageId)).toBe(true);
  });

  it('from-message — message_id 누락 400, 타 사용자 메시지 404', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/api/vault/notes/from-message', headers: bearer(aToken), payload: {} });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({ method: 'POST', url: '/api/vault/notes/from-message', headers: bearer(bToken), payload: { message_id: aMessageId } });
    expect(r2.statusCode).toBe(404);
  });

  it('DELETE /api/vault/notes/:id → devstore 행 제거', async () => {
    const del = await app.inject({ method: 'DELETE', url: `/api/vault/notes/${noteId}`, headers: bearer(aToken) });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.deleted).toBe(true);
    expect(getStore().tables.vault_notes.some(r => r.id === noteId)).toBe(false);
    const gone = await app.inject({ method: 'GET', url: `/api/vault/notes/${noteId}`, headers: bearer(aToken) });
    expect(gone.statusCode).toBe(404);
  });

  it('인증 없으면 전 엔드포인트 401', async () => {
    for (const [method, url] of [['GET', '/api/vault/notes'], ['POST', '/api/vault/notes'], ['GET', '/api/vault/tree']] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }
  });
});

// ── 보드/카드 CRUD ────────────────────────────────────
describe('boards/board_cards CRUD', () => {
  let boardId: string;
  let cardId: string;
  let cardId2: string;

  it('POST /api/boards → 201 + devstore 실 행', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/boards', headers: bearer(aToken),
      payload: { name: '제품 로드맵', description: '4분기 계획' },
    });
    expect(res.statusCode).toBe(201);
    boardId = res.json().data.id;
    expect(res.json().data.user_id).toBe(aId);
    expect(getStore().tables.boards.some(r => r.id === boardId && r.user_id === aId)).toBe(true);
    const bad = await app.inject({ method: 'POST', url: '/api/boards', headers: bearer(aToken), payload: { name: '  ' } });
    expect(bad.statusCode).toBe(400);
  });

  it('GET /api/boards 목록 + PATCH 이름 수정', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/boards', headers: bearer(aToken) });
    expect(list.json().data.some((b: any) => b.id === boardId)).toBe(true);
    const patch = await app.inject({ method: 'PATCH', url: `/api/boards/${boardId}`, headers: bearer(aToken), payload: { name: '제품 로드맵 v2' } });
    expect(patch.json().data.name).toBe('제품 로드맵 v2');
  });

  it('POST /api/boards/:id/cards → 201 + position 자동 배치 (1000 간격)', async () => {
    const c1 = await app.inject({
      method: 'POST', url: `/api/boards/${boardId}/cards`, headers: bearer(aToken),
      payload: { title: '스키마 설계', body: '004 마이그레이션', labels: ['backend'] },
    });
    expect(c1.statusCode).toBe(201);
    cardId = c1.json().data.id;
    expect(c1.json().data.status).toBe('todo');
    expect(c1.json().data.position).toBe(1000);

    const c2 = await app.inject({
      method: 'POST', url: `/api/boards/${boardId}/cards`, headers: bearer(aToken),
      payload: { title: 'API 구현', assignee: '백개발', priority: 2 },
    });
    cardId2 = c2.json().data.id;
    expect(c2.json().data.position).toBe(2000);
    expect(c2.json().data.assignee).toBe('백개발');
    // devstore 실 행
    expect(getStore().tables.board_cards.some(r => r.id === cardId && r.board_id === boardId)).toBe(true);
  });

  it('카드 생성 validation — status 오염값 400, title 누락 400', async () => {
    const r1 = await app.inject({ method: 'POST', url: `/api/boards/${boardId}/cards`, headers: bearer(aToken), payload: { title: 'x', status: 'blocked' } });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({ method: 'POST', url: `/api/boards/${boardId}/cards`, headers: bearer(aToken), payload: { body: 'no title' } });
    expect(r2.statusCode).toBe(400);
  });

  it('GET /api/boards/:id — columns 4컬럼 + position 정렬', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/boards/${boardId}`, headers: bearer(aToken) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.card_total).toBe(2);
    expect(Object.keys(data.columns).sort()).toEqual(['doing', 'done', 'review', 'todo']);
    expect(data.columns.todo.map((c: any) => c.title)).toEqual(['스키마 설계', 'API 구현']);
  });

  it('PATCH /api/cards/:cardId — status 이동 시 새 컬럼 끝 position 자동 배치', async () => {
    const move = await app.inject({
      method: 'PATCH', url: `/api/cards/${cardId}`, headers: bearer(aToken),
      payload: { status: 'doing' },
    });
    expect(move.statusCode).toBe(200);
    expect(move.json().data.status).toBe('doing');
    expect(move.json().data.position).toBe(1000); // doing 컬럼은 비어 있었음 → 첫 카드

    const move2 = await app.inject({
      method: 'PATCH', url: `/api/cards/${cardId2}`, headers: bearer(aToken),
      payload: { status: 'doing' },
    });
    expect(move2.json().data.position).toBe(2000); // doing 컬럼 끝

    // 명시 position (드래그 삽입) + 컬럼 이동 동시
    const insert = await app.inject({
      method: 'PATCH', url: `/api/cards/${cardId2}`, headers: bearer(aToken),
      payload: { status: 'review', position: 1500 },
    });
    expect(insert.json().data.status).toBe('review');
    expect(insert.json().data.position).toBe(1500);
    // devstore 실 행 read-back
    const row = getStore().tables.board_cards.find(r => r.id === cardId2);
    expect(row.status).toBe('review');
    expect(row.position).toBe(1500);
  });

  it('PATCH 카드 필드 수정 — assignee/labels/priority/body', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/cards/${cardId}`, headers: bearer(aToken),
      payload: { assignee: '프론트개발', labels: ['ui', 'ui'], priority: 5, body: '수정됨' },
    });
    expect(res.json().data.assignee).toBe('프론트개발');
    expect(res.json().data.labels).toEqual(['ui']);
    expect(res.json().data.priority).toBe(5);
    expect(res.json().data.body).toBe('수정됨');
    // status 미변경 시 position 유지
    expect(res.json().data.status).toBe('doing');
    expect(res.json().data.position).toBe(1000);
  });

  it('GET /api/cards/:cardId 상세', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/cards/${cardId}`, headers: bearer(aToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(cardId);
  });

  it('POST /api/boards/:id/cards/from-message — 대화→카드', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/boards/${boardId}/cards/from-message`, headers: bearer(aToken),
      payload: { message_id: aMessageId, labels: ['팔로업'] },
    });
    expect(res.statusCode).toBe(201);
    const card = res.json().data;
    expect(card.source_message_id).toBe(aMessageId);
    expect(card.labels).toEqual(expect.arrayContaining(['from-message', '팔로업']));
    expect(getStore().tables.board_cards.some(r => r.id === card.id && r.source_message_id === aMessageId)).toBe(true);
    const bad = await app.inject({ method: 'POST', url: `/api/boards/${boardId}/cards/from-message`, headers: bearer(aToken), payload: {} });
    expect(bad.statusCode).toBe(400);
  });

  it('DELETE 카드 → 행 제거, DELETE 보드 → 카드 cascade', async () => {
    const delCard = await app.inject({ method: 'DELETE', url: `/api/cards/${cardId}`, headers: bearer(aToken) });
    expect(delCard.json().data.deleted).toBe(true);
    expect(getStore().tables.board_cards.some(r => r.id === cardId)).toBe(false);

    const before = getStore().tables.board_cards.filter(r => r.board_id === boardId).length;
    expect(before).toBeGreaterThanOrEqual(2);
    const delBoard = await app.inject({ method: 'DELETE', url: `/api/boards/${boardId}`, headers: bearer(aToken) });
    expect(delBoard.json().data.deleted).toBe(true);
    expect(getStore().tables.boards.some(r => r.id === boardId)).toBe(false);
    expect(getStore().tables.board_cards.filter(r => r.board_id === boardId)).toHaveLength(0);
    const gone = await app.inject({ method: 'GET', url: `/api/boards/${boardId}`, headers: bearer(aToken) });
    expect(gone.statusCode).toBe(404);
  });
});

// ── 크로스 계정 격리 (멀티테넌시) ─────────────────────
describe('크로스 계정 격리 — B는 A의 볼트/보드에 접근 불가', () => {
  let aNoteId: string;
  let aBoardId: string;
  let aCardId: string;

  beforeAll(async () => {
    const note = await app.inject({ method: 'POST', url: '/api/vault/notes', headers: bearer(aToken), payload: { title: 'A 비밀 노트', content: 'A 전용 내용' } });
    aNoteId = note.json().data.id;
    const board = await app.inject({ method: 'POST', url: '/api/boards', headers: bearer(aToken), payload: { name: 'A 보드' } });
    aBoardId = board.json().data.id;
    const card = await app.inject({ method: 'POST', url: `/api/boards/${aBoardId}/cards`, headers: bearer(aToken), payload: { title: 'A 카드' } });
    aCardId = card.json().data.id;
  });

  it('B: A 노트 상세/PATCH/DELETE → 404 (존재 숨김)', async () => {
    const g = await app.inject({ method: 'GET', url: `/api/vault/notes/${aNoteId}`, headers: bearer(bToken) });
    expect(g.statusCode).toBe(404);
    const p = await app.inject({ method: 'PATCH', url: `/api/vault/notes/${aNoteId}`, headers: bearer(bToken), payload: { title: '해킹' } });
    expect(p.statusCode).toBe(404);
    const d = await app.inject({ method: 'DELETE', url: `/api/vault/notes/${aNoteId}`, headers: bearer(bToken) });
    expect(d.statusCode).toBe(404);
    // A 데이터는 무손상
    const intact = await app.inject({ method: 'GET', url: `/api/vault/notes/${aNoteId}`, headers: bearer(aToken) });
    expect(intact.json().data.title).toBe('A 비밀 노트');
  });

  it('B: A 노트가 목록/트리/검색에 노출되지 않음', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/vault/notes', headers: bearer(bToken) });
    expect(list.json().data.some((n: any) => n.id === aNoteId)).toBe(false);
    const tree = await app.inject({ method: 'GET', url: '/api/vault/tree', headers: bearer(bToken) });
    expect(tree.json().data.note_total).toBe(0);
    const search = await app.inject({ method: 'GET', url: '/api/vault/search?q=비밀', headers: bearer(bToken) });
    expect(search.json().data).toHaveLength(0);
    // 통제군: A는 검색됨
    const aSearch = await app.inject({ method: 'GET', url: '/api/vault/search?q=비밀', headers: bearer(aToken) });
    expect(aSearch.json().data.length).toBe(1);
  });

  it('B: A 보드 상세/PATCH/DELETE → 404, B 보드 목록에 없음', async () => {
    const g = await app.inject({ method: 'GET', url: `/api/boards/${aBoardId}`, headers: bearer(bToken) });
    expect(g.statusCode).toBe(404);
    const p = await app.inject({ method: 'PATCH', url: `/api/boards/${aBoardId}`, headers: bearer(bToken), payload: { name: '해킹' } });
    expect(p.statusCode).toBe(404);
    const d = await app.inject({ method: 'DELETE', url: `/api/boards/${aBoardId}`, headers: bearer(bToken) });
    expect(d.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/boards', headers: bearer(bToken) });
    expect(list.json().data.some((b: any) => b.id === aBoardId)).toBe(false);
  });

  it('B: A 카드 상세/PATCH/DELETE → 404, A 보드에 카드 생성 불가', async () => {
    const g = await app.inject({ method: 'GET', url: `/api/cards/${aCardId}`, headers: bearer(bToken) });
    expect(g.statusCode).toBe(404);
    const p = await app.inject({ method: 'PATCH', url: `/api/cards/${aCardId}`, headers: bearer(bToken), payload: { status: 'done' } });
    expect(p.statusCode).toBe(404);
    const d = await app.inject({ method: 'DELETE', url: `/api/cards/${aCardId}`, headers: bearer(bToken) });
    expect(d.statusCode).toBe(404);
    const c = await app.inject({ method: 'POST', url: `/api/boards/${aBoardId}/cards`, headers: bearer(bToken), payload: { title: 'B 침입 카드' } });
    expect(c.statusCode).toBe(404);
    // A 카드 무손상
    const intact = await app.inject({ method: 'GET', url: `/api/cards/${aCardId}`, headers: bearer(aToken) });
    expect(intact.json().data.status).toBe('todo');
  });

  it('B: A의 메시지를 B 보드 카드로 변환 불가 (from-message 404)', async () => {
    const bBoard = await app.inject({ method: 'POST', url: '/api/boards', headers: bearer(bToken), payload: { name: 'B 보드' } });
    const bBoardId = bBoard.json().data.id;
    const res = await app.inject({
      method: 'POST', url: `/api/boards/${bBoardId}/cards/from-message`, headers: bearer(bToken),
      payload: { message_id: aMessageId },
    });
    expect(res.statusCode).toBe(404);
    expect(getStore().tables.board_cards.some(r => r.board_id === bBoardId)).toBe(false);
  });

  it('tasks(세션 스코프)와 board_cards 별개 — B가 A 세션 작업 경로로도 카드 접근 불가', async () => {
    // GET /api/tasks/:id는 기존 세션 스코프 tasks만 다루며 board_cards와 무관함을 확인
    const t = await app.inject({ method: 'GET', url: `/api/tasks/${aCardId}`, headers: bearer(bToken) });
    expect(t.statusCode).toBe(404);
    const t2 = await app.inject({ method: 'GET', url: `/api/tasks/${aCardId}`, headers: bearer(aToken) });
    expect(t2.statusCode).toBe(404); // A에게도 tasks가 아님
  });
});

// ── 회원탈퇴 cascade (devstore 시뮬레이션) ────────────
describe('회원탈퇴 시 볼트/보드 cascade 파기', () => {
  it('DELETE /api/me → B의 노트/보드/카드 전부 제거, A 데이터 보존', async () => {
    const note = await app.inject({ method: 'POST', url: '/api/vault/notes', headers: bearer(bToken), payload: { title: 'B 노트' } });
    const bNoteId = note.json().data.id;
    const board = await app.inject({ method: 'POST', url: '/api/boards', headers: bearer(bToken), payload: { name: 'B 보드' } });
    const bBoardId = board.json().data.id;
    const card = await app.inject({ method: 'POST', url: `/api/boards/${bBoardId}/cards`, headers: bearer(bToken), payload: { title: 'B 카드' } });
    const bCardId = card.json().data.id;

    const del = await app.inject({ method: 'DELETE', url: '/api/me', headers: bearer(bToken) });
    expect(del.statusCode).toBe(200);

    const store = getStore();
    expect(store.tables.vault_notes.some(r => r.id === bNoteId)).toBe(false);
    expect(store.tables.boards.some(r => r.id === bBoardId)).toBe(false);
    expect(store.tables.board_cards.some(r => r.id === bCardId)).toBe(false);
    expect(store.tables.users.some(r => r.id === bId)).toBe(false);
    // A 데이터 보존 (멀티테넌시 파기 격리)
    expect(store.tables.vault_notes.some(r => r.user_id === aId)).toBe(true);
    expect(store.tables.boards.some(r => r.user_id === aId)).toBe(true);
  });
});
