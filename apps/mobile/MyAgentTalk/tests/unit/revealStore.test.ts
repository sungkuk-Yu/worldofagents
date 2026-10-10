// 리빌 저장소 단위 테스트 — src/lib/revealStore.ts (t_4c266653 3차 개정: 지터 타이머 폐기·문장 단위)
// tick(now) 주입은 정리원(회수) 경로만 — 노출 전진은 feed/markDone/move 이벤트 즉시(≤1틱 게이트의 0틱 근거).
// 검증: feed 즉시 경계 노출·미완 보류·begin(통째) 미생성(③)·수명(finish 회수)·view 폴백·되감기 불가·
// hasPending·구독·setEnabled/reset 회수·exceptKey 하위 호환.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRevealStore } from '../../src/lib/revealStore';

test('feed: 컷점 포함 첫 청크에서 생성+즉시 노출 (0틱 — 타이머 대기 없음)', () => {
  const st = createRevealStore();
  const moved = st.feed('stream-r1', '안녕. 추가');
  assert.ok(st.has('stream-r1'));
  assert.equal(moved, true, '컷점이 있으면 feed 반환 즉시 전진');
  assert.equal(st.view('stream-r1', '').text, '안녕.', '경계까지만 노출, 미완 꼬리는 보류');
});

test('feed: 컷점 없는 누적은 노출 0 — 다음 컷점 포함 청크까지 보류(줄 단위 재줄바꿈 방지)', () => {
  const st = createRevealStore();
  st.feed('stream-r2', '좋');
  assert.equal(st.view('stream-r2', '').text, '');
  st.feed('stream-r2', '좋습니다');
  assert.equal(st.view('stream-r2', '').text, '');
  st.feed('stream-r2', '좋습니다. 드');
  assert.equal(st.view('stream-r2', '').text, '좋습니다.', '마지막 컷점까지 통째');
  st.feed('stream-r2', '좋습니다. 드'); // 되감기 시도(짧은 incoming)
  assert.equal(st.view('stream-r2', '').text, '좋습니다.', 'text 되감기 없음(진도·버퍼 보존)');
});

test('begin(통째 도착): 리빌 상태 생성하지 않는다 — 즉시 표시가 정답 (t_4c266653 ③)', () => {
  const st = createRevealStore();
  assert.equal(st.begin('e1', '이거 맞죠?', Date.now()), false);
  assert.equal(st.has('e1'), false, 'empathy 재질문 = 상태 미생성');
  assert.equal(st.view('e1', '이거 맞죠?').text, '이거 맞죠?', '폴백=원문 즉시 렌더');
  assert.equal(st.hasPending(), false, '통째 행이 칩 발화 창을 태우지 않는다 (exceptKey 불요의 근본 해결)');
});

test('view 스냅샷: 내용 불변 시 참조 재사용(useSyncExternalStore 규약)', () => {
  const st = createRevealStore();
  st.feed('m1', '가나다.');
  const a = st.view('m1', '전문');
  const b = st.view('m1', '전문');
  assert.equal(a, b, '동일 내용 = 동일 참조');
  const noState = st.view('ghost', '전문');
  assert.equal(noState.text, '전문');
  assert.equal(noState.typing, false, '미달 행 = 폴백(기존 렌더 1:1)');
});

test('move: 스트림 진도가 확정 행 키로 계승 — 통째 즉시(되감기·점프 없음) 후 다음 틱 회수', () => {
  const st = createRevealStore();
  st.feed('stream-r3', '가나다.\n라마.');
  const revealedBefore = st.view('stream-r3', '').text;
  assert.ok(st.move('stream-r3', 'ans-1', '가나다.\n라마.아자'));
  assert.equal(st.has('stream-r3'), false, '원 키 회수');
  assert.ok(st.has('ans-1'), '행 키로 계승');
  const v = st.view('ans-1', '가나다.\n라마.아자');
  assert.ok(v.text.startsWith(revealedBefore), '진도 보존(앞선 노출이 뒤로 가지 않는다)');
  assert.equal(v.text, '가나다.\n라마.아자', '확정 본문은 전문 즉시');
  st.tick(); // finished 정리원 회수
  assert.equal(st.has('ans-1'), false, '다음 틱에 회수 → 폴백=원문과 동일 텍스트 수렴');
});

test('markDone: 미완 꼬리 포함 전문 즉시 + 다음 tick 회수 — 폭주·영구잔류 없음', () => {
  const st = createRevealStore();
  st.feed('stream-r4', '가'.repeat(40) + '. 미완');
  st.markDone('stream-r4', '가'.repeat(40) + '. 미완입니다.');
  assert.equal(st.view('stream-r4', '').text.length, 40 + '. 미완입니다.'.length, 'done = 보류 구간 포함 전량 즉시');
  st.tick();
  assert.equal(st.has('stream-r4'), false, '정리원 회수');
});

