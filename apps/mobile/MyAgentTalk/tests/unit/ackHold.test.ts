// 조이스틱 끝방향 홀드-arm 순수 로직 단위 테스트 — src/lib/ackHold.ts (카드 t_043539ff)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ACK_HOLD_MS, ackPhraseForDirection, resolveArmedAck } from '../../src/lib/ackHold';

test('끝방향 → 문장 키: DIR_LEFT=예, DIR_RIGHT=아니요, 나머지(↑ 등)/null 없음', () => {
  assert.equal(ackPhraseForDirection('DIR_LEFT'), 'yes');
  assert.equal(ackPhraseForDirection('DIR_RIGHT'), 'no');
  for (const g of ['DIR_UP', 'DIR_DOWN', 'DIR_UPLEFT', 'DIR_UPRIGHT', 'DIR_DOWNLEFT', 'DIR_DOWNRIGHT', 'TAP_CENTER', 'LONG_CENTER'] as const) {
    assert.equal(ackPhraseForDirection(g), null, g);
  }
  assert.equal(ackPhraseForDirection(null), null);
});

test('resolveArmedAck — 무장 방향과 릴리스 최종 방향이 같아야 발화; 이동 시 해제', () => {
  assert.equal(resolveArmedAck('DIR_LEFT', 'DIR_LEFT'), 'yes');
  assert.equal(resolveArmedAck('DIR_RIGHT', 'DIR_RIGHT'), 'no');
  assert.equal(resolveArmedAck('DIR_LEFT', 'DIR_UP'), null);   // arm 후 ↑ 이동 = 키보드 경로 복귀
  assert.equal(resolveArmedAck('DIR_LEFT', null), null);       // 데드존 복귀 후 릴리스 = 전송 없음
  assert.equal(resolveArmedAck(null, 'DIR_LEFT'), null);       // 얕은 스와이프 = 기존 매핑 경로
});

test('홀드 임계 800ms (카드 #2: 끝 각도 도달 후 0.8초 유지)', () => {
  assert.equal(ACK_HOLD_MS, 800);
});

test('발화 텍스트 계약 — i18n ko/en 값이 백엔드 isConfirmationUtterance 집합과 완전 일치', () => {
  // 백엔드(graph.ts): trim().toLowerCase() 후 trailing punct 제거 → Set 정확 일치 (부분일치 금지).
  // t_5e407a8a(c090d94a) 확장: '맞아요' 계열 + '아니에오' 계열 추가 — 프론트 라벨 바인딩 대비.
  const locales = ['ko', 'en'];
  const backendSet = new Set(['예', '네', '요', 'ㅇ', 'ㄴ', '응', '어', '넵', '넹', 'ㅇㅋ', 'ㄴㄴ',
    '아니', '아니요', '아니오', 'yes', 'no', 'yeah', 'yep', 'nope', 'nah', 'y', 'n', 'ok', 'okay',
    '맞아요', '맞습니다', '맞음', '맞아', '아니에오', '아니에요', '아닙니다',
    '틀렸어', '틀렸어요', '틀림']);
  for (const loc of locales) {
    const json = JSON.parse(readFileSync(path.join(__dirname, '../../src/i18n/locales', `${loc}.json`), 'utf8'));
    // 기본 예/아니요 + t_c62a2eb7 어미 바인딩('맞죠?' 템플릿) 맞아요/아니에오 라벨 전부 게이트 통과 필요
    for (const key of ['ackYes', 'ackNo', 'ackMatchYes', 'ackMatchNo']) {
      const v = json.chat[key];
      assert.ok(v, `${loc} chat.${key} 결측`);
      const norm = v.trim().toLowerCase().replace(/[.!~〜？?。，,\s]+$/g, '');
      assert.ok(norm.length > 0 && norm.length <= 8 && backendSet.has(norm), `${loc} ${key}=${v} 미수용`);
    }
    assert.notEqual(json.chat.ackYes, json.chat.ackNo);
    assert.notEqual(json.chat.ackMatchYes, json.chat.ackMatchNo);
  }
  const ko = JSON.parse(readFileSync(path.join(__dirname, '../../src/i18n/locales/ko.json'), 'utf8'));
  assert.equal(ko.chat.ackYes, '예');
  assert.equal(ko.chat.ackNo, '아니요');
  assert.equal(ko.chat.ackMatchYes, '맞아요');
  assert.equal(ko.chat.ackMatchNo, '아니에오');
});

test('게이트 집합 대비 라벨 안전선 — 부분일치 금지 원칙: 붙은 문장 발화 금지 (regression 가드)', () => {
  // isConfirmationUtterance는 정확 일치만 통과시키므로, 라벨이 '예'/'아니요' 단어가 아니어도
  // 백엔드 집합에 명시 등재되어 있으면 안전. 라벨이 문장화되면(예: '네, 맞아요') 게이트 실패 — 금지.
  const ko = JSON.parse(readFileSync(path.join(__dirname, '../../src/i18n/locales/ko.json'), 'utf8'));
  for (const key of ['ackYes', 'ackNo', 'ackMatchYes', 'ackMatchNo']) {
    assert.ok(!/[.!~?？]/.test(ko.chat[key]) && ko.chat[key].length <= 4, `${key}="${ko.chat[key]}" — 짧은 단문 유지`);
  }
});
