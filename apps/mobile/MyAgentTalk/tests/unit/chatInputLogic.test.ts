// t_c690274e 회귀 단위: Enter 분기(Shift+Enter=개행 양보·Enter 단독=전송·IME 조합 중=미전송)
// + t_2f296081 추가: composerAction 4분해(send/newline/voice/pass — V 키 승격·편집 단축키 불간섭)
// + 높이 성장 클램프(1줄→최대 4줄, 초과 내부 스크롤, 소거 시 원복).
// 순수 로직만 — DOM/e2e 회귀는 tests/e2e/smoke_enter_t_c690274e.cjs + smoke_composer_t2f296081.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldSendOnEnter,
  composerAction,
  inputHeightFor,
  inputScrolls,
  INPUT_MIN_HEIGHT,
  INPUT_MAX_HEIGHT,
  INPUT_MAX_LINES,
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
  assert.ok(three < INPUT_MAX_HEIGHT, '3줄은 4줄 상한 이내');
  assert.equal(inputHeightFor(three), three);
  assert.equal(inputScrolls(three), false);
});

test('높이: 4줄 = 상한 경계(초과 아님, 내부 스크롤 없음) — t_2f296081 10/4 통합 메모 4줄 상한', () => {
  assert.equal(INPUT_MAX_LINES, 4);
  assert.equal(inputHeightFor(INPUT_MAX_HEIGHT), INPUT_MAX_HEIGHT);
  assert.equal(inputScrolls(INPUT_MAX_HEIGHT), false);
});

test('높이: 5줄 → MAX 클램프 + 내부 스크롤 (구 5줄 시대 상한이던 값도 이제 스크롤)', () => {
  const five = 5 * INPUT_LINE_HEIGHT + INPUT_PAD_V;
  assert.ok(five > INPUT_MAX_HEIGHT);
  assert.equal(inputHeightFor(five), INPUT_MAX_HEIGHT);
  assert.equal(inputScrolls(five), true);
});

test('높이: 발송 소거(0/NaN) → MIN 원복·스크롤 해제', () => {
  assert.equal(inputHeightFor(0), INPUT_MIN_HEIGHT);
  assert.equal(inputHeightFor(Number.NaN), INPUT_MIN_HEIGHT);
  assert.equal(inputScrolls(0), false);
  assert.equal(inputScrolls(Number.NaN), false);
});

// ── t_2f296081 ③/②: composerAction 4분해 (send/newline/voice/pass) ──────────────
const V = { voiceEnabled: true, pttKey: 'KeyV' } as const;
const OFF = { voiceEnabled: false, pttKey: 'KeyV' } as const;

test('composerAction — Enter 단독=send, Shift+Enter=newline (10/4 통합 메모 ②)', () => {
  assert.equal(composerAction({ key: 'Enter' }, V), 'send');
  assert.equal(composerAction({ key: 'Enter', shiftKey: true }, V), 'newline');
  // DOM 규범: 패드 Enter도 key='Enter'(code='NumpadEnter') — 동일 승격 확인
  assert.equal(composerAction({ key: 'Enter', code: 'NumpadEnter' }, V), 'send');
});

test('composerAction — pttKey 단독 타격=voice, 수정자/자동반복/조합 중=pass (10/4 ①·③)', () => {
  assert.equal(composerAction({ key: 'v', code: 'KeyV' }, V), 'voice');
  assert.equal(composerAction({ key: 'V', code: 'KeyV', shiftKey: true }, V), 'voice'); // 전역 홀드와 동일(Shift 무관 물리 키)
  assert.equal(composerAction({ key: 'x', code: 'KeyX' }, V), 'pass'); // 다른 키 = 타이핑
  assert.equal(composerAction({ key: 'v', code: 'KeyV', ctrlKey: true }, V), 'pass'); // Ctrl+V 붙여넣기 영역 불간섭
  assert.equal(composerAction({ key: 'v', code: 'KeyV', metaKey: true }, V), 'pass');
  assert.equal(composerAction({ key: 'v', code: 'KeyV', altKey: true }, V), 'pass');
  assert.equal(composerAction({ key: 'v', code: 'KeyV', repeat: true }, V), 'pass'); // 홀드 자동반복 재호출 금지
  assert.equal(composerAction({ key: 'v', code: 'KeyV', isComposing: true }, V), 'pass'); // 한글 2돌림 ㅌ
});

test('composerAction — voiceEnabled=false(데모/미장착/PC)면 pttKey도 pass(타이핑 보존)', () => {
  assert.equal(composerAction({ key: 'v', code: 'KeyV' }, OFF), 'pass');
});

test('composerAction — 재매핑 키(KeyK) 단일 소스: pttKey 인자만큼 승격', () => {
  const K = { voiceEnabled: true, pttKey: 'KeyK' } as const;
  assert.equal(composerAction({ key: 'k', code: 'KeyK' }, K), 'voice');
  assert.equal(composerAction({ key: 'v', code: 'KeyV' }, K), 'pass'); //舊 기본키 V는 평범한 타이핑
});

test('composerAction — 편집 단축키/일반 문자 전부 pass (t_2f296081 ② 기본기 불간섭)', () => {
  assert.equal(composerAction({ key: 'x', code: 'KeyX', ctrlKey: true }, V), 'pass');   // Ctrl+X
  assert.equal(composerAction({ key: 'z', code: 'KeyZ', ctrlKey: true }, V), 'pass');   // Ctrl+Z
  assert.equal(composerAction({ key: 'z', code: 'KeyZ', metaKey: true }, V), 'pass');   // Cmd+Z
  assert.equal(composerAction({ key: 'a', code: 'KeyA', ctrlKey: true }, V), 'pass');   // Ctrl+A
  assert.equal(composerAction({ key: 'Backspace' }, V), 'pass');
  assert.equal(composerAction({ key: ' ', code: 'Space' }, V), 'pass');
  assert.equal(composerAction({}, V), 'pass');
});

test('composerAction — Enter 분기 우선: pttKey가 Enter로 재매핑돼도 send/newline (voice 도달 불가)', () => {
  // code 분기보다 key(Enter) 분기가 선행 — voice 승격과 Enter는 구조적으로 배타.
  assert.equal(composerAction({ key: 'Enter', code: 'Enter' }, { voiceEnabled: true, pttKey: 'Enter' }), 'send');
});
