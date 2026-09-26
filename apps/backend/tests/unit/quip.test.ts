/** quip 인가화(t_b2b86cd6): 금지 노출 0건 + 페르소나 톤 분기 + 지연 15s 진행도 티커. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/neurons/graph', () => ({
  processTurn: (_db: unknown, _s: unknown, _u: unknown, _a: unknown, _p: unknown, _m: unknown, opts: any) => {
    if (opts?.onTurnStatus) opts.onTurnStatus('processing', { stage: 'thinking' });
    return new Promise(() => undefined); // 진행도는 emitted, resolve 안 함 — clearTimeout으로 취소
  },
}));

import { config } from '../../src/config';
import { CHARACTER_QUIPS, PATIENCE_PLAN, pickQuip, patienceQuipAt, QUIPS, QuipCharacter, QuipKey, QuipTone, resolveQuipTone } from '../../src/lib/locale';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const toneKeys: QuipTone[] = ['warm', 'brisk', 'playful'];
const charKeys: QuipCharacter[] = ['noir', 'adjutant', 'sf'];
const quipKeys = Object.keys(QUIPS) as QuipKey[];
/** 공용 3톤 + 캐릭터 전용 3풀의 전 문자열 (캐릭터 간·stage 간 중복 0이 수용 기준, t_80f0d396). */
function allQuipStrings(): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const key of quipKeys) {
    for (const tone of toneKeys) for (const locale of ['ko', 'en'] as const) out.push({ id: `common.${key}.${tone}.${locale}`, text: QUIPS[key][tone][locale] });
    for (const ch of charKeys) for (const locale of ['ko', 'en'] as const) out.push({ id: `${ch}.${key}.${locale}`, text: CHARACTER_QUIPS[ch][key][locale] });
  }
  return out;
}
// 금지: 영문 코드 단어 노출(대/소문자·품사 무관)와 시스템 용어. stage 필드 코드는 계약상 유지되므로 검사 대상이 아니다.
const FORBIDDEN: [RegExp, string][] = [
  [/\b(think|thinking|thinks|thought)\b/i, 'thinking'],
  [/\b(organize|organizing|organizes|organized)\b/i, 'organizing'],
  [/\b(recall|recalling|recalled)\b/i, 'recalling'],
  [/\b(compose|composing|composed)\b/i, 'composing'],
  [/처\s*리\s*중/, '처리 중'],
  [/응답 생성|데이터 처리|파이프라인|뉴런|토큰|서버/, '기술 용어'],
];

