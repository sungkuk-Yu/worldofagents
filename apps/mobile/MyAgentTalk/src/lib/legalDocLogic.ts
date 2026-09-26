// 정책 문서 헬퍼 — t_eb7f13e9. 로케일/초안 판정 로직. 단위테스트(tsconfig.test.json) 대상.
// 본문 텍스트는 legalDocs.generated.ts(Metro가 ?raw 임포트를 보장하지 않아 코드 생성으로 번들
// 포함 — 원본 docs/legal/*.md는 scripts/sync-legal-docs.cjs 로 동기화, 직접 편집 금지).
// 렌더 sanitize는 MarkdownView(html:false) 소유 — 이 레이어는 텍스트/메타 제공만.

export type LegalDocKind = 'terms' | 'privacy';
export type LegalLocale = 'ko' | 'en';

/** 브라우저/OS 언어 태그 → 앱 로케일 (ko 접두 아니면 en — language.resolveLanguage과 동일 폴백 방향). */
export function localeFromTag(tag: string | undefined | null): LegalLocale {
  return (tag ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/**
 * 초안(DRAFT) 배지 표시 여부 — 원문 첫 600자 내 'DRAFT' 표기 검사.
 * 내변호사가 문서를 확정하면(초안 헤더 제거) 배지가 자동으로 사라진다 — 프론트 하드코딩 금지.
 */
export function isDraftDoc(content: string): boolean {
  return content.slice(0, 600).includes('DRAFT');
}
