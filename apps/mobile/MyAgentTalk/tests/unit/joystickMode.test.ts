// 입력 모드 순수 로직 테스트 — src/lib/joystickMode.ts (카드 t_5de18a91 요구 2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOYSTICK_MODES, DEFAULT_MODE, MODE_LABEL_KEYS, normalizeJoystickMode, usesPad,
} from '../../src/lib/joystickMode';

test('3모드 존재 + 기본값은 hybrid (카드 본문 ③ 기본값 권장)', () => {
  assert.deepEqual([...JOYSTICK_MODES], ['joystick', 'pad', 'hybrid']);
  assert.equal(DEFAULT_MODE, 'hybrid');
});

test('normalize — 유효 값 통과, 오염/누락은 null (호출자 기본 폴백)', () => {
  for (const m of JOYSTICK_MODES) assert.equal(normalizeJoystickMode(m), m);
  for (const junk of [undefined, null, '', 'TRACKPAD', 42, { pad: true }, ['pad']]) {
    assert.equal(normalizeJoystickMode(junk), null, String(junk));
  }
});

test('usesPad — pad/hybrid만 매직패드 렌더 계열', () => {
  assert.equal(usesPad('joystick'), false);
  assert.equal(usesPad('pad'), true);
  assert.equal(usesPad('hybrid'), true);
});

test('MODE_LABEL_KEYS — 모든 모드에 라벨 키 (i18n 키 존재는 i18n 패리티 테스트가 보증)', () => {
  for (const m of JOYSTICK_MODES) {
    assert.ok(MODE_LABEL_KEYS[m].startsWith('joystick.modes.'), m);
  }
});