describe('quip 금지 노출 검사', () => {
  it('공용 3톤+캐릭터 3풀 전 문구에서 thinking/organizing/recalling/composing/처리중/기술용어 0건', () => {
    const offenders: string[] = [];
    for (const { id, text } of allQuipStrings()) {
      for (const [re, label] of FORBIDDEN) if (re.test(text)) offenders.push(`${id} → ${label}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });

  it('캐릭터 간·stage 간 중복 0건 — 공용 3톤 포함 전체 quip 문자열 84개가 서로 다르다', () => {
    const all = allQuipStrings();
    expect(all).toHaveLength(7 * (3 + 3) * 2);
    const byText = new Map<string, string[]>();
    for (const { id, text } of all) byText.set(text, [...(byText.get(text) || []), id]);
    const dupes = [...byText.entries()].filter(([, ids]) => ids.length > 1).map(([t, ids]) => `"${t}" ← ${ids.join(', ')}`);
    expect(dupes).toEqual([]);
  });

  it('전체 키×톤×로케일 조합이 빈 문자열 없이 채워져 있다', () => {
    for (const key of ['started', 'thinking', 'organizing', 'finalizing', 'rendering', 'patience_check', 'patience_nearly'] as QuipKey[])
      for (const tone of toneKeys) for (const locale of ['ko', 'en'] as const)
        expect(QUIPS[key][tone][locale].length, `${key}.${tone}.${locale}`).toBeGreaterThan(0);
    for (const ch of charKeys) for (const key of quipKeys) for (const locale of ['ko', 'en'] as const)
      expect(CHARACTER_QUIPS[ch][key][locale].length, `${ch}.${key}.${locale}`).toBeGreaterThan(0);
  });

  it('대표님 지정 문구가 각 캐릭터 풀의 올바른 stage에 있다 (t_80f0d396)', () => {
    expect(CHARACTER_QUIPS.noir.started.ko).toBe('현장에 나가볼게요, 잠깐만요');
    expect(CHARACTER_QUIPS.noir.thinking.ko).toBe('단서가 두 개 나왔습니다, 더 캘까요');
    expect(CHARACTER_QUIPS.noir.organizing.ko).toBe('증거는 모았어요, 정리해서 가져올게요');
    expect(CHARACTER_QUIPS.noir.finalizing.ko).toBe('이 사건 생각보다 복잡하네요, 좀 더 봐야돼요');
    expect(CHARACTER_QUIPS.noir.patience_check.ko).toBe('네, 제가 꼼꼼히 봐드릴게요'); // 현행 유지(이관)
    expect(CHARACTER_QUIPS.adjutant.started.ko).toBe('이건 제가 한 번 제대로 물어볼게요');
    expect(CHARACTER_QUIPS.adjutant.thinking.ko).toBe('잠깐만요, 지금 뛰고 있습니다');
    expect(CHARACTER_QUIPS.adjutant.organizing.ko).toBe('맡겨주세요, 금방 정리해서 가져올게요');
    expect(CHARACTER_QUIPS.adjutant.finalizing.ko).toBe('판은 봤어요, 숫자만 세면 됩니다');
    expect(CHARACTER_QUIPS.sf.thinking.ko).toBe('0.4초만 주시죠, 지금 찾고 있어요');
    expect(CHARACTER_QUIPS.sf.organizing.ko).toBe('지금 서류 넘기는 소리 들리실 겁니다');
    expect(CHARACTER_QUIPS.sf.finalizing.ko).toBe('이 항목은 처음이에요, 지도 다시 그립니다');
    expect(CHARACTER_QUIPS.sf.rendering.ko).toBe('준비되었습니다, 보시죠');
  });
});

describe('톤 해석', () => {
  it('formality 기본 매핑 + quip_tone 명시 우선', () => {
    expect(resolveQuipTone(undefined)).toBe('warm');
    expect(resolveQuipTone(null)).toBe('warm');
    expect(resolveQuipTone({ formality: 'friendly' })).toBe('warm');
    expect(resolveQuipTone({ formality: 'formal' })).toBe('brisk');
    expect(resolveQuipTone({ formality: 'casual' })).toBe('playful');
    expect(resolveQuipTone({ formality: 'formal', quip_tone: 'warm' })).toBe('warm');
    expect(resolveQuipTone({ quip_tone: 'nonsense' })).toBe('warm');
  });

  it('캐릭터 값(noir/adjutant/sf)은 quip_tone 명시 시에만 성립 — formality로는 추론되지 않는다', () => {
    expect(resolveQuipTone({ quip_tone: 'noir' })).toBe('noir');
    expect(resolveQuipTone({ quip_tone: 'adjutant' })).toBe('adjutant');
    expect(resolveQuipTone({ quip_tone: 'sf' })).toBe('sf');
    expect(resolveQuipTone({ formality: 'formal', quip_tone: 'sf' })).toBe('sf'); // 명시 우선
    expect(resolveQuipTone({ formality: 'formal' })).toBe('brisk'); // 캐릭터 추론 없음
    expect(resolveQuipTone({ quip_tone: 'detective' })).toBe('warm'); // 오타/미지정 → 폴백
  });

  it('pickQuip — 미지정 톤은 warm, formal이면 brisk, 캐릭터면 전용 풀', () => {
    expect(pickQuip('started', 'ko')).toBe(QUIPS.started.warm.ko);
    expect(pickQuip('started', 'ko', { formality: 'formal' })).toBe(QUIPS.started.brisk.ko);
    expect(pickQuip('started', 'en', { formality: 'casual' })).toBe(QUIPS.started.playful.en);
    expect(pickQuip('started', 'ko', { quip_tone: 'noir' })).toBe(CHARACTER_QUIPS.noir.started.ko);
    expect(pickQuip('finalizing', 'en', { quip_tone: 'adjutant' })).toBe(CHARACTER_QUIPS.adjutant.finalizing.en);
    expect(pickQuip('thinking', 'ko', { quip_tone: 'sf', formality: 'formal' })).toBe(CHARACTER_QUIPS.sf.thinking.ko);
    // 캐릭터 풀도 patience 진행도 키를 완비한다 — 티커가 캐릭터 문구로 이어 붙는다.
    expect(pickQuip('patience_check', 'ko', { quip_tone: 'noir' })).toBe('네, 제가 꼼꼼히 봐드릴게요');
  });
});

describe('지연 진행도 (patience)', () => {
  it('플랜: organizing 확인 → finalizing 거의 다 됨, 그 이후 None', () => {
    expect(PATIENCE_PLAN).toHaveLength(2);
    expect(patienceQuipAt(0)).toEqual({ stage: 'organizing', quip: 'patience_check' });
    expect(patienceQuipAt(1)).toEqual({ stage: 'finalizing', quip: 'patience_nearly' });
    expect(patienceQuipAt(2)).toBeUndefined();
  });

  const session = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
  let db: DbClient;
  let events: TurnEmitEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    const store = createStore();
    store.tables.personas.push({ id: 'persona', tone_config: { formality: 'formal' } });
    db = createDevClient(store) as DbClient;
    runTextTurn(db, session, 'user', '계약 해지 가능?', { locale: 'ko', emit: e => events.push(e) }).catch(() => undefined);
  });
  afterEach(() => {
    vi.runOnlyPendingTimers(); // 진행도 emit 후 미해결 promise 취소
    vi.useRealTimers();
  });

  it('15s 미만: 접수+처리 시작까지만, 인내 진행도 없음', () => {
    vi.advanceTimersByTime(config.quipPatienceMs - 1);
    const runEvents = events.filter(e => e.type.startsWith('run.'));
    expect(runEvents.map(e => e.type)).toEqual(['run.started', 'run.progress']);
  });

  it('15s/30s: 확인→거의다됨 2회 후 45s에 중단 (stage 필드는 계약 코드 그대로)', async () => {
    vi.advanceTimersByTime(config.quipPatienceMs);
    vi.advanceTimersByTime(config.quipPatienceMs);
    vi.advanceTimersByTime(config.quipPatienceMs * 2);
    const runEvents = events.filter(e => e.type.startsWith('run.'));
    expect(runEvents.map(e => e.type)).toEqual(['run.started', 'run.progress', 'run.progress', 'run.progress']);
    expect(runEvents[1].stage).toBe('thinking');
    const patience = runEvents.slice(2);
    expect(patience.map(e => e.stage)).toEqual(['organizing', 'finalizing']);
    // 페르소나 formality=formal → brisk 톤 문구가 이어 붙는다.
    expect(patience.map(e => e.quip)).toEqual([QUIPS.patience_check.brisk.ko, QUIPS.patience_nearly.brisk.ko]);
  });

  it('접수 문구는 페르소나 말투(brisk)를 반영한다', () => {
    expect((events[0] as any).type).toBe('run.started');
    expect((events[0] as any).quip).toBe(QUIPS.started.brisk.ko);
  });
});
