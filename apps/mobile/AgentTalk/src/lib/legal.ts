import ko from '../i18n/locales/ko.json';
import en from '../i18n/locales/en.json';
// 서버 계약의 면책 문구와 기존 클라이언트 문구를 양쪽 언어로 확인한다.
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const disclaimers = [ko.legal, en.legal].flatMap((locale) => Object.values(locale).map(normalize));
export function needsClientDisclaimer(presetCategory: string | undefined, content: string): boolean {
  const category = presetCategory?.trim().toLowerCase();
  if (category !== 'legal' && category !== 'accounting') return false;
  const normalized = normalize(content);
  return !disclaimers.some((disclaimer) => normalized.includes(disclaimer));
}
