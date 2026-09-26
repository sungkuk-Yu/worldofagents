// 법률 컴플라이언스 UI 단위 테스트 — t_eb7f13e9
// ① 정책 문서 레지스트리: 4종 본문 존재 + 원본(docs/legal)과 무결성 + DRAFT 표기 유지
// ② 로케일/초안 판정 헬퍼
// ③ §5.3 금지 마케팅 문구 스캐너 (i18n 카피 회귀 방지)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { legalDocContent } from '../../src/lib/legalDocs';
import { isDraftDoc, localeFromTag, type LegalDocKind, type LegalLocale } from '../../src/lib/legalDocLogic';

const KINDS: LegalDocKind[] = ['terms', 'privacy'];
const LOCALES: LegalLocale[] = ['ko', 'en'];
// 원본 위치는 런타임 cwd에 의존하지 않도록 __dirname에서 상방 탐색 (dist-test-unit/tests/unit → 레포 루트).
function findLegalDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, 'docs', 'legal');
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, '..');
  }
  throw new Error('docs/legal 디렉터리를 찾지 못함');
}
const LEGAL_DIR = findLegalDir();
const SOURCE_FILES: Record<LegalDocKind, Record<LegalLocale, string>> = {
  terms: { ko: 'terms-of-service-ko.md', en: 'terms-of-service-en.md' },
  privacy: { ko: 'privacy-policy-ko.md', en: 'privacy-policy-en.md' },
};

test('정책 문서 — 4종 본문이 모두 로드된다', () => {
  for (const kind of KINDS) for (const locale of LOCALES) {
    const content = legalDocContent(kind, locale);
    assert.ok(content.length > 1000, `${kind}-${locale} 본문이 비었거나 잘림 (${content.length}자)`);
  }
  assert.equal(legalDocContent('terms', 'xx' as LegalLocale), ''); // 없는 로케일 → 빈 문자열(화면 폴백)
});

test('정책 문서 — 생성본이 원본 docs/legal과 문자 단위로 일치한다 (드리프트 = 법무 검증 무효화 방지)', () => {
  for (const kind of KINDS) for (const locale of LOCALES) {
    const source = readFileSync(join(LEGAL_DIR, SOURCE_FILES[kind][locale]), 'utf8');
    assert.equal(legalDocContent(kind, locale), source,
      `${kind}-${locale}: generated와 원본 불일치 — node scripts/sync-legal-docs.cjs 재생성 필요`);
  }
});

test('정책 문서 — DRAFT·플레이스홀더 고지가 초안에 유지된다 (코멘트 #38: 출시 전 삭제 금지)', () => {
  for (const kind of KINDS) for (const locale of LOCALES) {
    const content = legalDocContent(kind, locale);
    assert.ok(isDraftDoc(content), `${kind}-${locale} 초안 표기(DRAFT) 검출 실패`);
    assert.match(content, /대표님 확정 필요|CEO confirmation|\[.*confirm/i, `${kind}-${locale} 확정 플레이스홀더 소실`);
  }
});

test('로케일 판정 — ko 접두만 ko, 나머지는 en 폴백', () => {
  assert.equal(localeFromTag('ko'), 'ko');
  assert.equal(localeFromTag('ko-KR'), 'ko');
  assert.equal(localeFromTag('EN'), 'en');
  assert.equal(localeFromTag(undefined), 'en');
  assert.equal(localeFromTag(null), 'en');
});

test('초안 판정 — 본문 앞부분 DRAFT만 보고, 긴 본문 뒤의 우연한 일치와 무관', () => {
  assert.ok(isDraftDoc('# 약관\n> ⚠️ 초안(DRAFT) — 미발효\n' + 'x'.repeat(10000)));
  assert.ok(!isDraftDoc('# 약관\n시행 문서\n' + 'y'.repeat(10000) + 'DRAFT'));
  assert.ok(!isDraftDoc(''));
});

// §5.3 금지 문구 회귀 스캔 — 앱 카피(i18n)에 기만적 마케팅 주장이 들어오면 빌드 단계에서 잡는다.
// 금지 기준: docs/legal/mvp-legal-review.md §5.3 (변호사급/CPA급/AI 변호사/사람과 구분 불가/승소 보장 류).
test('카피 컴플라이언스 — i18n 문자열에 §5.3 금지 마케팅 문구가 없다', () => {
  const forbidden = [
    /변호사급|CPA급|公認会計士級/, /AI\s*(변호사|lawyer)/i, /robot\s*lawyer/i,
    /구분\s*(불가|안\s*됨|되지\s*않)|구별\s*불가|indistinguishable\s*from\s*(a\s*)?human/i,
    /사람과\s*(구분|구별)\s*못/i, /튜링\s*테스트|turing\s*test/i,
    /사람보다\s*(정확|나은|잘)/, /승소\s*보장|이기는\s*방법/,
  ];
  for (const file of ['src/i18n/locales/ko.json', 'src/i18n/locales/en.json']) {
    const text = readFileSync(file, 'utf8');
    for (const rx of forbidden) assert.ok(!rx.test(text), `${file} 금지 문구 검출: ${rx}`);
  }
});
