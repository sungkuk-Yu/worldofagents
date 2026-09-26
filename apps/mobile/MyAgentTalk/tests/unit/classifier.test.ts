// 다이얼로그 유형 판별기 테스트 (src/neurons/DialogTypeClassifier.ts)
// dialogue-functionality-spec.md §2 — Stage 1 공유 패턴 표(ko+en), Stage 2 서버 위임, Stage 3 폴백
// t_56498848: 패턴 표는 백엔드 dialogPatterns.json과 미러 — drift는 백엔드 dialog-classifier.test.ts가 감시.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyByPattern, classifyDialogType, setClassifyRequest, matchPattern, toDialogType,
} from '../../src/neurons/DialogTypeClassifier';

const hit = (input: string) => classifyByPattern(input)?.type ?? null;

// ── Stage 1 패턴 매칭: 한국어 (회귀 — 기존 케이스 유지) ──────────────
test('패턴 매칭(ko): 데이터(엑셀/표/차트) → data', () => {
  assert.equal(hit('이번 주 매출을 엑셀로 정리해줘'), 'data');
  assert.equal(hit('거래처 표 만들어줘'), 'data');
  assert.equal(hit('차트로 보여줘'), 'data');
  assert.equal(hit('수식 계산해줘'), 'data');
});

test('패턴 매칭(ko): 파일(문서/PDF/첨부) → file', () => {
  assert.equal(hit('계약서 파일 찾아줘'), 'file');
  assert.equal(hit('PDF로 변환해줘'), 'file');
  assert.equal(hit('보고서 첨부해줘'), 'file'); // '첨부' 우선 — '보고서'는 task 키(백엔드 회귀와 정합)
});

test('패턴 매칭(ko): 작업(일정/예약/알림) → task', () => {
  assert.equal(hit('내일 회의 예약해줘'), 'task');
  assert.equal(hit('3시 알림 설정해줘'), 'task');
  assert.equal(hit('캘린더에 일정 추가'), 'task');
});

test('패턴 매칭(ko): 멀티(협업/여러 명) → multi-agent', () => {
  assert.equal(hit('에이전트 초대해서 협업해줘'), 'multi-agent');
  assert.equal(hit('여러 명 붙여서 처리해'), 'multi-agent');
});

test('패턴 매칭(ko): 매칭 없으면 null', () => {
  assert.equal(classifyByPattern('안녕하세요'), null);
  assert.equal(classifyByPattern(''), null);
});

test('패턴 매칭(ko): 오탐 방어 — 목표/발표/표현·파일러는 매칭 안 함', () => {
  assert.equal(hit('연말 목표를 정할까'), null);  // '표' 좌측 한글 경계 차단
  assert.equal(hit('신제품 발표 자료'), null);    // '발표' 차단
  assert.equal(hit('감정 표현이 풍부해'), null);  // '표현' 우측 차단
  assert.equal(hit('거래처 표를 보내줘'), 'data'); // '표'+조사 '를' 허용
  assert.equal(hit('성적표를 확인해'), null);     // '표' 뒤 한글은 조사 아님 → 차단
  assert.equal(hit('파일러는 개발 도구일 뿐이야'), null); // '파일' 부분일치지만 excludes_ko(카드 명시 사례)
  assert.equal(hit('발표 자료의 표를 정리해'), 'data'); // 오탐 위치 뒤에 유효 '표를' 출현
});

// ── Stage 1 패턴 매칭: 영어 (t_56498848 신규) ──────────────────────
test('패턴 매칭(en): data — chart/table/spreadsheet', () => {
  assert.equal(hit('Turn this into a chart'), 'data');
  assert.equal(hit('make a table of the sales data'), 'data');
  assert.equal(hit('Create a spreadsheet for inventory'), 'data');
  assert.equal(hit('Can you analyze this?'), 'data');
});

test('패턴 매칭(en): file — document/PDF/upload', () => {
  assert.equal(hit('open the contract file'), 'file');
  assert.equal(hit('Convert this to PDF'), 'file');
  assert.equal(hit('upload the invoice'), 'file');
});

