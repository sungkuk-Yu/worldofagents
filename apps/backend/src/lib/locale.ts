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
/** 캐릭터 전용 풀 키(t_80f0d396): tone_config.quip_tone에 문자열로 지정한다. */
export type QuipCharacter = 'noir' | 'adjutant' | 'sf';
export type QuipKey = 'started' | 'thinking' | 'organizing' | 'finalizing' | 'rendering' | 'patience_check' | 'patience_nearly';

export const QUIPS: Record<QuipKey, Record<QuipTone, Record<Locale, string>>> = {
  started: {
    // 대표님 접수 문구 "네, 제가 꼼꼼히 봐드릴게요"는 변호사(noir) 전용으로 이동 (t_80f0d396).
    warm: { ko: '네, 제가 한번 살필게요', en: 'Noted — I will take a careful look.' },
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

/** persona 토대에서 quip 톤/캐릭터를 고른다. tone_config.quip_tone 명시 값이 우선. */
export function resolveQuipTone(tone?: Record<string, unknown> | null): QuipTone | QuipCharacter {
  const explicit = tone?.quip_tone;
  if (explicit === 'warm' || explicit === 'brisk' || explicit === 'playful') return explicit;
  if (explicit === 'noir' || explicit === 'adjutant' || explicit === 'sf') return explicit;
  const formality = tone?.formality;
  if (formality === 'formal') return 'brisk';
  if (formality === 'casual') return 'playful';
  return 'warm';
}

/**
 * 캐릭터 전용 quip 풀 (t_80f0d396): 대표님 지정 3캐릭터.
 * tone_config.quip_tone에 'noir'|'adjutant'|'sf'를 넣으면 이 풀을 쓴다.
 * 공용 3톤 포함 전체 문자열 중복 0건이 수용 기준 (tests/unit/quip.test.ts).
 */
export const CHARACTER_QUIPS: Record<QuipCharacter, Record<QuipKey, Record<Locale, string>>> = {
  // 내 변호사 — 탐정 누아르 톤. "네, 제가 꼼꼼히 봐드릴게요"는 기존 공용 문구를 이관(현행 유지).
  noir: {
    started: { ko: '현장에 나가볼게요, 잠깐만요', en: 'Heading to the scene — give me a moment.' },
    thinking: { ko: '단서가 두 개 나왔습니다, 더 캘까요', en: 'Two leads so far. Want me to keep digging?' },
    organizing: { ko: '증거는 모았어요, 정리해서 가져올게요', en: 'Evidence is in. I am building the case file.' },
    finalizing: { ko: '이 사건 생각보다 복잡하네요, 좀 더 봐야돼요', en: 'This case runs deeper than it looks — a little more time.' },
    rendering: { ko: '조서로 남길 수 있게 문서로 정리할게요', en: 'Writing it all up into a clean report.' },
    patience_check: { ko: '네, 제가 꼼꼼히 봐드릴게요', en: "Leave it to me — I'll look this over carefully." },
    patience_nearly: { ko: '핵심 단서는 잡았어요, 바로 마무리합니다', en: 'Got the key clue. Closing the case now.' },
  },
  // 내 보좌관 — 한국 영화 친근 톤.
  adjutant: {
    started: { ko: '이건 제가 한 번 제대로 물어볼게요', en: 'Leave this one to me — I will sink my teeth into it.' },
    thinking: { ko: '잠깐만요, 지금 뛰고 있습니다', en: 'Hold on a sec, I am already running on this.' },
    organizing: { ko: '맡겨주세요, 금방 정리해서 가져올게요', en: 'Trust me — sorted and back to you in a flash.' },
    finalizing: { ko: '판은 봤어요, 숫자만 세면 됩니다', en: "I've got the picture — just tallying the numbers now." },
    rendering: { ko: '보기 좋게 꾸려서 책상에 올려둘게요', en: 'Tidying it up nice and pretty for your desk.' },
    patience_check: { ko: '안 끝났어요, 제가 계속 뒤져보고 있습니다', en: 'Not done — I am still kicking every door down on this.' },
    patience_nearly: { ko: '목줄은 잡았어요, 바로 가져옵니다', en: 'Got it on a leash — bringing it over now.' },
  },
  // 범용/신규 에이전트 — SF 집사 톤.
  sf: {
    started: { ko: '지도를 펼쳤습니다, 출발합니다', en: 'Chart is open. Setting off.' },
    thinking: { ko: '0.4초만 주시죠, 지금 찾고 있어요', en: 'Give me 0.4 seconds — I am on the trail.' },
    organizing: { ko: '지금 서류 넘기는 소리 들리실 겁니다', en: 'You can hear the papers turning right now.' },
    finalizing: { ko: '이 항목은 처음이에요, 지도 다시 그립니다', en: 'First time on this route — redrawing the map.' },
    rendering: { ko: '준비되었습니다, 보시죠', en: 'All ready — please, take a look.' },
    patience_check: { ko: '아직 항해 중입니다, 좌표 조금만 더 주세요', en: 'Still navigating — a few more coordinates, please.' },
    patience_nearly: { ko: '접안 임박합니다, 등받이에 기대셔도 됩니다', en: 'Docking now — lean back, it is almost here.' },
  },
};

export function isQuipCharacter(t: QuipTone | QuipCharacter): t is QuipCharacter {
  return t === 'noir' || t === 'adjutant' || t === 'sf';
}

export function pickQuip(key: QuipKey, locale: Locale, tone?: Record<string, unknown> | null): string {
  const t = resolveQuipTone(tone);
  return isQuipCharacter(t) ? CHARACTER_QUIPS[t][key][locale] : QUIPS[key][t][locale];
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
