// t_4c12323c — 꼬리 추종 판정 순수 로직 단위 테스트 (lib/tailFollow)
// 재현 근거: 말미 근접 느린 위로 드래그 → 정착(gap≤100)이 의도 체인을 클리어한 직후
// 릴리스 관성이 gap>100을 건넘 → branch3 '수축 클램프 딥' 오판 → followTail 스냅백(445→356→404 실측).
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTailScroll, SETTLE_GAP, INTENT_WINDOW_MS, MOMENTUM_WINDOW_MS } from '../../src/lib/tailFollow';

const base = { gap: 500, scrolledUp: false, intent: false, touchRecent: false, nearBottom: true, following: false };

test('정착 — gap ≤ 100 은 항상 settle (방향/의도 무관)', () => {
  assert.equal(decideTailScroll({ ...base, gap: SETTLE_GAP }), 'settle');
  assert.equal(decideTailScroll({ ...base, gap: 0 }), 'settle');
  assert.equal(decideTailScroll({ ...base, gap: -20 }), 'settle'); // 과스크롤
  assert.equal(decideTailScroll({ ...base, gap: 50, scrolledUp: true, intent: true }), 'settle');
});

test('의도 있는 상방 이탈 — exit (기존 branch2 불변)', () => {
  assert.equal(decideTailScroll({ ...base, scrolledUp: true, intent: true }), 'exit');
  // 의도 창이지만 말미 밖 + following 활성 — branch2 우선(기존 if-else 순서 보존)
  assert.equal(decideTailScroll({ ...base, scrolledUp: true, intent: true, following: true }), 'exit');
});

test('r4 수축 클램프 딥 — 의도 없음 + 유휴 + 마킹 오래됨 = refollow (계약 보존)', () => {
  assert.equal(decideTailScroll({ ...base, scrolledUp: true }), 'refollow');
  // following(추종 루프 도는 중)이면 중복 재추종 금지 — hold (기존 !t.raf 가드)
  assert.equal(decideTailScroll({ ...base, scrolledUp: true, following: true }), 'hold');
});

test('t_4c12323c 핵심 — 정착 직후 관성 건넘: 의도 창은 만료됐지만(touchRecent) 모멘텀 창 이내면 exit', () => {
  // 실측 서명: gap≤100 이벤트가 userScrollAt=0 클리어 → 관성으로 gap>100, intent=false.
  // 수정 전: branch3 '의도 없는 감소' → refollow → 말미 스냅백(사용자 체감 '드래그 무반응').
  assert.equal(decideTailScroll({ ...base, scrolledUp: true, intent: false, touchRecent: true }), 'exit');
  // 하방(말미 방향) 감소가 아닌 증가는 관성 판정 대상 아님 — hold 유지
  assert.equal(decideTailScroll({ ...base, scrolledUp: false, touchRecent: true }), 'hold');
});

test('하방 이탈이 아니거나 nearBottom 아니면 판정 없음 — hold', () => {
  assert.equal(decideTailScroll({ ...base, scrolledUp: false }), 'hold'); // 말미에서 아래(관성 말림) 성장 없음
  assert.equal(decideTailScroll({ ...base, nearBottom: false }), 'hold'); // 이미 이탈 상태 — 사망 재확인 불요
});

test('창 상수 — 의도 400ms < 모멘텀 1200ms (정착 클리어 후 건넘을 커버하는 순서)', () => {
  assert.equal(INTENT_WINDOW_MS, 400);
  assert.equal(MOMENTUM_WINDOW_MS, 1200);
  assert.ok(MOMENTUM_WINDOW_MS > INTENT_WINDOW_MS);
});