test('finishOrDrop: fullText 있으면 즉시 전문, 없으면 폐기(폴백=원문이 즉시 전문과 동일)', () => {
  const st = createRevealStore();
  st.feed('stream-r5', 'abcdef.');
  st.finishOrDrop('stream-r5', 'abcdefghij');
  const v = st.view('stream-r5', 'abcdefghij');
  assert.equal(v.text, 'abcdefghij', '취소·오류 = 즉시 확정 렌더(요구4)');
  st.feed('stream-r6', 'abcdef.');
  st.finishOrDrop('stream-r6');
  assert.equal(st.has('stream-r6'), false);
  assert.equal(st.view('stream-r6', 'abcdef.').text, 'abcdef.', 'drop 후 폴백 즉시 전문');
});

test('reconcileStreamKeys: 진행 키만 유지, 고아 stream-* 폐기, 행 키는 건드리지 않음', () => {
  const st = createRevealStore();
  st.feed('stream-live', 'aaaa.');
  st.feed('stream-dead', 'bbbb.');
  st.feed('row-9-x', 'cccc.'); // stream- 접두 아님
  st.reconcileStreamKeys(['stream-live']);
  assert.ok(st.has('stream-live'));
  assert.equal(st.has('stream-dead'), false, 'streams 목록 밖 = 고아 회수');
  assert.ok(st.has('row-9-x'), '행 키(stream- 접두 아님)는 대상 아님');
});

test('hasPending/subscribeAll: 보류(미완 꼬리)가 true, 회수 후 false — 타이머 생명과 무관한 상태 판정', () => {
  const st = createRevealStore();
  const events: boolean[] = [];
  st.subscribeAll(() => events.push(st.hasPending()));
  assert.equal(st.hasPending(), false);
  st.feed('stream-r7', '노출됨. 아직 보류 중');
  assert.equal(st.hasPending(), true, '컷점 노출 후 미완 꼬리 보류 = pending (caret 유지)');
  st.markDone('stream-r7', '노출됨. 아직 보류 중 완료');
  st.tick(); // finished 회수
  assert.equal(st.hasPending(), false, '확정 회수 후 false');
  assert.ok(events.length >= 2, '전역 알림이 pending 전이를 반영');
});

test('setEnabled(false): 진행 중 상태 즉시 회수 → 폴백=전문 수렴 (reduced-motion 경로) + OFF = 미생성', () => {
  const st = createRevealStore();
  st.feed('stream-r8', 'abcdef.');
  st.setEnabled(false);
  assert.equal(st.has('stream-r8'), false);
  assert.equal(st.view('stream-r8', 'abcdef.').text, 'abcdef.');
  st.feed('stream-r9', 'zz.'); // OFF에서는 상태 생성 자체가 없다
  assert.equal(st.has('stream-r9'), false, 'OFF = 미생성(기존 렌더 1:1)');
});

test('reset: 全体 폐기 + 알림 (하네스/테스트 격리)', () => {
  const st = createRevealStore();
  st.feed('stream-a', 'xx.');
  st.feed('stream-b', 'yy.');
  let notified = 0;
  st.subscribeAll(() => { notified++; });
  st.reset();
  assert.equal(st.has('stream-a'), false);
  assert.equal(st.has('stream-b'), false);
  assert.ok(notified >= 2, '회수된 키별 알림');
});

test('대형 스트림: feed가 MAX 초과 시 상태 미생성(장문 리빌 금지, 폴백 즉시 렌더) — 이후 더 커지면 즉시 전문', () => {
  const st = createRevealStore();
  const huge = '가'.repeat(1600) + '.';
  st.feed('stream-big', huge);
  assert.equal(st.has('stream-big'), false, '첫 청크부터 대형 = 미생성');
  st.feed('stream-big2', '작은 시작.');
  st.feed('stream-big2', huge); // 성장으로 대형 진입
  assert.equal(st.view('stream-big2', huge).text.length > 100, true, '대형 성장 = 즉시 전문(폴백 수렴)');
});

test('t_e1de4cc4 ② 하위 호환: hasPending(exceptKey) — 인자 규약 유지. ③ 이후 통째 행은 애초에 리빌을 만들지 않는다', () => {
  const st = createRevealStore();
  assert.equal(st.begin('emp-1', '긴 재질문입니다. 맞죠?', Date.now()), false, '③: empathy 리빌 미생성');
  assert.equal(st.hasPending(), false, '통째 도착 = 칩 억제 사유 0 (exceptKey 없이도 해소)');
  assert.equal(st.hasPending('emp-1'), false, 'exceptKey 경로도 동일 결과');
  st.feed('stream-r10', '답변 성장 중', Date.now()); // 컷점 없음 = 미완 보류 = pending
  assert.equal(st.hasPending('emp-1'), true, '답변 delta 리빌(stream-*)은 억제 사유 유지');
  st.markDone('stream-r10');
  st.tick();
  assert.equal(st.hasPending('emp-1'), false, '소진+회수 후 어떤 키에서도 false');
});