test('패턴 매칭(en): task — booking/schedule/reminder', () => {
  assert.equal(hit('booking a meeting for tomorrow'), 'task');
  assert.equal(hit('set a reminder for Friday'), 'task');
  assert.equal(hit('check my calendar this week'), 'task');
  assert.equal(hit('that looks book-worthy'), null); // 'book' 단음어는 Stage1 관할 아님(명사 오해) — Stage2 회수
});

test('패턴 매칭(en): multi — collaboration/compare', () => {
  assert.equal(hit('Let the agents collaborate on this'), 'multi-agent');
  assert.equal(hit('compare the two proposals side by side'), 'multi-agent');
});

test('패턴 매칭(en): 단어경계 — substring 오탐 금지', () => {
  assert.equal(hit('this is suitable enough'), null);   // 'suitable' 내 'table' — \b 실패
  assert.equal(hit('this is a notable result'), null); // 'notable' 내 'table' 차단
  assert.equal(hit('remediate the issue'), null);  // 'data' 부분('date' 등) 차단
});

test('혼합 언어 발화 — 영문 키워드 혼입 시에도 판별', () => {
  assert.equal(hit('이거 Excel로 다듬어줘'), 'data');
  assert.equal(hit('Q3 chart 그려줘'), 'data');
});

// ── 헬퍼/타입 매핑 ─────────────────────────────
test('toDialogType: 서버 multi → 프론트 multi-agent', () => {
  assert.equal(toDialogType('multi'), 'multi-agent');
  assert.equal(toDialogType('data'), 'data');
});

test('matchPattern: 서버 규칙과 동일 (ASCII 단어경계, 한글 substring)', () => {
  assert.equal(matchPattern('suitable', 'suitable', 'table'), false);
  assert.equal(matchPattern('a table', 'a table', 'table'), true);
  assert.equal(matchPattern('계약서', '계약서', '계약서'), true);
});

// ── 통합 판별 (Stage 1→2→3 파이프라인) ────────
test('integrated: 패턴 매칭이 adopt 임계 이상으로 즉시 확정', async () => {
  const r = await classifyDialogType('엑셀 데이터 분석해줘');
  assert.equal(r.type, 'data');
  assert.ok(r.confidence >= 0.8);
  assert.equal(r.stage, 1);
});

test('integrated: 영문 패턴도 Stage 1 확정 — 서버 왕복 금지', async () => {
  let serverCalls = 0;
  setClassifyRequest(async () => { serverCalls++; return null; });
  const r = await classifyDialogType('turn the results into a chart');
  assert.equal(r.type, 'data');
  assert.equal(r.stage, 1);
  assert.equal(serverCalls, 0); // Stage 1 확정은 네트워크 호출 없음 (L1 비용 규칙)
});

test('integrated: 미매칭 + 서버 미주입이면 Stage 3 정보형 폴백', async () => {
  setClassifyRequest(null);
  const r = await classifyDialogType('아무말이나');
  assert.equal(r.type, 'information');
  assert.equal(r.stage, 3);
});

test('integrated: 미매칭 + 서버 ≥ adopt면 Stage 2 채택 (history 전달)', async () => {
  const seen: string[] = [];
  setClassifyRequest(async (input, history) => {
    seen.push(input);
    assert.deepEqual(history, ['user: hello', 'assistant: hi']);
    return { type: 'task', confidence: 0.9, stage: 2 };
  });
  const r = await classifyDialogType('handle it for me', ['user: hello', 'assistant: hi']);
  assert.equal(r.type, 'task');
  assert.equal(r.confidence, 0.9);
  assert.equal(r.stage, 2);
  assert.deepEqual(seen, ['handle it for me']);
});

test('integrated: 서버 저신뢰(<adopt)면 Stage 3 확인 신호로', async () => {
  setClassifyRequest(async () => ({ type: 'file', confidence: 0.6, stage: 3 }));
  const r = await classifyDialogType('그냥 그런 생각이 들어');
  assert.equal(r.stage, 3);
  assert.equal(r.type, 'information'); // 저채택 서버 타입은 근거로 쓰지 않는다
  assert.equal(r.confidence, 0.5);
});

test('integrated: 서버 예외는 답변 흐름을 실패시키지 않는다', async () => {
  setClassifyRequest(async () => { throw new Error('offline'); });
  const r = await classifyDialogType('오늘 좀 피곤하다');
  assert.equal(r.type, 'information');
  assert.equal(r.stage, 3);
  setClassifyRequest(null);
});
