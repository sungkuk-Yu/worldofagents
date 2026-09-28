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
  // 백엔드(graph.ts): trim().toLowerCase() 후 trailing punct 제거 → Set {'예','아니요',...,'yes','no'}
  const locales = ['ko', 'en'];
  for (const loc of locales) {
    const json = JSON.parse(readFileSync(path.join(__dirname, '../../src/i18n/locales', `${loc}.json`), 'utf8'));
    const yes = json.chat.ackYes;
    const no = json.chat.ackNo;
    const norm = (s: string) => s.trim().toLowerCase().replace(/[.!~〜？?。，,\s]+$/g, '');
    const backendSet = new Set(['예', '네', '요', 'ㅇ', 'ㄴ', '응', '어', '넵', '넹', 'ㅇㅋ', 'ㄴㄴ',
      '아니', '아니요', '아니오', 'yes', 'no', 'yeah', 'yep', 'nope', 'nah', 'y', 'n', 'ok', 'okay']);
    assert.ok(norm(yes).length <= 8 && backendSet.has(norm(yes)), `${loc} ackYes=${yes} 미수용`);
    assert.ok(norm(no).length <= 8 && backendSet.has(norm(no)), `${loc} ackNo=${no} 미수용`);
    assert.notEqual(norm(yes), norm(no));
  }
  const ko = JSON.parse(readFileSync(path.join(__dirname, '../../src/i18n/locales/ko.json'), 'utf8'));
  assert.equal(ko.chat.ackYes, '예');
  assert.equal(ko.chat.ackNo, '아니요');
});
