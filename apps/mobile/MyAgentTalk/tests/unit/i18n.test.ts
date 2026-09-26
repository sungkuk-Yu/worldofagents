import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveLanguage } from '../../src/i18n/language';
import { formatDayLabel, formatNumber, formatRelative } from '../../src/i18n/format';
import { buildTimeGroups, quipKeyForStage, validateMessageInput, reduceStreams, createTypingTracker, createTurnCoordinator } from '../../src/lib/chatLogic';
import { errorKey, LocalizedError } from '../../src/lib/errorKeys';

test('언어 결정 — 한국어, 영어, 미지원 언어, 시스템 언어 없음', () => {
  for (const code of ['ko', 'ko-KR', 'KO']) assert.equal(resolveLanguage(code), 'ko');
  for (const code of ['en', 'en-GB', 'fr', 'ja', 'zh-Hans']) assert.equal(resolveLanguage(code), 'en');
  assert.equal(resolveLanguage(null), 'ko');
  assert.equal(resolveLanguage(undefined), 'ko');
});
test('시간 그룹 — 로케일 전환에도 그룹 경계는 유지된다', () => {
  const now = new Date(2026, 8, 27, 12);
  const messages = [new Date(2026, 8, 26, 21, 41), new Date(2026, 8, 26, 21, 42), new Date(2026, 8, 27, 9, 41)].map((date, i) => ({ id: String(i), content: '', role: 'user' as const, turnIndex: i, createdAt: date.toISOString() }));
  assert.deepEqual(buildTimeGroups(messages, 'ko', now).map((g) => g.label), ['09월 26일 21:41', null, '09:41']);
  assert.deepEqual(buildTimeGroups(messages, 'en', now).map((g) => g.label), ['Sep 26, 9:41 PM', null, '9:41 AM']);
  assert.equal(formatDayLabel(now, 'en', now), '12:00 PM');
  assert.equal(formatNumber(4000, 'en'), '4,000');
  assert.equal(formatRelative(new Date(2026, 8, 26, 12), 'en', now), 'yesterday');
  assert.equal(formatRelative(new Date(2026, 8, 26, 12), 'ko', now), '어제');
});
test('quip — 등록 stage만 사용하고 서버 문구는 무시한다', () => {
  for (const stage of ['thinking', 'organizing', 'finalizing', 'rendering']) assert.equal(quipKeyForStage(stage), `quip.${stage}`);
  for (const stage of [undefined, '', 'unknown', 'constructor']) assert.equal(quipKeyForStage(stage), 'quip.default');
  let key: string | null = null;
  const runs = createTurnCoordinator(createTypingTracker((_active, quip) => { key = quip; }));
  for (const stage of ['thinking', 'unknown', undefined]) {
    runs.observe({ type: 'run.progress', run_id: 'r', stage, quip: '서버 한국어' }, 's');
    assert.equal(key, quipKeyForStage(stage));
  }
  let streams = reduceStreams([], { type: 'answer.delta', run_id: 'r', delta: 'content' }, []);
  streams = reduceStreams(streams, { type: 'run.progress', run_id: 'r', stage: 'rendering', quip: '서버 문구' }, []);
  assert.equal(streams[0].quip, 'quip.rendering');
  streams = reduceStreams(streams, { type: 'run.progress', run_id: 'r', quip: '서버 문구' }, []);
  assert.equal(streams[0].quip, 'quip.default');
});
test('입력 오류 — 키와 파라미터를 반환한다', () => {
  assert.deepEqual(validateMessageInput(' \n '), { ok: false, errorKey: 'errors.empty' });
  assert.deepEqual(validateMessageInput('x'.repeat(4001)), { ok: false, errorKey: 'errors.tooLong', errorParams: { limit: 4000 } });
});
test('리소스 — 양 언어의 키와 보간 변수가 일치한다', () => {
  const flatten = (data: Record<string, unknown>, prefix = ''): [string, string][] =>
    Object.entries(data).flatMap(([key, value]) =>
      typeof value === 'string' ? [[`${prefix}${key}`, value] as [string, string]]
        : flatten(value as Record<string, unknown>, `${prefix}${key}.`));
  const ko = Object.fromEntries(flatten(JSON.parse(readFileSync('src/i18n/locales/ko.json', 'utf8'))));
  const en = Object.fromEntries(flatten(JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'))));
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
  for (const key of Object.keys(ko)) {
    assert.ok(en[key].trim(), key);
    assert.deepEqual(ko[key].match(/{{\w+}}/g)?.sort(), en[key].match(/{{\w+}}/g)?.sort(), key);
  }
});
test('오류 정규화 — 서버 문구와 내부 오류를 사용자에게 전달하지 않는다', () => {
  assert.equal(errorKey(new Error('서버 오류')), 'errors.request');
  assert.equal(errorKey(new LocalizedError('errors.auth')), 'errors.auth');
  assert.equal(errorKey(new Error('errors.session')), 'errors.session');
});
