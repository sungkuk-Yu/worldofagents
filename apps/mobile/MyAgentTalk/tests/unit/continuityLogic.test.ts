// 반응형 2트랙 + 연속성 순수 로직 단위 테스트 (t_eded715c 요구 1·검증)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutModeForWidth, isPcLayout, shouldShowResumeHome, bodyMaxWidth, PC_BREAKPOINT, WIDE_BREAKPOINT } from '../../src/lib/layout';
import { normalizePttKey, normalizePttMode, pttKeyLabel, capturePttKey, isEditableFocus, PTT_DEFAULT_KEY } from '../../src/lib/pttLogic';
import { normalizeResumeItems, readCursorFor, shouldSendCursor, foreignDevicesOf } from '../../src/lib/resumeLogic';
import { detectDeviceLabel, peersOf, deviceLabelKey } from '../../src/lib/deviceLabel';

// ── 레이아웃 브레이크포인트 (검증 ①: 단위) ──
test('layoutModeForWidth: 390 모바일 / 768 PC 경계 포함 / 1100 3패널 / 그 이상 wide', () => {
  assert.equal(layoutModeForWidth(390), 'mobile');
  assert.equal(layoutModeForWidth(767), 'mobile');
  assert.equal(layoutModeForWidth(PC_BREAKPOINT), 'pc');
  assert.equal(layoutModeForWidth(900), 'pc');
  assert.equal(layoutModeForWidth(WIDE_BREAKPOINT - 1), 'pc');
  assert.equal(layoutModeForWidth(WIDE_BREAKPOINT), 'pc-wide');
  assert.equal(layoutModeForWidth(1440), 'pc-wide');
});

test('layoutModeForWidth: 오염 입력(NaN/Infinity/음수)은 모바일 폴백', () => {
  for (const w of [NaN, Infinity, -Infinity, -100]) assert.equal(layoutModeForWidth(w), 'mobile');
});

test('isPcLayout/shouldShowResumeHome: PC+대화목록에서만 홈 대체', () => {
  assert.equal(isPcLayout('mobile'), false);
  assert.equal(isPcLayout('pc'), true);
  assert.equal(isPcLayout('pc-wide'), true);
  assert.equal(shouldShowResumeHome('pc-wide', 'DialogueList'), true);
  assert.equal(shouldShowResumeHome('pc', 'Chat'), false);
  assert.equal(shouldShowResumeHome('mobile', 'DialogueList'), false);
  assert.equal(shouldShowResumeHome('pc', null), false);
});

test('bodyMaxWidth: 1440 이상만 읽기 폭 상한', () => {
  assert.equal(bodyMaxWidth(1439), undefined);
  assert.equal(bodyMaxWidth(1440), 900);
});

// ── PTT 키 규칙 (확정 ②③) ──
test('normalizePttKey: 금지 키/공백은 기본 V 폴백, 문자 코드 통과', () => {
  assert.equal(normalizePttKey('Escape'), PTT_DEFAULT_KEY);
  assert.equal(normalizePttKey('Space'), PTT_DEFAULT_KEY);
  assert.equal(normalizePttKey('MetaLeft'), PTT_DEFAULT_KEY);
  assert.equal(normalizePttKey('F5'), PTT_DEFAULT_KEY);
  assert.equal(normalizePttKey(''), PTT_DEFAULT_KEY);
  assert.equal(normalizePttKey(null), PTT_DEFAULT_KEY);
  assert.equal(normalizePttKey('x'.repeat(30)), PTT_DEFAULT_KEY);
  assert.equal(normalizePttKey('KeyB'), 'KeyB');
  assert.equal(normalizePttKey('  KeyB  '), 'KeyB');
  assert.equal(normalizePttKey('Semicolon'), 'Semicolon');
});

test('normalizePttMode: toggle만 toggle, 나머지는 hold', () => {
  assert.equal(normalizePttMode('toggle'), 'toggle');
  assert.equal(normalizePttMode('hold'), 'hold');
  assert.equal(normalizePttMode('bogus'), 'hold');
  assert.equal(normalizePttMode(undefined), 'hold');
});

test('pttKeyLabel: 물리 code → 사람 라벨', () => {
  assert.equal(pttKeyLabel('KeyV'), 'V');
  assert.equal(pttKeyLabel('Digit3'), '3');
  assert.equal(pttKeyLabel('Numpad7'), '7');
  assert.equal(pttKeyLabel('BracketLeft'), '[');
  assert.equal(pttKeyLabel('ArrowUp'), '↑');
});

