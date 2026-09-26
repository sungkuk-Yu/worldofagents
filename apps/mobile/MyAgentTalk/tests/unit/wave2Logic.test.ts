// Wave 2 순수 로직 단위 테스트 — vaultLogic([[wikilink]]/백링크) + kanbanLogic(position 이동) (t_174b66d2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRenderableMarkdown, extractWikilinks, parseNoteLink, computeBacklinks, findNoteByTitle, flattenFolderTree, defaultFolderForNewNote } from '../../src/lib/vaultLogic';
import { BOARD_COLUMNS, groupCardsByColumn, positionBetween, dropPosition, moveCard, isFromMessageCard, type BoardCardDto } from '../../src/lib/kanbanLogic';

// ── vaultLogic ─────────────────────────────────────────
test('vault — [[wikilink]] → mat-note: 링크 치환 (별칭/공백/인코딩)', () => {
  const out = toRenderableMarkdown('a [[ 노트 가 ]] b [[target|별칭]] c');
  assert.ok(out.includes('[노트 가](mat-note:%EB%85%B8%ED%8A%B8%20%EA%B0%80)'), '제목 trim 후 공백까지 인코딩');
  assert.ok(out.includes('[별칭](mat-note:target'), 'alias=표시, href=타깃');
  assert.equal(parseNoteLink('mat-note:target')?.title, 'target');
  assert.equal(parseNoteLink('https://x.test'), null);
});
test('vault — 코드블록 내 [[..]] 제외, 미완 [[은 원문 유지', () => {
  assert.deepEqual(extractWikilinks('```js\n[[code]]\n```\n[[note]]'), ['note']);
  assert.deepEqual(extractWikilinks('여기는 미완 [['), []);
  assert.equal(toRenderableMarkdown('미완 [['), '미완 [[');
});
test('vault — 백링크 계산: 참조 노트만, 자기 자신 제외, 대소문자/공백 정규화', () => {
  const target = { id: 't1', title: 'Project X', content: '본문' };
  const refs = [
    { id: 'a', title: 'A', content: 'see [[project x ]]' },
    { id: 'b', title: 'B', content: '[[Project X|X]]와 [[Other]]' },
    { id: 't1', title: 'Project X', content: 'self 참조 없음' },
    { id: 'c', title: 'C', content: 'no link' },
  ];
  assert.deepEqual(computeBacklinks(target, refs), [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  assert.equal(findNoteByTitle(refs, ' project x')?.id, 't1'); // trim+소문자 매칭
  assert.equal(findNoteByTitle([target, ...refs], 'PROJECT X')?.id, 't1');
});
test('vault — 폴더 트리 평면화(depth) + 새 노트 폴더 제안', () => {
  const tree = { name: '/', path: '/', note_count: 1, children: [
    { name: '대화', path: '/대화', note_count: 2, children: [
      { name: '법률', path: '/대화/법률', note_count: 1, children: [] },
    ] },
  ] };
  const flat = flattenFolderTree(tree);
  assert.deepEqual(flat.map((f) => [f.path, f.depth]), [['/', 0], ['/대화', 1], ['/대화/법률', 2]]);
  assert.equal(defaultFolderForNewNote('/대화'), '/대화');
  assert.equal(defaultFolderForNewNote('/'), '/노트');
  assert.equal(defaultFolderForNewNote(null), '/노트');
});

// ── kanbanLogic ────────────────────────────────────────
const card = (id: string, status: string, position: number): BoardCardDto => ({
  id, board_id: 'b1', title: id, body: '', status, priority: 0, position, assignee: null, labels: [],
});
test('kanban — 컬럼 분류 + position 정렬, 미지 status는 todo 폴백', () => {
  const map = groupCardsByColumn([card('c3', 'done', 5), card('c1', 'todo', 2000), card('c2', 'todo', 1000), card('c4', 'archived', 1)]);
  assert.deepEqual(map.todo.map((c) => c.id), ['c4', 'c2', 'c1']); // archived→todo 폴백, position 오름차순(1<1000<2000)
  assert.equal(map.done.length, 1);
  assert.deepEqual(BOARD_COLUMNS, ['todo', 'doing', 'review', 'done']);
});
test('kanban — positionBetween: 끝/앞/중간/밀착', () => {
  assert.equal(positionBetween(null, null), 1000);
  assert.equal(positionBetween(1000, null), 2000);
  assert.equal(positionBetween(null, 1000), 0);
  assert.equal(positionBetween(1000, 2000), 1500);
  assert.equal(positionBetween(1, 2), 1.5); // 정수 밀착 → float 강제 삽입
});
test('kanban — dropPosition 인덱스 경계(맨 앞/삽입/맨 뒤)', () => {
  const col = [card('a', 'todo', 1000), card('b', 'todo', 2000)];
  assert.equal(dropPosition(col, 0), 0);
  assert.equal(dropPosition(col, 1), 1500);
  assert.equal(dropPosition(col, 9), 3000);
});
test('kanban — moveCard: 컬럼 간 이동/같은 컬럼 재정렬/patch 형식', () => {
  const cards = [card('x', 'todo', 1000), card('y', 'doing', 1000)];
  const m1 = moveCard(cards, 'x', 'doing', 0);
  assert.equal(m1?.patch.status, 'doing');
  assert.equal(m1?.patch.position, 0); // y(1000) 앞
  const m2 = moveCard(cards, 'x', 'todo', 0); // 없음 → null
  assert.equal(moveCard(cards, 'zz', 'todo', 0), null);
  assert.ok(m2);
});
test('kanban — from-message 라벨 판정(대화→카드 배지)', () => {
  assert.ok(isFromMessageCard({ ...card('x', 'todo', 1), labels: ['from-message', 'text'] }));
  assert.equal(isFromMessageCard({ ...card('y', 'todo', 1), labels: [] }), false);
});
