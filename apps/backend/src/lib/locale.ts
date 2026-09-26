import { config } from '../config';
import type { NeuronStage } from '../types/db';

export type Locale = 'ko' | 'en';

/** 우선순위 재정렬 없이 첫 언어 태그만 사용한다. 미지원/빈 헤더는 설정 기본값이다. */
export function parseAcceptLanguage(header?: string | string[], fallback: Locale = config.defaultLocale): Locale {
  const tag = (Array.isArray(header) ? header[0] : header)?.split(',')[0].split(';')[0].trim().toLowerCase();
  if (tag && /^(ko|en)(-[a-z0-9]{1,8})*$/.test(tag)) return tag.split('-')[0] as Locale;
  return fallback;
}

/** WS 명시 로케일 > 연결 헤더 > 기본값. subscribe 생략 시에는 연결 값을 유지한다. */
export function resolveLocale(value: unknown, header?: string | string[]): Locale {
  return value === 'ko' || value === 'en' ? value : parseAcceptLanguage(header);
}

export function appendLanguageInstruction(prompt: string, locale: Locale): string {
  return `${prompt}\nRespond in ${locale === 'ko' ? '한국어' : 'English'}.`;
}

/** 화면 번역은 프론트 i18n이 담당하며 quip은 표시용 폴백이다. */
export const QUIPS: Record<NeuronStage | 'started', Record<Locale, string>> = {
  started: { ko: '접수했어요. 바로 살펴볼게요', en: "Got it. I'll take a look." },
  thinking: { ko: '잠깐만요, 생각해볼게요…', en: 'Let me think…' },
  organizing: { ko: '답변을 정리하고 있어요', en: 'Organizing the answer' },
  finalizing: { ko: '거의 다 됐어요', en: 'Almost ready' },
  rendering: { ko: '표현을 다듬고 있어요', en: 'Refining the presentation' },
};
