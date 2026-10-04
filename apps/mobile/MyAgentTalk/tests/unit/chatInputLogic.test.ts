// t_c690274e 회귀 단위: Enter 분기(Shift+Enter=개행 양보·Enter 단독=전송·IME 조합 중=미전송)
// + 높이 성장 클램프(1줄→최대 5줄, 초과 내부 스크롤, 소거 시 원복).
// 순수 로직만 — DOM/e2e 회귀는 tests/e2e/smoke_enter_t_c690274e.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldSendOnEnter,
  inputHeightFor,
  inputScrolls,
  INPUT_MIN_HEIGHT,
  INPUT_MAX_HEIGHT,
  INPUT_LINE_HEIGHT,
  INPUT_PAD_V,
} from '../../src/lib/chatInputLogic';

const ENTER = { key: 'Enter' };

test('Enter 단독(non-composing) → 전송 승격', () => {
  assert.equal(shouldSendOnEnter({ ...ENTER }), true);
  assert.equal(shouldSendOnEnter({ ...ENTER, isComposing: false, keyCode: 13 }), true);
});

test('Shift+Enter → 전송 승격 금지(개행 기본 동작에 양보) — 대표님 10/3 버그의 핵심 회귀', () => {
  assert.equal(shouldSendOnEnter({ ...ENTER, shiftKey: true }), false);
  assert.equal(shouldSendOnEnter({ ...ENTER, shiftKey: true, isComposing: false }), false);
});

test('IME 조합 중 Enter → 미전송 (isComposing / keyCode 229, w3.org/uievents)', () => {
  assert.equal(shouldSendOnEnter({ ...ENTER, isComposing: true }), false);
  assert.equal(shouldSendOnEnter({ ...ENTER, keyCode: 229 }), false);
  assert.equal(shouldSendOnEnter({ ...ENTER, shiftKey: true, isComposing: true }), false);
});

test('비(非) Enter 키는 무조건 false', () => {
  assert.equal(shouldSendOnEnter({ key: 'a' }), false);
  assert.equal(shouldSendOnEnter({ key: 'NumpadEnter', shiftKey: true }), false);
  assert.equal(shouldSendOnEnter({}), false);
});

test('높이: 1줄 자연높이(48)는 MIN 유지 — 축소 없음', () => {
  assert.equal(inputHeightFor(INPUT_MIN_HEIGHT), INPUT_MIN_HEIGHT);
  assert.equal(inputHeightFor(30), INPUT_MIN_HEIGHT);
});

test('높이: 3줄 본문 → 라인높이 3줄+패딩으로 성장(상한 미달 = 스크롤 없음)', () => {
  const three = 3 * INPUT_LINE_HEIGHT + INPUT_PAD_V;
  assert.ok(three < INPUT_MAX_HEIGHT, '3줄은 5줄 상한 이내');
  assert.equal(inputHeightFor(three), three);
  assert.equal(inputScrolls(three), false);
});

test('높이: 5줄 = 상한 경계(초과 아님, 내부 스크롤 없음)', () => {
  assert.equal(inputHeightFor(INPUT_MAX_HEIGHT), INPUT_MAX_HEIGHT);
  assert.equal(inputScrolls(INPUT_MAX_HEIGHT), false);
});

test('높이: 8줄 → MAX 클램프 + 내부 스크롤', () => {
  const eight = 8 * INPUT_LINE_HEIGHT + INPUT_PAD_V;
  assert.equal(inputHeightFor(eight), INPUT_MAX_HEIGHT);
  assert.equal(inputScrolls(eight), true);
});

test('높이: 발송 소거(0/NaN) → MIN 원복·스크롤 해제', () => {
  assert.equal(inputHeightFor(0), INPUT_MIN_HEIGHT);
  assert.equal(inputHeightFor(Number.NaN), INPUT_MIN_HEIGHT);
  assert.equal(inputScrolls(0), false);
  assert.equal(inputScrolls(Number.NaN), false);
});
