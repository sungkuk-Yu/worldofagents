// t_e9480e0f 백로그① — 채팅 마크다운 게이트·스트리밍 안전화 단위 검증.
// 회귀 금지 조항의 근거: 마크다운 미사용 답변은 gate=false → RichText 기존 경로 100% 유지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeChatMarkdown, hasOpenFence, stabilizeStreamingMarkdown } from '../../src/lib/chatMarkdown';

test('게이트: 평문·줄바꿈만 = false (RichText 경로 유지)', () => {
  assert.equal(looksLikeChatMarkdown('계약서를 검토해 봤어요. 다음 사항을 확인하세요.'), false);
  assert.equal(looksLikeChatMarkdown('첫 줄\n둘째 줄\n\n새 문단'), false);
  assert.equal(looksLikeChatMarkdown(''), false);
  assert.equal(looksLikeChatMarkdown(null), false);
  assert.equal(looksLikeChatMarkdown(undefined), false);
});

test('게이트: RichText가 이미 그리는 기능만 있으면 false (회귀 금지)', () => {
  // 마크다운 링크 / 인라인 코드 / 인용 / 코드블록 / 자동 URL — RichText 파서 소유, 마크다운 렌더러 불요
  assert.equal(looksLikeChatMarkdown('문의는 [여기](https://example.test/contact) 해주세요'), false);
  assert.equal(looksLikeChatMarkdown('설치는 `npm i` 로 done'), false);
  assert.equal(looksLikeChatMarkdown('> 인용 문장 테스트'), false);
  assert.equal(looksLikeChatMarkdown('```js\nconst a = 1;\n```'), false);
  assert.equal(looksLikeChatMarkdown('https://a.test/x 링크 자동감지'), false);
});

test('게이트: RichText가 못 그리는 블록 문법 = true', () => {
  assert.equal(looksLikeChatMarkdown('## 요약\n본문'), true);            // 헤딩
  assert.equal(looksLikeChatMarkdown('- 첫 항목\n- 둘째 항목'), true);    // 비순서 목록
  assert.equal(looksLikeChatMarkdown('* 별표 목록'), true);
  assert.equal(looksLikeChatMarkdown('1. 단계 하나\n2. 단계 둘'), true); // 순서 목록
  assert.equal(looksLikeChatMarkdown('중요: **약한 지점** 입니다'), true); // 볼드
  assert.equal(looksLikeChatMarkdown('위 요약\n---\n아래 본문'), true);   // hr
  assert.equal(looksLikeChatMarkdown('| 항목 | 금액 |\n|---|---|\n| A | 100 |'), true); // 표
});

test('게이트: 오탐 억제 — 헤딩/목록 모양의 평문', () => {
  assert.equal(looksLikeChatMarkdown('#해시태그 붙임'), false);   // 공백 없는 #은 헤딩 아님
  assert.equal(looksLikeChatMarkdown('-연결음 하이픈'), false);   // '-x' 붙은 단어는 목록 아님
  assert.equal(looksLikeChatMarkdown('1.5배율로 확대'), false);   // '1.5'는 순서 목록 아님 (공백 필수)
  assert.equal(looksLikeChatMarkdown('a - b - c 인라인'), false); // 행 시작 아님
});

test('open fence 판정', () => {
  assert.equal(hasOpenFence('```js\ncode\n```'), false);  // 닫힘
  assert.equal(hasOpenFence('```js\ncode'), true);         // 열림
  assert.equal(hasOpenFence('앞\n```\n코드\n```\n뒤'), false);
  assert.equal(hasOpenFence('인라인 `x` 와 본문'), false);  // 줄 시작 ``` 아님
});

test('스트리밍 안전화: 미닫힌 fence = 임시 마감 append, 닫힌 텍스트 무손상', () => {
  const partial = '설명\n```python\ndef f():';
  assert.ok(stabilizeStreamingMarkdown(partial).endsWith('\n```'), '미닫힌 fence 즉시 마감 부여');
  assert.equal(stabilizeStreamingMarkdown('```js\nconst a = 1;\n```'), '```js\nconst a = 1;\n```'); // 닫힘 그대로
  assert.equal(stabilizeStreamingMarkdown('평문 답변'), '평문 답변');
});

test('스트리밍 안전화: 미완 백틱 줄(1~2개) 잘라내기 — fence 토글 오집행 방지', () => {
  assert.equal(stabilizeStreamingMarkdown('코드 시작\n``'), '코드 시작');
  assert.equal(stabilizeStreamingMarkdown('``'), '');
  // 열린 fence 뒤 미완 백틱 줄: 잘라내고 임시 마감
  assert.equal(stabilizeStreamingMarkdown('```js\n``'), '```js\n```');
  // 인라인 `code` 열림 백틱(같은 줄 다른 문자 공존)은 보호
  assert.equal(stabilizeStreamingMarkdown('인라인 `code` 진행중'), '인라인 `code` 진행중');
});
