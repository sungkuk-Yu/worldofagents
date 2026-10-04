// 체인 관리 순수 로직 단위 테스트 (t_00fe9b0f — 포크 모델 + 닫기 계약, 대표님 10/4 중간 지시).
// ① 상태 3색은 실데이터 신호만(pending/confirmed/stalled) — 추측 색상 금지
// ② 닫기 = confirmed 전용, 일괄 닫기 대상 = 초록 미클로즈만
// ③ 아카이브 파싱(오염 → 빈 지도), 'n closed' 재접근(reopen)
// ④ 하드포크 리스트: 같은 에이전트 필터 + 계보 2단계(parent/grand, 3단계는 끊기) + 사이클 방어
// ⑤ 1024 브레이크포인트 개정(t_00fe9b0f) + 1280 컨텍스트 절층
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSideChainCards, canCloseChain, closableConfirmedIds, parseArchiveMap, serializeArchiveMap, buildProjectRows, CHAIN_COLORS } from '../../src/lib/chainLogic';
import { layoutModeForWidth, WIDE_BREAKPOINT, CONTEXT_BREAKPOINT } from '../../src/lib/layout';
import type { ThreadIndexEntry } from '../../src/lib/chatLogic';
import type { TrackerRow } from '../../src/lib/questionTracker';

const H = 60 * 60 * 1000;
const NOWISO = new Date(Date.UTC(2026, 9, 4, 12)).toISOString();
const th = (rootId: string, over: Partial<ThreadIndexEntry> = {}): ThreadIndexEntry =>
  ({ rootId, rootText: `질문 ${rootId}`, rootSeq: 1, replyCount: 1, lastActivity: NOWISO, ended: false, ...over }) as ThreadIndexEntry;
const row = (messageId: string, over: Partial<TrackerRow> = {}): TrackerRow =>
  ({ messageId, text: 't', seq: 1, stage: 3, confirmed: true, failed: false, needsConfirm: false, replyCount: 1, lastActivityMs: Date.parse(NOWISO), ...over }) as TrackerRow;

test('사이드체인 카드 — 상태색 3종은 실데이터 신호만', () => {
  const cards = buildSideChainCards(
    [th('a'), th('b'), th('c'), th('d'), th('e')],
    [row('a'), row('b', { failed: true }), row('c', { needsConfirm: true }), row('d', { stage: 2 }), row('e', { stage: 0 })],
  );
  const by = new Map(cards.map((c) => [c.rootId, c]));
  assert.equal(by.get('a')!.status, 'confirmed');   // 완료 → 초록
  assert.equal(by.get('b')!.status, 'stalled');     // 실패(재시도) → 빨강
  assert.equal(by.get('c')!.status, 'stalled');     // 확인 대기 → 빨강
  assert.equal(by.get('d')!.status, 'pending');     // 답변 준비 중 → 주황
  assert.equal(by.get('e')!.status, 'pending');     // 접수됨(계산 중) → 주황 (색 추측 금지: 진행으로만)
  assert.equal(CHAIN_COLORS.confirmed, '#16A34A');
  assert.equal(CHAIN_COLORS.pending, '#D97706');
  assert.equal(CHAIN_COLORS.stalled, '#DC2626');
});

test('사이드체인 카드 — 행 축약(24h)으로 빠진 종료 스레드는 완료 보전, 미종료는 진행', () => {
  const cards = buildSideChainCards([th('gone', { ended: true }), th('live')], []);
  const by = new Map(cards.map((c) => [c.rootId, c]));
  assert.equal(by.get('gone')!.status, 'confirmed');
  assert.equal(by.get('live')!.status, 'pending');
});

test('닫기 계약 — confirmed 전용 + 일괄 닫기는 초록 미클로즈만', () => {
  const cards = buildSideChainCards([th('ok'), th('busy'), th('halt')], [row('ok'), row('busy', { stage: 2 }), row('halt', { failed: true })]);
  const by = new Map(cards.map((c) => [c.rootId, c]));
  assert.equal(canCloseChain(by.get('ok')!), true);
  assert.equal(canCloseChain(by.get('busy')!), false);
  assert.equal(canCloseChain(by.get('halt')!), false);
  const closed = buildSideChainCards([th('ok')], [row('ok')], new Set(['ok']));
  assert.deepEqual(closableConfirmedIds(closed), [], '이미 닫힌 초록은 일괄 대상 재차 제외');
  assert.deepEqual(closableConfirmedIds(cards), ['ok']);
});