test('capturePttKey: 수정자 조합·수정자 단독·금지는 반려, 일반 키는 code', () => {
  assert.equal(capturePttKey({ code: 'KeyV', key: 'v', ctrlKey: false, metaKey: false }), 'KeyV');
  assert.equal(capturePttKey({ code: 'KeyW', key: 'w', ctrlKey: true, metaKey: false }), null);
  assert.equal(capturePttKey({ code: 'KeyW', key: 'w', ctrlKey: false, metaKey: true }), null);
  assert.equal(capturePttKey({ code: 'ShiftLeft', key: 'Shift', ctrlKey: false, metaKey: false }), null);
  assert.equal(capturePttKey({ code: 'Enter', key: 'Enter', ctrlKey: false, metaKey: false }), null);
});

test('isEditableFocus: 입력 태그/콘텐츠Editable/textbox 롤만 참 (확정 ③)', () => {
  assert.equal(isEditableFocus({ tagName: 'INPUT' }), true);
  assert.equal(isEditableFocus({ tagName: 'textarea' }), true);
  assert.equal(isEditableFocus({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableFocus({ tagName: 'DIV', role: 'textbox' }), true);
  assert.equal(isEditableFocus({ tagName: 'DIV', role: 'combobox' }), true);
  assert.equal(isEditableFocus({ tagName: 'DIV' }), false);
  assert.equal(isEditableFocus({ tagName: 'BUTTON', role: 'button' }), false);
  assert.equal(isEditableFocus(null), false);
});

// ── resume/read-state 정규화 (t_d75ca81c 계약) ──
test('normalizeResumeItems: 오염 응답 방어 + recommended 플래그 + unread/liveDevices', () => {
  const env = { ok: true, data: { items: [
    { session_id: 'a', unread_count: 3, live_devices: ['pc-web', 'pc-web', 'bad', null] },
    { session_id: 'b', unread_count: 'x', live_devices: 'nope' },
    { nope: 1 },
  ], recommended_session_id: 'b', total: 3 } };
  const r = normalizeResumeItems(env);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].unread, 3);
  assert.deepEqual(r.items[0].liveDevices, ['pc-web', 'pc-web', 'bad']); // strList는 타입 필터만 (dedup 없음 — 화면에서 Set 처리)
  assert.equal(r.items[1].unread, 0);
  assert.deepEqual(r.items[1].liveDevices, []);
  assert.equal(r.items[0].recommended, false);
  assert.equal(r.items[1].recommended, true);
  assert.equal(r.recommended, 'b');
});

test('normalizeResumeItems: 빈/오염 응답도 안전한 빈 목록', () => {
  for (const bad of [null, undefined, {}, { data: null }, { data: { items: 'x' } }]) {
    const r = normalizeResumeItems(bad);
    assert.deepEqual(r.items, []);
    assert.equal(r.recommended, null);
  }
});

test('readCursorFor: pending/failed 제외 max turn, 없음 null', () => {
  assert.equal(readCursorFor([
    { turnIndex: 2 }, { turnIndex: 7, pending: true }, { turnIndex: 5, status: 'failed' }, { turnIndex: 4 },
  ]), 4);
  assert.equal(readCursorFor([{ turnIndex: 0 }]), 0);
  assert.equal(readCursorFor([]), null);
  assert.equal(readCursorFor([{ turnIndex: NaN }, { turnIndex: 1 }, { turnIndex: -3 }]), 1);
});

test('shouldSendCursor: 첫 전송/증가만, 감소·동일·null은 스킵 (멱등 dedup)', () => {
  assert.equal(shouldSendCursor(null, 3), true);
  assert.equal(shouldSendCursor(null, null), false);
  assert.equal(shouldSendCursor(3, 3), false);
  assert.equal(shouldSendCursor(3, 5), true);
  assert.equal(shouldSendCursor(5, 2), false); // 되감기 시도 금지(서버도 max 병합이지만 요청도 낭비)
});

test('foreignDevicesOf: own 라벨 제외+dedup, own 없으면 전체', () => {
  assert.deepEqual(foreignDevicesOf(['pc-web', 'mobile-web', 'pc-web'], 'pc-web'), ['mobile-web']);
  assert.deepEqual(foreignDevicesOf(['unknown'], null), ['unknown']);
});

// ── 디바이스 라벨 감지 ──
test('detectDeviceLabel: node(Width 390)+navigator 없음 → mobile-web', () => {
  assert.equal(detectDeviceLabel(390), 'mobile-web');
  assert.equal(detectDeviceLabel(1440), 'pc-web');
});

test('peersOf/deviceLabelKey: 본인 제외, i18n 키 매핑', () => {
  assert.deepEqual(peersOf([{ device: 'pc-web' }, { device: 'mobile-web' }], 'mobile-web'), ['pc-web']);
  assert.deepEqual(peersOf([{ device: 'pc-web' }], 'pc-web'), []);
  assert.equal(deviceLabelKey('ios'), 'device.ios');
});
