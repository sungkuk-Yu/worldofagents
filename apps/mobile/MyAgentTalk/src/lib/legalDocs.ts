// 정책 문서 registry — 법률 카드 t_eb7f13e9 (화면/테스트가 읽는 단일 진입점).
// 본문 문자열은 src/lib/legalDocs.generated.ts에 번들 포함됨 (Metro가 ?raw 임포트를 보장하지
// 않아 코드 생성 방식을 택함). 원본: docs/legal/*.md (내변호사 소유, 커밋 b50fd9ff).
// **generated 파일은 직접 편집 금지 — node scripts/sync-legal-docs.cjs 로 재생성.**
import { legalDocsGenerated } from './legalDocs.generated';
import type { LegalDocKind, LegalLocale } from './legalDocLogic';

const DOCS: Record<LegalDocKind, Record<LegalLocale, string>> = legalDocsGenerated;

/** 문서 본문 (md 원문). 없는 조합이면 빈 문자열 — 화면이 실패 상태를 렌더. */
export function legalDocContent(kind: LegalDocKind, locale: LegalLocale): string {
  return DOCS[kind]?.[locale] ?? '';
}

export { localeFromTag, isDraftDoc } from './legalDocLogic';
export type { LegalDocKind, LegalLocale } from './legalDocLogic';
