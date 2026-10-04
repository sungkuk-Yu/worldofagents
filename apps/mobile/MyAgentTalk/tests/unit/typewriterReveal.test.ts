// 사람 타이핑 리빌 스케줄러 순수 로직 단위 테스트 — src/lib/typewriterReveal.ts (t_da4f8623)
// 카드 검증 항목: ① 지터 시드 결정성 ② 되감기 불가 ③ 버퍼 선행(서버가 앞서가도 노출은 진도대로)
// ④ 40~120ms 지터 범위·문장부호 150~400ms·무리 경계 ⑤ 확정(finish) 시 전문 즉시 ⑥ 커서 소진 판정.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVEAL_CHAR_MS, REVEAL_MIN_MS, REVEAL_PAUSE_MS, REVEAL_TICK_MS, REVEAL_DRAIN_TICKS,
  advanceReveal, createReveal, feedReveal, finishReveal, gapAfterChar, isRevealing,
  revealChars, revealNow, revealRand, revealedText,
  type RevealState,
} from '../../src/lib/typewriterReveal';

const T0 = 1_760_000_000_000;
const text30 = '가나다라마바사아자차카타파하가나다라마바사아자차';

test('시드 결정성: 같은 key/step은 같은 랜드, 다른 key는 다른 시퀀스', () => {
  const a = [0, 1, 2, 3].map((i) => revealRand(0xabcdef, i));
  const b = [0, 1, 2, 3].map((i) => revealRand(0xabcdef, i));
  assert.deepEqual(a, b, '동일 시드는 동일 시퀀스');
  const c = [0, 1, 2, 3].map((i) => revealRand(0x123456, i));
  assert.notDeepEqual(a, c, '다른 key 해시 = 다른 노출 패턴');
  a.forEach((v) => { assert.ok(v >= 0 && v <= 1, 'revealRand는 [0,1]'); });
});

test('지터 범위: 일반 문자 40~120ms, 문장부호 150~400ms (seed 전수 표본)', () => {
  const s: RevealState = { ...createReveal('r1', T0), text: 'x' };
  for (let seedStep = 0; seedStep < 4000; seedStep++) {
    const { gap } = gapAfterChar(s, '가', seedStep);
    assert.ok(gap >= REVEAL_MIN_MS && gap <= REVEAL_CHAR_MS + 1, `일반 간격 범위 이탈: ${gap}`);
  }
  for (const punct of ['.', '?', '!', ',', '\n']) {
    for (let seedStep = 0; seedStep < 2000; seedStep++) {
      const { gap, burst } = gapAfterChar(s, punct, seedStep);
      assert.ok(gap >= 150 && gap <= REVEAL_PAUSE_MS, `구두점 숨고르 범위 이탈(${punct}): ${gap}`);
      assert.equal(burst, 0, '구두점 뒤 무리 리셋');
    }
  }
});

test('1틱 1자 원칙 + nextRevealAt = 지터: 자연 리빌은 매 틱 최대 1자만 전진', () => {
  let s: RevealState = { ...createReveal('run-A', T0), text: text30 };
  let now = T0;
  const gaps: number[] = [];
  for (let i = 0; i < 12; i++) {
    const before = s.revealed;
    let moved = false;
    [s, moved] = advanceReveal(s, now);
    assert.ok(moved, 'nextRevealAt 도래 틱이면 전진');
    assert.ok(s.revealed - before <= 1, '1틱 최대 1자 (버퍼 폭주 소진 금지)');
    gaps.push(s.nextRevealAt - now);
    now = s.nextRevealAt;
  }
  assert.equal(s.revealed, 12);
  assert.equal(revealedText(s), text30.slice(0, 12), '노출 진도 = 처음 12자');
});

test('클럭 점프·탭 스로틀링: 대기 시간이 몰려 있어도 한 번에 1자만 (되감기처럼 보이는 점프 금지)', () => {
  let s: RevealState = { ...createReveal('run-B', T0), text: text30 };
  s = { ...s, nextRevealAt: T0 - 10_000 }; // 10초 어제의 만료 시각 (스로틀 복귀 시뮬)
  const [n1, moved1] = advanceReveal(s, T0);
  assert.ok(moved1);
  assert.equal(n1.revealed, 1, '2자 이상 스킵 전진 금지');
  assert.ok(n1.nextRevealAt >= T0 + REVEAL_MIN_MS, '다음 시각은 now 기준으로 재계산(폭주 연쇄 없음)');
});

