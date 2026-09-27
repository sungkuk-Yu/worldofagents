// 리더/펼침 기본화 순수 로직 단위 테스트 (t_3116c5bc)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONE_SCREEN_PX, READER_LINE_HEIGHT, guessLong, resolveExpanded, joinNumericUnits, buildReaderBlocks } from '../../src/lib/readerLogic';
import type { ChatMessage } from '../../src/types';

const msg = (over: Partial<ChatMessage>): ChatMessage => ({ id: 'm', role: 'agent', content: '', turnIndex: 0, ...over });

test('resolveExpanded — 선택 우선 / auto=기본 펼침, 실측>1200px만 접힘', () => {
  assert.equal(resolveExpanded(undefined, 0, false), true, 'short+auto → 펼침(기본)');
  assert.equal(resolveExpanded(undefined, 0, true), false, 'guessLong+auto → 접힘');
  assert.equal(resolveExpanded(undefined, 1300, false), false, '실측 1200 초과 → 접힘');
  assert.equal(resolveExpanded(undefined, 1100, true), true, '실측이 추정보다 정확 — 1200 이하 → 펼침');
  assert.equal(resolveExpanded(true, 5000, true), true, '사용자 펼침 선택은 어떤 실측보다 우선');
  assert.equal(resolveExpanded(false, 10, false), false, '사용자 접힘 선택 유지');
});

test('guessLong — 짧은 본문·작은 표는 false, 장문/대형 표만 true (오탐 보수적)', () => {
  assert.equal(guessLong(msg({ content: '짧은 답' })), false);
  assert.equal(guessLong(msg({ content: '가'.repeat(701) })), true);
  assert.equal(guessLong(msg({ content: '', payload: { columns: ['a', 'b'], rows: Array.from({ length: 12 }, () => ['1', '2']) } })), false, '12행 표는 아직 추정 접힘 아님');
  assert.equal(guessLong(msg({ content: '', payload: { rows: Array.from({ length: 15 }, () => ['x']) } })), true, '15행 → 초과 추정');
});

test('joinNumericUnits — 숫자와 단위(만원/%) 사이 공백을 NBSP로 붙인다', () => {
  assert.equal(joinNumericUnits('총 1200 만원이 필요합니다'), '총 1200\u00A0만원이 필요합니다');
  assert.equal(joinNumericUnits('승률 65 % 유지'), '승률 65\u00A0% 유지');
  assert.equal(joinNumericUnits('가격은 3,200 원 입니다'), '가격은 3,200\u00A0원 입니다');
  assert.equal(joinNumericUnits('2026 년'), '2026\u00A0년');
  assert.equal(joinNumericUnits('일반 문장입니다'), '일반 문장입니다', '숫자 없으면 무변환');
});

test('블로그 가독 토큰 — 행간 1.6 (16px→26) / 기준선 1200px', () => {
  assert.equal(ONE_SCREEN_PX, 1200);
  assert.equal(READER_LINE_HEIGHT, 26);
});

test('buildReaderBlocks — spreadsheet=표 블록, info_card=라벨:값 목록, task_flow=체크 항목', () => {
  const table = buildReaderBlocks(msg({ dialogueType: 'spreadsheet', content: '매출 표', payload: { columns: [{ key: 'm', title: '월' }, '금액'], rows: [['1월', 1200], ['2월', 1500]] } }));
  assert.equal(table[0].kind, 'table');
  const t0 = table[0] as { head: string[]; rows: string[][] };
  assert.deepEqual(t0.head, ['월', '금액']);
  assert.deepEqual(t0.rows[0], ['1월', '1200']);
  assert.equal(table[1].kind, 'para', 'content 문단 뒤에 흐름');

  const info = buildReaderBlocks(msg({ dialogueType: 'info_card', payload: { fields: [{ label: '기한', value: '10-01' }, { label: '처', value: '김비서' }] } }));
  assert.equal(info[0].kind, 'list');
  const l0 = info[0] as { items: { text: string }[] };
  assert.equal(l0.items[0].text, '기한: 10-01');

  const task = buildReaderBlocks(msg({ dialogueType: 'task_flow', payload: { items: [{ title: '검토', status: 'completed' }, { title: '날인', status: 'pending' }] } }));
  const tl = task[0] as { items: { done?: boolean }[] };
  assert.equal(tl.items[0].done, true);
  assert.equal(tl.items[1].done, false);

  const multi = buildReaderBlocks(msg({ dialogueType: 'multi_agent', payload: { agents: [{ name: '전문가A', content: '의견입니다' }] } }));
  assert.equal((multi[0] as { text: string }).text, '전문가A — 의견입니다');

  const plain = buildReaderBlocks(msg({ content: '첫 문단\n\n둘째 문단' }));
  assert.deepEqual(plain.map((b) => b.kind), ['para', 'para'], '빈 줄로 문단 분리(블로그 호흡)');
  assert.equal(plain.length, 2);
});
