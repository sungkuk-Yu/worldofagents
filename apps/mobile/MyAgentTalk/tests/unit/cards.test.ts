import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { registerCard, getCard } from '../../src/cards/registry';
import { normalizeServerMessages } from '../../src/lib/chatLogic';
import { forkTitle, mergeThread, parseThread, toggleTaskOverride, parseForkOrigin, parseForkSession, canForkAgent } from '../../src/lib/cardLogic';
import { safeFileUrl } from '../../src/cards/payload';

test('레지스트리 등록과 교체, 미등록 및 악의적 키도 text 폴백', () => {
  const Text = () => null; const Custom = () => null;
  registerCard('text', Text);
  registerCard('custom', Custom);
  assert.equal(getCard('custom'), Custom);
  for (const type of [undefined, null, '', 'unknown', '__proto__']) assert.equal(getCard(type), Text);
  registerCard('custom', Text);
  assert.equal(getCard('custom'), Text);
});
test('정규화는 JSONB와 스레드 필드를 보존하고 결측값을 방어한다', () => {
  const payload = { columns: ['a'], rows: [[1]] };
  const result = normalizeServerMessages([{ id: 'a', role: 'agent', turn_index: 1, content: '', dialogue_type: 'spreadsheet',
    structured_payload: payload, parent_message_id: 'root', thread_reply_count: 3 }])[0];
  assert.equal(result.dialogueType, 'spreadsheet');
  assert.deepEqual(result.payload, payload);
  assert.equal(result.parentMessageId, 'root');
  assert.equal(result.threadReplyCount, 3);
  for (const value of [null, undefined, {}, 'bad']) assert.deepEqual(normalizeServerMessages(value), []);
  const invalid = normalizeServerMessages([null, [], {}, { id: 'b', content: 'valid', dialogue_type: {}, structured_payload: [],
    parent_message_id: 9, thread_reply_count: -1, turn_index: Infinity }])[0];
  assert.equal(invalid.dialogueType, null);
  assert.equal(invalid.payload, undefined);
  assert.equal(invalid.parentMessageId, undefined);
  assert.equal(invalid.threadReplyCount, undefined);
  assert.equal(invalid.turnIndex, 0);
});
test('스레드 병합은 해당 부모만 수용하고 중복과 원본을 제외한다', () => {
  const rows = normalizeServerMessages(['one', 'two', 'other', 'root'].map((id, i) => ({
    id, content: id, turn_index: i, parent_message_id: id === 'other' ? 'elsewhere' : 'root',
  })));
  assert.deepEqual(mergeThread([rows[0]], rows, 'root').map((m) => m.id), ['one', 'two']);
});
test('스레드 응답은 래퍼 유무와 부모 필드 결측을 지원하고 손상 시 오류', () => {
  const body = { root: { id: 'root', content: 'root' }, replies: [{ id: 'reply', content: 'reply' }] };
  assert.equal(parseThread(body, 'root').replies[0].parentMessageId, 'root');
  assert.equal(parseThread({ ok: true, data: body }, 'root').root.id, 'root');
  for (const value of [{}, null, { ...body, replies: {} }, { ...body, root: null }]) assert.throws(() => parseThread(value, 'root'), /errors.thread/);
});
test('체크리스트 수동 완료는 불변 업데이트이며 다시 토글할 수 있다', () => {
  const message = { id: 'task', role: 'agent' as const, content: '', turnIndex: 0 };
  const checked = toggleTaskOverride(message, 0, false);
  assert.deepEqual(checked.taskOverrides, { 0: true });
  assert.deepEqual(toggleTaskOverride(checked, 0, true).taskOverrides, { 0: false });
  assert.equal('taskOverrides' in message, false);
});
test('포크 제목 템플릿은 양 언어 번역 키와 입력 제목을 사용한다', () => {
  const i18n = createInstance();
  const ko = JSON.parse(readFileSync('src/i18n/locales/ko.json', 'utf8'));
  const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  void i18n.init({ lng: 'ko', initAsync: false, resources: { ko: { translation: ko }, en: { translation: en } } });
  assert.equal(forkTitle(i18n.t, 'A'), 'A 새프로젝트');
  void i18n.changeLanguage('en');
  assert.equal(forkTitle(i18n.t, 'A'), 'New project from A');
});
test('갈라내기 게이트 — 김비서(비서실장) room만 fork 노출 (t_55f9ed57)', () => {
  assert.equal(canForkAgent({ name: '김비서' }), true);
  assert.equal(canForkAgent({ titleKey: 'agent.chief.title' }), true);
  assert.equal(canForkAgent({ category: 'chief_of_staff' }), true);
  assert.equal(canForkAgent({ role: 'chief_of_staff' }), true);
  for (const other of [{ name: '내 변호사' }, { name: 'Legal Guide', category: 'legal' }, { name: '나의 그림자 비서' }, {}]) {
    assert.equal(canForkAgent(other), false, JSON.stringify(other));
  }
});
test('라벨 확정 — 답글/갈라내기 외 구(舊) 표기가 사전에 잔존하지 않는다 (t_55f9ed57 → t_7f86eefb 갱신)', () => {
  const flat = (obj: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) => typeof v === 'string' ? [`${prefix}${k}=${v}`] : flat(v as Record<string, unknown>, `${prefix}${k}.`));
  const ko = flat(JSON.parse(readFileSync('src/i18n/locales/ko.json', 'utf8')));
  const joined = ko.join('\n');
  for (const stale of ['스레드', '분기', '여기서 새 프로젝트', '이 글에서', '갈라내기', '갈라냄', '쓰레드 생성']) {
    assert.ok(!joined.includes(stale), `ko.json에 잔존 구 표기: ${stale}`);
  }
  assert.match(joined, /cards\.threadFrom=쓰레드/);
  assert.match(joined, /fork\.action=새프로젝트/);
  assert.match(joined, /joystick\.actions\.open_thread=쓰레드 열기/);
  // 대표님 10/4 규약: 버튼/키 라벨은 '쓰레드'·'새프로젝트', 답글 '개수' 문구(목록·배지)는 '답글' 유지.
  assert.match(joined, /cards\.replies=답글 \{\{countText\}}개/);
  assert.match(joined, /queue\.replyCount=답글 \{\{countText\}}개/);
  assert.match(joined, /queue\.threadsTitle=답글 목록/);
});
test('포크 응답은 새 세션 ID를 요구하며 계보는 선택적으로 방어한다', () => {
  assert.throws(() => parseForkSession({ id: 'old' }, 'old'), /errors.fork/);
  for (const value of [null, {}, { id: 1 }]) assert.throws(() => parseForkSession(value, 'old'));
  assert.equal(parseForkSession({ id: 'new', title: 'New' }, 'old').id, 'new');
  // t_8917ca0d 회귀: 백엔드 실 계약 data={session,copied} 래퍼 언래핑 — bare form과 동일 결과.
  // (루트cause: 9/26 백엔드 ebb43791이 래퍼로 바뀌었으나 프론트는 bare만 기대 → 매번 errors.fork)
  const wrapped = { session: { id: 'new', title: 'New', forked_from: { session_id: 'old', message_id: 'm', turn_index: 3 } },
    copied: { messages: 6, memories: 2, transcripts: 2, context_patches: 0 } };
  assert.deepEqual(parseForkSession(wrapped, 'old'), { id: 'new', title: 'New', forked_from: { session_id: 'old', message_id: 'm', title: undefined } });
  assert.throws(() => parseForkSession({ session: { id: 'old' }, copied: {} }, 'old'), /errors.fork/);
  assert.throws(() => parseForkSession({ session: 'not-a-record' }, 'old'), /errors.fork/);
  assert.equal(parseForkOrigin({ session_id: {} }), undefined);
  assert.deepEqual(parseForkOrigin({ session_id: 'old', session_title: 'Original' }), { session_id: 'old', title: 'Original', message_id: undefined });
});
test('라벨 확정 (t_7f86eefb, t_8917ca0d 승계) — 답글→쓰레드·갈라내기→새프로젝트 (queue/카드 통일)', () => {
  const flat = (obj: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) => typeof v === 'string' ? [`${prefix}${k}=${v}`] : flat(v as Record<string, unknown>, `${prefix}${k}.`));
  const ko = flat(JSON.parse(readFileSync('src/i18n/locales/ko.json', 'utf8'))).join('\n');
  const en = flat(JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'))).join('\n');
  assert.match(ko, /queue\.forkAction=새프로젝트/);
  assert.match(en, /queue\.forkAction=New project/);
  assert.match(ko, /queue\.replyAction=쓰레드/);
  assert.match(en, /queue\.replyAction=Thread/);
  assert.match(ko, /fork\.action=새프로젝트/);
  assert.match(en, /fork\.action=New project/);
});
test('파일 링크는 웹 프로토콜만 허용한다', () => {
  for (const value of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@example.test', {}, null]) assert.equal(safeFileUrl(value), undefined);
  assert.equal(safeFileUrl('https://example.test/file'), 'https://example.test/file');
});