test('되감기 불가: feedReveal은 더 짧은 incoming을 무시하고 text를 보존', () => {
  let s: RevealState = { ...createReveal('run-C', T0), text: 'abcdef' };
  s = feedReveal(s, 'abcdefghij');
  assert.equal(s.text, 'abcdefghij');
  s = feedReveal(s, 'abc');
  assert.equal(s.text, 'abcdefghij', '짧아지는 incoming = 이상 프레임, 무시');
  const before = { ...s };
  s = feedReveal(s, 'abcdefghij');
  assert.deepEqual(s, before, '동일 incoming은 무오퍼');
});

test('버퍼 선행: 서버가 노출을 크게 앞서도 진도는 그대로, 노출만 순차 소진', () => {
  // empathy 통째 행 = 30자가 한 번에 arrive → revealed 0에서 시작(도착 즉시 통째 렌더 금지)
  let s: RevealState = { ...createReveal('e1', T0), text: text30, sealed: true };
  assert.equal(s.revealed, 0);
  assert.ok(isRevealing(s), '버퍼(전문) ≫ 진도(0) = 리빌 진행');
  let now = T0;
  let ticks = 0;
  while (isRevealing(s) && ticks < 200) { [s] = advanceReveal(s, now); now = s.nextRevealAt; ticks++; }
  assert.ok(ticks >= revealChars(text30).length, '소진 틱 수 ≥ 문자 수 (1틱 1자 상한 = 폭주 아님)');
  assert.equal(s.revealed, revealChars(text30).length);
  // 진행 중 새 청크 선행: 진도 뒤로 가지 않는다
  let g: RevealState = { ...createReveal('r2', T0), text: 'aaaa', revealed: 2 };
  g = feedReveal(g, 'aaaaaaaaaa');
  assert.equal(g.revealed, 2, 'text 신장이 진도를 되돌리지 않는다');
  const [g2] = advanceReveal(g, g.nextRevealAt);
  assert.equal(g2.revealed, 3, '이어붙임은 진도+1');
});

test('pendingDone 소진: 확정 힌트 후 잔여는 REVEAL_DRAIN_TICKS 내 소진, 폭주·영구잔류 없음', () => {
  const remaining = 60;
  const drainStep = Math.max(1, Math.ceil(remaining / REVEAL_DRAIN_TICKS));
  let s: RevealState = { ...createReveal('r3', T0), text: '가'.repeat(remaining), pendingDone: true, drainStep };
  let now = T0;
  let guard = REVEAL_DRAIN_TICKS + 5;
  while (isRevealing(s) && guard-- > 0) {
    now += REVEAL_TICK_MS;
    [s] = advanceReveal(s, now);
  }
  assert.ok(isRevealing(s) === false, '드레인 창 내 소진');
  assert.equal(s.revealed, remaining);
});

test('finishReveal/revealNow: 전문 즉시, 되감기 없음 — 이후 전진 no-op', () => {
  let s: RevealState = { ...createReveal('r4', T0), text: 'abcdef', revealed: 2 };
  s = finishReveal(s, 'abcdefgh');
  assert.equal(s.text, 'abcdefgh');
  assert.equal(s.revealed, 8);
  assert.ok(s.finished);
  const [again, moved] = advanceReveal(s, s.nextRevealAt + 10_000);
  assert.equal(moved, false, '확정 후 진동 없음');
  assert.equal(again, s);
  let t: RevealState = { ...createReveal('r5', T0), text: 'abcdef', revealed: 1 };
  t = revealNow(t);
  assert.equal(t.revealed, 6, '즉시 전량(reduced-motion 폴백)');
  assert.ok(t.finished);
});

test('노출 패턴 결정성 + 간격 불변식: 같은 키/텍스트 두 스트림은 동일 틱열, 모든 gap은 봉인 범위 안', () => {
  const run = (key: string) => {
    let s: RevealState = { ...createReveal(key, T0), text: text30 };
    const gaps: number[] = [];
    let now = T0;
    for (let i = 0; i < 20; i++) {
      const prevAt = s.nextRevealAt;
      now = Math.max(now, prevAt);
      const [ns, moved] = advanceReveal(s, now);
      if (!moved) break; // 텍스트 소진 — 더 틱 없음
      gaps.push(ns.nextRevealAt - now);
      s = ns;
    }
    return { text: revealedText(s), gaps };
  };
  const a = run('same-key');
  const b = run('same-key');
  assert.deepEqual(a.gaps, b.gaps, '동일 키 = 동일 노출 패턴 (Math.random 무결성 증거)');
  assert.deepEqual(a.text, b.text);
  const ranges = run('other-key').gaps.map((g, i) => [g, i]);
  for (const [g] of ranges) {
    assert.ok((g >= REVEAL_MIN_MS && g <= REVEAL_CHAR_MS) || (g >= 150 && g <= REVEAL_PAUSE_MS), `gap 불변식 이탈: ${g}`);
  }
});
