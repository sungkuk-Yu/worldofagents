export type LanguagePreference = 'system' | 'ko' | 'en';
export function resolveLanguage(code?: string | null): 'ko' | 'en' {
  return !code || code.toLowerCase().split(/[-_]/)[0] === 'ko' ? 'ko' : 'en';
}
