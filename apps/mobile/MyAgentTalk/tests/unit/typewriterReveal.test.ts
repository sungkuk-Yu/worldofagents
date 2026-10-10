// 문장 단위 리빌 스케줄러 순수 로직 단위 테스트 — src/lib/typewriterReveal.ts (t_4c266653 3차 개정)
// t_da4f8623의 40~120ms 지터/seed/xorshift는 폐기 — 대표님 10/10 원지시 ①: 30자/s 타이머 제거,
// 노출 = 서버 스트림 속도 그대로. 검증 항목:
//  ① 컷점 계산(\\n·.? ! … = 컷 / ,는 컷 아님 — 카드 경계 케이스) ② 지연 0: feed 즉시 경계까지
//  ③ 미완 꼬리 보류 → done 전문 즉시 ④ 되감기 불가·단조 ⑤ 즉시 전문(finish/revealNow) no-op 수렴.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVEAL_TICK_MS, SENTENCE_CLOSERS,
  advanceReveal, createReveal, feedReveal, finishReveal, isRevealing,
  revealChars, revealNow, revealedText, sentenceBoundary,
  type RevealState,
} from '../../src/lib/typewriterReveal';

const text30 = '가나다라마바사아자차카타파하가나다라마바사아자차';

test('컷점: \\n과 종결부호 .?!… 모두 컷, 쉼표(,)와 중간 글자는 컷 아니다 (김비서 #664 확정 + 카드 케이스)', () => {
  assert.equal(sentenceBoundary(revealChars('안녕하세요.')), 6, '마침표까지 = 컷점 직후');
  assert.equal(sentenceBoundary(revealChars('그래요? 그렇네요! 좋습니다…')), 16, '물음/느낌표/줄임표 컷');
  assert.equal(sentenceBoundary(revealChars('첫 줄\n둘째 줄')), 4, '개행 컷(개행 포함 길이)');
  assert.equal(sentenceBoundary(revealChars('음, 아직 미완')), 0, '쉼표는 컷점 아니다 → 전문 미완 보류');
  assert.equal(sentenceBoundary(revealChars(text30)), 0, '종결 없는 스트림은 컷점 0 (보류)');
  // 마지막 컷점 이후 미완이 있어도 앞선 문장까지만 노출
  assert.equal(sentenceBoundary(revealChars('첫 문장. 두 번째가 이어지는 중')), 5, '마지막 컷점 = 5');
  assert.ok(SENTENCE_CLOSERS.includes('.'));
});

test('지연 0: 컷점을 담은 청크는 feed 직후 advance에서 경계까지 통째 전진 (1자씩 끌지 않는다)', () => {
  let s: RevealState = createReveal('r1');
  s = feedReveal(s, '좋아요. '); // 첫 delta에 종결부호 포함 (서버 ~5자/톡 청크의 실사례)
  const [n, moved] = advanceReveal(s);
  assert.ok(moved, '도착 틱에 즉시 전진 — nextRevealAt/대기 개념 폐기');
  assert.equal(n.revealed, 4, '. 직전(7)이 아니라 컷점 직후(4)까지');
  assert.equal(revealedText(n), '좋아요.');
});

test('미완 꼬리 보류: 종결부호 없는 누적은 노출 0 — 다음 컷점 포함 청크까지 기다린다', () => {
  let s: RevealState = createReveal('r2');
  for (const chunk of ['좋', '좋습', '좋습니다', '좋습니다.']) {
    s = feedReveal(s, chunk);
    const [n, moved] = advanceReveal(s);
    assert.equal(moved, chunk === '좋습니다.', `청크 '${chunk}': 컷점 전까지 전진 없음(점프·재줄바꿈 방지)`);
    if (moved) s = n;
  }
  assert.equal(revealedText(s), '좋습니다.');
});

test('되감기 불가: feedReveal은 더 짧은 incoming을 무시하고 text를 보존', () => {
  let s: RevealState = { ...createReveal('r3'), text: 'abcdefghij', revealed: 10 };
  s = feedReveal(s, 'abc');
  assert.equal(s.text, 'abcdefghij', '짧아지는 incoming = 이상 프레임, 무시');
  const before = { ...s, revealed: 4 };
  s = feedReveal(before, 'abcdefghij');
  assert.equal(s, before, '동일 incoming은 무오퍼');
});

test('버퍼 선행(폭주 delta): 서버가 수십 문자를 앞서 도착해도 노출은 컷점 단위 단조 — 소진 틱 폭주 없음', () => {
  // 5자 청크 8개가 한 틱에 몰려 들어온 시뮬 (서버 pacer 폭주)
  let s: RevealState = createReveal('r4');
  const full = '첫 문장. 둘째 문장. 셋째는 아직';
  s = feedReveal(s, full);
  let [n, moved] = advanceReveal(s);
  assert.ok(moved);
  assert.equal(n.revealed, sentenceBoundary(revealChars(full)), '두 문장까지 즉시(=스트림 속도), 미완 셋째는 보류');
  assert.ok(isRevealing(n), '미완 꼬리 보류 중 = 리빌 진행(caret 유지)');
  [n, moved] = advanceReveal(n);
  assert.equal(moved, false, '컷점 없으면 재전진 없음 — 지터 틱 루프가 없다');
});

test('done(확정) = 미완 꼬리 포함 전문 즉시, 이후 advance는 no-op', () => {
  let s: RevealState = { ...createReveal('r5'), text: '첫 문장. 미완', revealed: 4 };
  const [n, moved] = advanceReveal(s, true); // pendingDone
  assert.ok(moved, 'done 구간 보류 금지 — 전문 전진');
  assert.equal(revealedText(n), '첫 문장. 미완');
  const fin: RevealState = { ...n, finished: true };
  const [again, moved2] = advanceReveal(fin);
  assert.equal(moved2, false, '확정 후 진동 없음');
  assert.equal(again, fin, '확정 상태는 참조 그대로 (재렌더 없음)');
});

test('finishReveal/revealNow: 전문 즉시, 되감기 없음 (취소·오류·reduced-motion 폴백)', () => {
  let s: RevealState = { ...createReveal('r6'), text: 'abcdef', revealed: 2 };
  s = finishReveal(s, 'abcdefgh');
  assert.equal(s.text, 'abcdefgh');
  assert.equal(s.revealed, 8);
  assert.ok(s.finished);
  const [again, moved] = advanceReveal(s);
  assert.equal(moved, false);
  assert.equal(again, s, '확정 상태는 참조 그대로 (재렌더 없음)');
  let t: RevealState = { ...createReveal('r7'), text: text30, revealed: 1 };
  t = revealNow(t);
  assert.equal(t.revealed, revealChars(text30).length, '즉시 전량(플래그 OFF/reduced-motion)');
  assert.ok(t.finished);
});

test('결정성: 같은 입력 = 같은 출력 — 랜덤·시드 제거로 전 경로 결정적 (e2e 중간 프레임 단언 재현)', () => {
  const run = () => {
    let s: RevealState = createReveal('same');
    const out: number[] = [];
    for (const chunk of ['하이. ', '그래, ', '이건 어때?', '미완']) {
      s = feedReveal(s, revealedText(s) + chunk);
      const [n, moved] = advanceReveal(s);
      if (moved) s = n;
      out.push(s.revealed);
    }
    const [done] = advanceReveal(s, true);
    out.push(done.revealed);
    return out;
  };
  assert.deepEqual(run(), run(), '두 실행 진도열 동일');
  assert.equal(REVEAL_TICK_MS, 32, '틱 상수는 revealStore와 정합 유지');
});
