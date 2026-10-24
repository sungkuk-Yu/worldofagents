import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChoices, toggleChoice, choiceSubmission, emptyChoiceState } from '../../src/lib/choiceParse';

test('parser preserves surrounding text and accepts both numbering delimiters and indentation', () => {
  assert.deepEqual(parseChoices('안내\r\n  1. 원문 하나\r\n2) 원문 둘\r\n끝'), [
    { kind: 'text', text: '안내' },
    { kind: 'choices', items: [{ id: 0, number: '1', text: '원문 하나' }, { id: 1, number: '2', text: '원문 둘' }] },
    { kind: 'text', text: '끝' },
  ]);
});
test('single, separated, malformed numbered lines and fenced code are not choices', () => {
  for (const content of ['1. 하나', '1. 하나\n\n2. 둘', '1.하나\n2.둘', '```text\n1. 하나\n2. 둘\n```', '~~~\n1. 하나\n2. 둘\n~~~']) {
    assert.equal(parseChoices(content).some((part) => part.kind === 'choices'), false);
  }
});
test('multiple blocks have distinct identities even when numbers restart', () => {
  const parts = parseChoices('1. a\n2. b\n중간\n1. c\n2. d');
  assert.deepEqual(parts.flatMap((part) => part.kind === 'choices' ? part.items.map((item) => item.id) : []), [0, 1, 2, 3]);
});
test('multiple selection submits in original order with original text and toggles off', () => {
  const parts = parseChoices('1. 원문1\n2. 원문2\n3. 원문3');
  let state = toggleChoice(emptyChoiceState, 2, true);
  state = toggleChoice(state, 0, true);
  assert.equal(choiceSubmission(parts, state, true), '1번, 3번 선택: 원문1; 원문3');
  state = toggleChoice(state, 2, true);
  assert.equal(choiceSubmission(parts, state, true), '1번 선택: 원문1');
  assert.deepEqual(emptyChoiceState.selected, []);
});
test('zero selections disable submission, including after deselection', () => {
  const parts = parseChoices('1. a\n2. b');
  assert.equal(choiceSubmission(parts, emptyChoiceState, true), null);
  const state = toggleChoice(toggleChoice(emptyChoiceState, 0, true), 0, true);
  assert.equal(choiceSubmission(parts, state, true), null);
});
test('historical and submitted choices cannot be edited or submitted again', () => {
  const parts = parseChoices('1. a\n2. b');
  const state = toggleChoice(emptyChoiceState, 0, true);
  assert.equal(toggleChoice(state, 1, false), state);
  assert.equal(choiceSubmission(parts, state, false), null);
  const locked = { ...state, locked: true };
  assert.equal(toggleChoice(locked, 1, true), locked);
  assert.equal(choiceSubmission(parts, locked, true), null);
});