test('아카이브는 물리 삭제 없음 — closed=true로만 접히고 reopen으로 복귀', () => {
  const open = buildSideChainCards([th('a')], [row('a')]);
  const shut = buildSideChainCards([th('a')], [row('a')], new Set(['a']));
  assert.equal(open[0].closed, false);
  assert.equal(shut[0].closed, true);
  assert.equal(shut[0].rootId, open[0].rootId); // 동일 데이터 유지(접기만)
});

test('아카이브 직렬화 — 오염 입력은 빈 지도, 정상 왕복 보존', () => {
  assert.deepEqual(parseArchiveMap(null), {});
  assert.deepEqual(parseArchiveMap('{'), {});
  assert.deepEqual(parseArchiveMap('[1,2]'), {});
  assert.deepEqual(parseArchiveMap('{"a": 1}'), {}); // 값이 문자열 아닌 항목 버림
  const map = { a: NOWISO, b: NOWISO };
  assert.deepEqual(parseArchiveMap(serializeArchiveMap(map)), map);
});

test('하드포크 리스트 — 같은 에이전트만 + 계보 2단계 + 현재 포함·최근활동순', () => {
  const sessions = [
    { id: 'root1', title: '원본', agent_id: 'kim', last_activity_at: '2026-10-01T00:00:00Z', forked_from: undefined },
    { id: 'f1', title: '프로젝트A', agent_id: 'kim', last_activity_at: '2026-10-03T00:00:00Z', forked_from: { session_id: 'root1', turn_index: 12, forked_at: '2026-10-02T00:00:00Z' } },
    { id: 'f2', title: '프로젝트B', agent_id: 'kim', last_activity_at: '2026-10-04T00:00:00Z', forked_from: { session_id: 'f1', turn_index: 30, forked_at: '2026-10-03T00:00:00Z' } },
    { id: 'other', title: '다른방', agent_id: 'ceo', last_activity_at: '2026-10-05T00:00:00Z' },
    { id: 'ghost', title: '고아', agent_id: 'kim', last_activity_at: '2026-10-06T00:00:00Z', forked_from: { session_id: 'missing-ref' } },
  ];
  const rows = buildProjectRows(sessions, 'root1', 'kim');
  assert.deepEqual(rows.map((r) => r.id), ['ghost', 'f2', 'f1', 'root1'], '최근 활동순, 다른 에이전트 제외');
  assert.equal(rows[3].isCurrent, true);
  const f2 = rows.find((r) => r.id === 'f2')!;
  assert.equal(f2.parentTitle, '프로젝트A');
  assert.equal(f2.grandTitle, '원본'); // 2단계까지
  assert.equal(f2.height, 30);
  const f1 = rows.find((r) => r.id === 'f1')!;
  assert.equal(f1.parentTitle, '원본');
  assert.equal(f1.grandTitle, undefined); // 원본은 포크 아님
  const ghost = rows.find((r) => r.id === 'ghost')!;
  assert.equal(ghost.parentTitle, undefined, '미소속 참조는 조용히 끊기');
});

test('하드포크 리스트 — 계보 사이클 방어(A→B→A)', () => {
  const sessions = [
    { id: 'a', title: 'A', agent_id: 'k', forked_from: { session_id: 'b' } },
    { id: 'b', title: 'B', agent_id: 'k', forked_from: { session_id: 'a' } },
  ];
  const rows = buildProjectRows(sessions, 'a', 'k');
  const ra = rows.find((r) => r.id === 'a')!;
  assert.equal(ra.parentTitle, 'B');
  assert.equal(ra.grandTitle, 'A'); // 재방문도 무한루프 없이 2단계에서 멈춤
});

test('3-팬 브레이크포인트 개정 — 1024부터 wide(pc-wide), 1280 컨텍스트 절층은 순수함수 밖', () => {
  assert.equal(WIDE_BREAKPOINT, 1024);
  assert.equal(CONTEXT_BREAKPOINT, 1280);
  assert.equal(layoutModeForWidth(1023), 'pc');
  assert.equal(layoutModeForWidth(1024), 'pc-wide');
  assert.equal(layoutModeForWidth(1440), 'pc-wide');
});
