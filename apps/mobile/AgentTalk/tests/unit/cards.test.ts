import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { registerCard, getCard } from '../../src/cards/registry';
import { normalizeServerMessages } from '../../src/lib/chatLogic';
import { forkTitle, mergeThread, parseThread, toggleTaskOverride, parseForkOrigin, parseForkSession } from '../../src/lib/cardLogic';
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
  assert.equal(forkTitle(i18n.t, 'A'), 'A에서 분기');
  void i18n.changeLanguage('en');
  assert.equal(forkTitle(i18n.t, 'A'), 'Fork of A');
});
test('포크 응답은 새 세션 ID를 요구하며 계보는 선택적으로 방어한다', () => {
  assert.throws(() => parseForkSession({ id: 'old' }, 'old'), /errors.fork/);
  for (const value of [null, {}, { id: 1 }]) assert.throws(() => parseForkSession(value, 'old'));
  assert.equal(parseForkSession({ id: 'new', title: 'New' }, 'old').id, 'new');
  assert.equal(parseForkOrigin({ session_id: {} }), undefined);
  assert.deepEqual(parseForkOrigin({ session_id: 'old', session_title: 'Original' }), { session_id: 'old', title: 'Original', message_id: undefined });
});
test('파일 링크는 웹 프로토콜만 허용한다', () => {
  for (const value of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@example.test', {}, null]) assert.equal(safeFileUrl(value), undefined);
  assert.equal(safeFileUrl('https://example.test/file'), 'https://example.test/file');
});
