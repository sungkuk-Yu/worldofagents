// 음성 우선 진입 판정 (t_e735d936 요구 1) — 순수 로직 단위 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceFirstConsole } from '../../src/lib/layout';

test('웹 모바일(390) 비데모 = 음성 콘솔 우선', () => {
  assert.equal(voiceFirstConsole({ os: 'web', width: 390, isDemo: false }), true);
});

test('PC 레이아웃(768 이상) = 텍스트 입력 유지 — 가상 키보드 없는 환경', () => {
  assert.equal(voiceFirstConsole({ os: 'web', width: 768, isDemo: false }), false);
  assert.equal(voiceFirstConsole({ os: 'web', width: 1440, isDemo: false }), false);
});

test('네이티브(ios/android) = 기존 동작 유지', () => {
  assert.equal(voiceFirstConsole({ os: 'ios', width: 390, isDemo: false }), false);
  assert.equal(voiceFirstConsole({ os: 'android', width: 390, isDemo: false }), false);
});

test('데모 모드 = 음성 콘솔 금지 — 무의미한 마이크 권한 요구 방지, 텍스트 폴백', () => {
  assert.equal(voiceFirstConsole({ os: 'web', width: 390, isDemo: true }), false);
});

test('경계: 모바일=767 / PC=768 (PC_BREAKPOINT 포함)', () => {
  assert.equal(voiceFirstConsole({ os: 'web', width: 767, isDemo: false }), true);
  assert.equal(voiceFirstConsole({ os: 'web', width: 768, isDemo: false }), false);
});
