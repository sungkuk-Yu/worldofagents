// 다이얼로그 유형 판별기 테스트 (src/neurons/DialogTypeClassifier.ts)
// dialogue-functionality-spec.md §2 — Stage 1 패턴 매칭, Stage 3 폴백
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyByPattern, classifyDialogType } from '../../src/neurons/DialogTypeClassifier';

// ── Stage 1 패턴 매칭 ──────────────────────────
test('패턴 매칭: 데이터(엑셀/표/차트) → data', () => {
  assert.equal(classifyByPattern('이번 주 매출을 엑셀로 정리해줘')?.type, 'data');
  assert.equal(classifyByPattern('거래처 표 만들어줘')?.type, 'data');
  assert.equal(classifyByPattern('차트로 보여줘')?.type, 'data');
  assert.equal(classifyByPattern('수식 계산해줘')?.type, 'data');
});

test('패턴 매칭: 파일(문서/PDF/보고서) → file', () => {
  assert.equal(classifyByPattern('계약서 파일 찾아줘')?.type, 'file');
  assert.equal(classifyByPattern('PDF로 변환해줘')?.type, 'file');
  assert.equal(classifyByPattern('보고서 첨부해줘')?.type, 'file');
});

test('패턴 매칭: 작업(일정/예약/알림) → task', () => {
  assert.equal(classifyByPattern('내일 회의 예약해줘')?.type, 'task');
  assert.equal(classifyByPattern('3시 알림 설정해줘')?.type, 'task');
  assert.equal(classifyByPattern('캘린더에 일정 추가')?.type, 'task');
});

test('패턴 매칭: 멀티(협업/여러 명) → multi-agent', () => {
  assert.equal(classifyByPattern('에이전트 초대해서 협업해줘')?.type, 'multi-agent');
  assert.equal(classifyByPattern('여러 명 붙여서 처리해')?.type, 'multi-agent');
});

test('패턴 매칭: 매칭 없으면 null', () => {
  assert.equal(classifyByPattern('안녕하세요'), null);
  assert.equal(classifyByPattern(''), null);
});

// ── 통합 판별 (Stage 1→2→3 파이프라인) ────────
test('integrated: 패턴 매칭이 85% 신뢰도로 즉시 확정', async () => {
  const r = await classifyDialogType('엑셀 데이터 분석해줘');
  assert.equal(r.type, 'data');
  assert.ok(r.confidence >= 0.8);
  assert.equal(r.stage, 1);
});

test('integrated: 미매칭 입력은 Stage 3 정보형 폴백', async () => {
  const r = await classifyDialogType('아무말이나');
  assert.equal(r.type, 'information');
  assert.equal(r.stage, 3);
});