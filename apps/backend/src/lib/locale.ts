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

/**
 * 처리 중 한 줄(quip). 화면 번역은 프론트 i18n이 담당하고 quip은 표시용 폴백이다.
 * 대표님 지시(t_b2b86cd6): 영문 코드 단어·기술 용어("처리 중" 등)를 노출하지 않고,
 * 실제로 무언가 하는 사람 같은 1인칭 문구만 쓴다. stage 코드는 WS 계약상 그대로 유지.
 */
export type QuipTone = 'warm' | 'brisk' | 'playful';
export type QuipKey = 'started' | 'thinking' | 'organizing' | 'finalizing' | 'rendering' | 'patience_check' | 'patience_nearly';

export const QUIPS: Record<QuipKey, Record<QuipTone, Record<Locale, string>>> = {
  started: {
    warm: { ko: '네, 제가 꼼꼼히 봐드릴게요', en: "Got it — I'll look this over carefully." },
    brisk: { ko: '확인했습니다. 바로 봅니다', en: 'Understood. On it.' },
    playful: { ko: '오, 이거 재밌겠는데요', en: 'Ooh, this looks fun.' },
  },
  thinking: {
    warm: { ko: '잠깐, 관련 사례 좀 뒤져볼게요', en: 'Let me dig through a few precedents…' },
    brisk: { ko: '자료 먼저 훑고 있습니다', en: 'Skimming the key sources first.' },
    playful: { ko: '음… 두세 군데 좀 파볼게요', en: 'Let me poke around a couple of places…' },
  },
  organizing: {
    warm: { ko: '지금 동료한테 확인 중이에요', en: 'Double-checking with a colleague…' },
    brisk: { ko: '요약 만들기 위해 정리 중입니다', en: 'Summarizing the findings now.' },
    playful: { ko: '주섬주섬 모아보고 있어요', en: 'Gathering things up…' },
  },
  finalizing: {
    warm: { ko: '거의 다 됐어요, 마지막 점검 중이에요', en: 'Nearly there — one last look-over.' },
    brisk: { ko: '마무리 단계입니다', en: 'Wrapping up now.' },
    playful: { ko: '거의 다 됐어요, 숨 좀 고르고', en: 'Almost done — catching my breath.' },
  },
  rendering: {
    warm: { ko: '읽기 좋게 다듬어 정리해드리고 있어요', en: 'Putting it in writing, nice and readable…' },
    brisk: { ko: '표로 보기 좋게 정리하고 있습니다', en: 'Turning it into a clean table.' },
    playful: { ko: '예쁘게 포장 중이에요 🎁', en: 'Adding a bow on top 🎁' },
  },
  patience_check: {
    warm: { ko: '이제 모은 걸로 결론 만들고 있어요', en: 'Still on it — pulling the pieces together now.' },
    brisk: { ko: '마지막 몇 가지 확인하고 있습니다', en: 'Checking the last few points — nearly done.' },
    playful: { ko: '커피 한 잔 정도만요, 금방 끝내요', en: 'Just a coffee-break longer, promise.' },
  },
  patience_nearly: {
    warm: { ko: '거의 다 됐어요, 조금만 더 기다려 주세요', en: 'Almost ready, thanks for bearing with me.' },
    brisk: { ko: '곧 끝납니다, 잠깐만 주세요', en: 'Moments away. Stay with me.' },
    playful: { ko: '다 됐어요! 최종 문장만 남았어요', en: "Done, done! Last sentence and it's yours." },
  },
};

/** persona 토대에서 quip 톤을 고른다. tone_config.quip_tone 명시 값이 우선. */
export function resolveQuipTone(tone?: Record<string, unknown> | null): QuipTone {
  const explicit = tone?.quip_tone;
  if (explicit === 'warm' || explicit === 'brisk' || explicit === 'playful') return explicit;
  const formality = tone?.formality;
  if (formality === 'formal') return 'brisk';
  if (formality === 'casual') return 'playful';
  return 'warm';
}

export function pickQuip(key: QuipKey, locale: Locale, tone?: Record<string, unknown> | null): string {
  return QUIPS[key][resolveQuipTone(tone)][locale];
}

/** 지연이 길 때 순서대로 이어 붙이는 단계 진행도 (>patienceMs 뒤 1회, 이후 step마다). */
export const PATIENCE_PLAN: { stage: NeuronStage; key: QuipKey }[] = [
  { stage: 'organizing', key: 'patience_check' },
  { stage: 'finalizing', key: 'patience_nearly' },
];

export function patienceQuipAt(tick: number): { stage: NeuronStage; quip: QuipKey } | undefined {
  const step = PATIENCE_PLAN[tick];
  return step ? { stage: step.stage, quip: step.key } : undefined;
}
