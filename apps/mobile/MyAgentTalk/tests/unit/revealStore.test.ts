// 리빌 저장소 단위 테스트 — src/lib/revealStore.ts (t_da4f8623)
// tick(now) 주입 구동(타머 비의존). 검증: feed/begin/move/markDone/finishOrDrop/reconcile 수명,
// view 폴백(원문)·되감기 불가·hasPending·구독 알림·reset/setEnabled 회수.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRevealStore } from '../../src/lib/revealStore';

const T0 = 1_760_000_000_000;

test('feed: 첫 청크에서 생성(진도 0) — 누적 신장만 허용, 짧은 incoming 무시', () => {
  const st = createRevealStore();
  st.feed('stream-r1', '안녕', T0);
  assert.ok(st.has('stream-r1'));
  assert.equal(st.view('stream-r1', '').text, ''); // 진도 0 — 아직 한 글자도 노출 전
  st.feed('stream-r1', '안녕하세요');
  st.tick(T0 + 32);
  assert.equal(st.view('stream-r1', '').text.length, 1, '첫 틱 = 1자 노출');
  st.feed('stream-r1', '안'); // 되감기 시도
  const mid = st.view('stream-r1', '').text;
  st.tick(T0 + 200);
  assert.ok(st.view('stream-r1', '').text.startsWith(mid.slice(0, 1)), 'text 되감기 없음(진도는 계속 전진)');
});

test('begin: 통째 확정 행(재질문)은 0부터 리빌, 재호출은 재시작하지 않는다', () => {
  const st = createRevealStore();
  assert.equal(st.begin('e1', '이거 맞죠?', T0), true);
  assert.equal(st.begin('e1', '이거 맞죠?', T0), false, '이미 상태 있음 = 재시작 금지');
  let now = T0;
  let shown = '';
  for (let i = 0; i < 30 && shown.length < 6; i++) { now += 32; st.tick(now); shown = st.view('e1', '이거 맞죠?').text; }
  assert.ok(st.has('e1'), 'sealed 리빌 중');
  // 소진 후 sealed → finished → 다음 틱 회수 → 폴백 수렴
  for (let i = 0; i < 200 && st.has('e1'); i++) { now += 32; st.tick(now); }
  assert.equal(st.has('e1'), false, 'sealed 소진 후 자연 회수 (영구 caret 금지)');
  assert.equal(st.view('e1', '이거 맞죠?').text, '이거 맞죠?', '회수 후 폴백=원문 수렴');
});

test('view 스냅샷: 내용 불변 시 참조 재사용(useSyncExternalStore 규약)', () => {
  const st = createRevealStore();
  st.begin('m1', '가나다');
  const a = st.view('m1', '가나다');
  const b = st.view('m1', '가나다');
  assert.equal(a, b, '동일 내용 = 동일 참조');
  const noState = st.view('ghost', '전문');
  assert.equal(noState.text, '전문');
  assert.equal(noState.typing, false, '미달 행 = 폴백(기존 렌더 1:1)');
});

test('move: 스트림 진도가 확정 행 키로 계승 — 0 재시작/되감기 없음, 소진 행은 회수', () => {
  const st = createRevealStore();
  st.feed('stream-r2', '가나다라마바사', T0);
  st.tick(T0 + 32);
  st.tick(T0 + 70); // 2자쯤 노출
  const revealedBefore = st.view('stream-r2', '').text.length;
  assert.ok(st.move('stream-r2', 'ans-1', '가나다라마바사아자'));
  assert.equal(st.has('stream-r2'), false, '원 키 회수');
  assert.ok(st.has('ans-1'), '행 키로 계승');
  assert.equal(st.view('ans-1', '가나다라마바사아자').text.length, revealedBefore, '진도 그대로(점프 없음)');
});

