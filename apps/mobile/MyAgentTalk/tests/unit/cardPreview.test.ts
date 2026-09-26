// 카드 미리보기 추출 함수 단위 테스트 — 대표님 지시 #51 검증 요구
// (payload 종류별 미리보기 추출 함수 + 폴백 렌더 규칙)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCardPreview, LONG_TEXT_THRESHOLD, PREVIEW_ROWS } from '../../src/cards/preview';
import { expandStore } from '../../src/cards/expandStore';

test('info_card — 제목 + 첫 필드 한 줄 요약, 필드 2개 이상이면 펼침 가능', () => {
  const p1 = buildCardPreview('info_card', { title: '계약 검토', fields: [{ label: '기한', value: '2026-10-01' }] }, '', true);
  assert.equal(p1.title, '계약 검토');
  assert.equal(p1.summary, '기한: 2026-10-01');
  assert.equal(p1.expandable, false); // 필드 1개는 접어도 전부 보임
  const p2 = buildCardPreview('info_card', { fields: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }] }, '', true);
  assert.equal(p2.expandable, true);
});

test('spreadsheet — 첫 N행 미리보기 + "N행 더" 카운트', () => {
  const rows = [['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'], ['e', '5']];
  const p = buildCardPreview('spreadsheet', { columns: ['Key', 'Val'], rows }, '', true);
  assert.equal(p.moreCount, rows.length - PREVIEW_ROWS);
  assert.equal(p.expandable, true);
  assert.ok(p.summary.includes('a · 1'));
  // 2행 이하는 moreCount 0 — 핸들 생략 가능(제목 없으면)
  const small = buildCardPreview('spreadsheet', { columns: ['c'], rows: [[1]] }, '', true);
  assert.equal(small.moreCount, 0);
  assert.equal(small.expandable, false);
});

test('file — 파일명 + 종류/크기 요약', () => {
  const p = buildCardPreview('file', { name: 'report.pdf', mime_type: 'application/pdf', size: '1024' }, '', true);
  assert.equal(p.title, 'report.pdf');
  assert.equal(p.summary, 'application/pdf · 1024');
  assert.equal(p.expandable, false); // url이 없으면 펼칠 추가 정보 없음
  const withUrl = buildCardPreview('file', { name: 'r.pdf', url: 'https://example.test/r.pdf' }, '', true);
  assert.equal(withUrl.expandable, true);
});

test('task_flow — 작업명 + 완료 배지(N/M) + "N항목 더"', () => {
  const items = [
    { title: '초안 검토', status: 'completed' },
    { title: '날인 확인', status: 'pending' },
    { title: '등기 접수', status: 'pending' },
  ];
  const p = buildCardPreview('task_flow', { items }, '', true);
  assert.equal(p.title, '초안 검토');
  assert.equal(p.badge, '1/3');
  assert.equal(p.moreCount, 2);
  assert.equal(p.expandable, true);
});

test('multi_agent — 참여 에이전트 나열 + 첫 결과 요약', () => {
  const agents = [
    { name: '내 변호사', content: '검토 완료 — 리스크 없음' },
    { name: '내 회계사', content: '세무 확인 중' },
  ];
  const p = buildCardPreview('multi_agent', { agents }, '', true);
  assert.equal(p.title, '내 변호사, 내 회계사');
  assert.equal(p.summary, '검토 완료 — 리스크 없음');
  assert.equal(p.moreCount, 1);
  assert.equal(p.expandable, true);
});

test('text — 짧은 콘텐츠는 펼침 핸들 생략, 장문만 펼침 가능 (#51 규칙 4)', () => {
  const short = buildCardPreview('text', undefined, '안녕하세요!', true);
  assert.equal(short.expandable, false);
  const long = buildCardPreview('text', undefined, '가'.repeat(LONG_TEXT_THRESHOLD + 1), true);
  assert.equal(long.expandable, true);
  assert.ok(long.summary.length < LONG_TEXT_THRESHOLD + 1); // 요약은 잘림
});

test('미등록 dialogue_type 폴백 — 제목+요약으로 기본 렌더, 깨지지 않음 (#51 핵심 유연성)', () => {
  const p = buildCardPreview('future_card', { title: '새 형식', detail: { a: 1 } }, '원문', false);
  assert.equal(p.unknownType, true);
  assert.equal(p.title, '새 형식');
  assert.equal(p.expandable, true); // payload가 있으면 펼침 가능
  // payload 없는 미등록도 콘텐츠 기반으로 동작
  const bare = buildCardPreview('future_card', undefined, '짧은 원문', false);
  assert.equal(bare.unknownType, true);
  assert.equal(bare.summary, '짧은 원문');
  assert.equal(bare.expandable, false);
});

test('악성 payload 방어 — 배열/문자열/null이 와도 예외 없이 CardPreview 반환', () => {
  for (const bad of [null, undefined, 'str', 42, [], ['a'], { fields: 'bad' }, { rows: { a: 1 } }]) {
    const p = buildCardPreview('info_card', bad as never, '', true);
    assert.equal(typeof p.title, 'string');
    assert.equal(typeof p.expandable, 'boolean');
  }
});

test('expandStore — 카드별 독립 상태, 구독 알림, 토글/clear', () => {
  expandStore.clear();
  let notified = 0;
  const unsub = expandStore.subscribe(() => { notified++; });
  assert.equal(expandStore.get('a'), false);
  expandStore.set('a', true);
  assert.equal(expandStore.get('a'), true);
  assert.equal(expandStore.get('b'), false); // 독립 — 아코디언 아님 (#51 규칙 6)
  expandStore.toggle('b');
  assert.equal(expandStore.get('b'), true);
  assert.equal(expandStore.get('a'), true); // b를 열어도 a는 유지
  expandStore.toggle('a');
  assert.equal(expandStore.get('a'), false);
  assert.ok(notified >= 3);
  unsub();
  const before = notified;
  expandStore.set('a', true);
  assert.equal(notified, before); // 해지된 구독자는 알림 없음
  expandStore.clear();
  assert.equal(expandStore.get('a'), false);
});
