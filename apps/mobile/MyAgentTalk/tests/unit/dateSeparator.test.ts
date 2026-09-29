// 날짜 구분선 순수 로직 (t_34f3e92c 백로그②) — 라벨 산출/삽입/고정 탭 push-out 회귀
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertDateSeparators, isDateSeparator, computePinnedDate, groupByTurn, TurnGroup, ChatMessage } from '../../src/lib/chatLogic';
import { formatDateSeparator } from '../../src/i18n/format';

const msg = (id: string, createdAt?: string, role: 'user' | 'agent' = 'user', turnIndex = 0): ChatMessage =>
  ({ id, role, content: id, turnIndex, createdAt });
const label = (m: ChatMessage) => (m.createdAt ? 'L:' + m.createdAt.slice(0, 10) : null);

test('구분선 삽입 — 날짜 경계의 그룹 앞에만, 그룹 내부·잘못된 시간은 스킵', () => {
  const groups = groupByTurn([
    msg('a', '2026-09-26T10:00:00'), msg('b', '2026-09-26T10:05:00', 'agent', 1), // 같은 날 두 그룹
    msg('c', '2026-09-27T09:00:00'), msg('d', undefined),                          // 날짜 변경 / 시간 없음
    msg('e', '2026-09-28T09:00:00'),                                               // 그다음 날(시간 없는 그룹 경계는 무시)
  ]);
  const feed = insertDateSeparators(groups, label);
  assert.deepEqual(feed.map((it) => isDateSeparator(it) ? 'sep@' + it.key : 'g:' + it.key), [
    'sep@sep:a', 'g:a', 'g:b', 'sep@sep:c', 'g:c', 'g:d', 'sep@sep:e', 'g:e',
  ]);
  assert.equal((feed[0] as any).label, 'L:2026-09-26');
});

test('구분선 — 첫 그룹에 항상 삽입(세션 진입 시 그날 라벨), 인덱스는 그룹 인덱스+선행 구분선 수', () => {
  const groups = groupByTurn([msg('x', '2026-09-27T00:00:00'), msg('y', '2026-09-28T00:00:00')]);
  const feed = insertDateSeparators(groups, label);
  assert.equal(feed.length, 4);
  const idx = feed.findIndex((it) => !isDateSeparator(it) && it.key === 'y');
  assert.equal(idx, 3); // feed 인덱스 = 그룹 인덱스 + 선행 구분선 수. 딥링크 scrollToIndex는 이 값을 써야 정확
});

test('고정 탭 — 상단 경계 통과 전 없음, 통과 후 최근 것, 다음 접근 시 push-out(≤0), 경계 넘으면 인계', () => {
  const seps = [
    { key: 's1', label: 'A', y: 100, h: 24 },
    { key: 's2', label: 'B', y: 400, h: 24 },
  ];
  assert.equal(computePinnedDate(seps, 50), null);            // 아직 아무 것도 안 지나감
  assert.deepEqual(computePinnedDate(seps, 130), { key: 's1', label: 'A', h: 24, shift: 0 });
  assert.deepEqual(computePinnedDate(seps, 390), { key: 's1', label: 'A', h: 24, shift: -14 }); // next.y-offset-h = 400-390-24 = -14
  assert.deepEqual(computePinnedDate(seps, 370), { key: 's1', label: 'A', h: 24, shift: 0 });   // gap 6 > h? 400-370-24=6>0 → clamp 0
  assert.deepEqual(computePinnedDate(seps, 400), { key: 's2', label: 'B', h: 24, shift: 0 });   // s2 경계 통과 → 인계
  assert.deepEqual(computePinnedDate(seps, 500), { key: 's2', label: 'B', h: 24, shift: 0 });   // s2만 남음
});

test('고정 탭 — 정렬 무관(호출 전 오름차순 보장 가정), 다중 통과 시 가장 최근', () => {
  const seps = [
    { key: 's1', label: 'A', y: 10, h: 20 },
    { key: 's2', label: 'B', y: 60, h: 20 },
    { key: 's3', label: 'C', y: 200, h: 20 },
  ];
  assert.equal(computePinnedDate(seps, 100)!.key, 's2');
});

test('라벨 — 오늘/어제/6일 이내 요일/같은 해 MM.DD/그 외 YY.MM.DD (ko·en)', () => {
  const now = new Date(2026, 8, 29, 15, 0); // 화요일
  const L = { today: '오늘', yesterday: '어제' };
  assert.equal(formatDateSeparator(new Date(2026, 8, 29, 23, 0), 'ko', L, now), '오늘');
  assert.equal(formatDateSeparator(new Date(2026, 8, 28, 1, 0), 'ko', L, now), '어제');
  assert.equal(formatDateSeparator(new Date(2026, 8, 25, 9, 0), 'ko', L, now), '금');       // 4일 전
  assert.equal(formatDateSeparator(new Date(2026, 8, 25, 9, 0), 'en', { today: 'Today', yesterday: 'Yesterday' }, now), 'Fri');
  assert.equal(formatDateSeparator(new Date(2026, 6, 15, 9, 0), 'ko', L, now), '07.15');    // 같은 해
  assert.equal(formatDateSeparator(new Date(2025, 8, 26, 9, 0), 'ko', L, now), '25.09.26'); // 다른 해
  assert.equal(formatDateSeparator(new Date(2026, 6, 15, 9, 0), 'en', L, now), 'Jul 15');
  assert.equal(formatDateSeparator(new Date(2025, 8, 26, 9, 0), 'en', L, now), 'Sep 26, 2025');
});