test('markDone: 소진 즉시 pendingDone→finished→회수 (정확히 드레인 창 이내)', () => {
  const st = createRevealStore();
  st.feed('stream-r3', '가'.repeat(40), T0);
  st.markDone('stream-r3', '가'.repeat(40));
  let now = T0;
  for (let i = 0; i < 200; i++) { now += 32; st.tick(now); if (!st.has('stream-r3')) break; }
  assert.equal(st.has('stream-r3'), false, '확정 후 잔류 소멸');
});

test('finishOrDrop: fullText 있으면 즉시 전문, 없으면 폐기(폴백=원문이 즉시 전문과 동일)', () => {
  const st = createRevealStore();
  st.feed('stream-r4', 'abcdef', T0);
  st.tick(T0 + 32);
  st.finishOrDrop('stream-r4', 'abcdefghij');
  const v = st.view('stream-r4', 'abcdefghij');
  assert.equal(v.text, 'abcdefghij', '취소·오류 = 즉시 확정 렌더(요구4)');
  st.feed('stream-r5', 'abcdef', T0);
  st.finishOrDrop('stream-r5');
  assert.equal(st.has('stream-r5'), false);
  assert.equal(st.view('stream-r5', 'abcdef').text, 'abcdef', 'drop 후 폴백 즉시 전문');
});

test('reconcileStreamKeys: 진행 키만 유지, 고아 stream-* 폐기, 행 키는 건드리지 않음', () => {
  const st = createRevealStore();
  st.feed('stream-live', 'aaaa', T0);
  st.feed('stream-dead', 'bbbb', T0);
  st.begin('row-9', 'cccc', T0);
  st.reconcileStreamKeys(['stream-live']);
  assert.ok(st.has('stream-live'));
  assert.equal(st.has('stream-dead'), false, 'streams 목록 밖 = 고아 회수');
  assert.ok(st.has('row-9'), '행 키(stream- 접두 아님)는 대상 아님');
});

test('hasPending/subscribeAll: 리빌 존재가 반응형으로 갱신, 소진 후 false', () => {
  const st = createRevealStore();
  const events: boolean[] = [];
  st.subscribeAll(() => events.push(st.hasPending()));
  assert.equal(st.hasPending(), false);
  st.feed('stream-r6', '나다', T0);
  assert.equal(st.hasPending(), true, 'feed 직후 pending');
  let now = T0;
  for (let i = 0; i < 120 && st.hasPending(); i++) { now += 32; st.tick(now); }
  assert.equal(st.hasPending(), false, '소진 후 false (타머 자연 정지 조건)');
  assert.ok(events.length >= 2, '전역 알림이 pending 전이를 반영');
});

test('setEnabled(false): 진행 중 상태 즉시 회수 → 폴백=전문 수렴 (reduced-motion 경로)', () => {
  const st = createRevealStore();
  st.feed('stream-r7', 'abcdef', T0);
  st.tick(T0 + 32);
  st.setEnabled(false);
  assert.equal(st.has('stream-r7'), false);
  assert.equal(st.view('stream-r7', 'abcdef').text, 'abcdef');
  st.feed('stream-r8', 'zz'); // OFF에서는 상태 생성 자체가 없다
  assert.equal(st.has('stream-r8'), false, 'OFF = 미생성(기존 렌더 1:1)');
});

test('reset:全体 폐기 + 알림 (하네스/테스트 격리)', () => {
  const st = createRevealStore();
  st.feed('stream-a', 'xx');
  st.begin('row-b', 'yy');
  let notified = 0;
  st.subscribeAll(() => { notified++; });
  st.reset();
  assert.equal(st.has('stream-a'), false);
  assert.equal(st.has('row-b'), false);
  assert.ok(notified >= 2, '회수된 키별 알림');
});

test('대형 행: begin/feed 모두 MAX 초과 시 상태 미생성(장문 통째 타이핑 금지, 폴백 즉시 렌더)', () => {
  const st = createRevealStore();
  const huge = '가'.repeat(1600);
  assert.equal(st.begin('row-big', huge), false);
  st.feed('stream-big', huge);
  assert.equal(st.has('stream-big'), false);
  assert.equal(st.has('row-big'), false);
});
