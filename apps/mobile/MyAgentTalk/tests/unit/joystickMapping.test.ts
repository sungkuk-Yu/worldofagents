// 조이스틱 자유매핑 순수 로직 — 카드 t_ced38e19 요구 1/2/4/5 계약
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_IDS, DEFAULT_MAP, DIRECTION_KEYS, ONE_HAND_MAP,
  actionForGesture, encodeJoystickMap, flipHorizontal, normalizeJoystickMap, presetOf,
} from '../../src/lib/joystickMapping';

test('기본 프리셋: 예=왼쪽/아니오=오른쪽/취소=아래/키보드=위 (기존 동작 보존)', () => {
  assert.equal(DEFAULT_MAP.DIR_LEFT, 'yes');
  assert.equal(DEFAULT_MAP.DIR_RIGHT, 'no');
  assert.equal(DEFAULT_MAP.DIR_DOWN, 'cancel');
  assert.equal(DEFAULT_MAP.DIR_UP, 'keyboard');
});

test('한손 프리셋 = 기본 좌우미러 + yes/no 반전 (요구 2)', () => {
  assert.equal(ONE_HAND_MAP.DIR_RIGHT, 'yes');
  assert.equal(ONE_HAND_MAP.DIR_LEFT, 'no');
  assert.equal(ONE_HAND_MAP.DIR_DOWN, 'cancel'); // 수직은 불변
  assert.equal(ONE_HAND_MAP.DIR_UP, 'keyboard');
  assert.equal(ONE_HAND_MAP.DIR_UPLEFT, 'none');
  // 미러는 대각도 뒤집는다
  assert.equal(flipHorizontal(ONE_HAND_MAP).DIR_LEFT, DEFAULT_MAP.DIR_LEFT);
  assert.equal(flipHorizontal(ONE_HAND_MAP).DIR_RIGHT, DEFAULT_MAP.DIR_RIGHT);
});

test('flipHorizontal는 8방향 전bijection — 키 손실/중복 없음', () => {
  const single: Record<string, number> = {};
  for (const k of DIRECTION_KEYS) {
    const flipped = flipHorizontal(DEFAULT_MAP)[k];
    single[k] = 1;
    assert.ok((ACTION_IDS as readonly string[]).includes(flipped));
  }
  assert.equal(Object.keys(single).length, 8);
});

test('직렬화/역직렬화 왕복 — 어떤 맵이든 평판 JSON으로 무손실 (요구 1)', () => {
  for (const map of [DEFAULT_MAP, ONE_HAND_MAP]) {
    assert.deepEqual(normalizeJoystickMap(encodeJoystickMap(map)), map);
  }
});

test('normalize: 알 수 없는 키/값은 그 칸만 기본 폴백, 나머지 보존 (방어적 파싱)', () => {
  const raw = {
    DIR_LEFT: 'favorites',
    DIR_UP: 'not_an_action',
    DIR_ZZZ: 'yes',
    extra_junk: 1,
  };
  const map = normalizeJoystickMap(raw);
  assert.ok(map);
  assert.equal(map.DIR_LEFT, 'favorites'); // 유효 값 유지
  assert.equal(map.DIR_UP, DEFAULT_MAP.DIR_UP); // 무효 값 → 기본
  assert.equal(map.DIR_DOWN, DEFAULT_MAP.DIR_DOWN); // 누락 → 기본
});

test('normalize: 비객체/완전 손상은 null (호출자 프리셋 폴백 유도)', () => {
  assert.equal(normalizeJoystickMap(null), null);
  assert.equal(normalizeJoystickMap('nope'), null);
  assert.equal(normalizeJoystickMap([]), null);
  assert.equal(normalizeJoystickMap({}), null);
  assert.equal(normalizeJoystickMap({ DIR_LEFT: 'bogus' }), null);
});

test('actionForGesture: TAP/LONG은 항상 null — 중앙 녹음 고정 (요구 5)', () => {
  const custom = { ...DEFAULT_MAP };
  for (const k of DIRECTION_KEYS) custom[k] = 'send';
  assert.equal(actionForGesture(custom, 'TAP_CENTER'), null);
  assert.equal(actionForGesture(custom, 'LONG_CENTER'), null);
  assert.equal(actionForGesture(custom, 'DIR_LEFT'), 'send');
});

test('actionForGesture: none 슬롯은 null = 화면 기본 동작 없음 (요구 3)', () => {
  assert.equal(actionForGesture(DEFAULT_MAP, 'DIR_UPLEFT'), null);
  assert.equal(actionForGesture(DEFAULT_MAP, 'DIR_LEFT'), 'yes');
});

test('presetOf: 기본/한손 외 편집은 custom 판정 (요구 2 chips 상태)', () => {
  assert.equal(presetOf(DEFAULT_MAP), 'default');
  assert.equal(presetOf(ONE_HAND_MAP), 'onehand');
  assert.equal(presetOf({ ...DEFAULT_MAP, DIR_UPLEFT: 'favorites' }), 'custom');
});
