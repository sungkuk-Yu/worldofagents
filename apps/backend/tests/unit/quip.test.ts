/** quip 인가화(t_b2b86cd6): 금지 노출 0건 + 페르소나 톤 분기 + 지연 15s 진행도 티커. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/neurons/graph', () => ({
  processTurn: (_db: unknown, _s: unknown, _u: unknown, _a: unknown, _p: unknown, _m: unknown, opts: any) => {
    if (opts?.onTurnStatus) opts.onTurnStatus('processing', { stage: 'thinking' });
    return new Promise(() => undefined); // 진행도는 emitted, resolve 안 함 — clearTimeout으로 취소
  },
}));

import { config } from '../../src/config';
import { PATIENCE_PLAN, pickQuip, patienceQuipAt, QUIPS, QuipKey, QuipTone, resolveQuipTone } from '../../src/lib/locale';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const toneKeys: QuipTone[] = ['warm', 'brisk', 'playful'];
const quipKeys = Object.keys(QUIPS) as QuipKey[];
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
  it('전 톤×로케일 문구에서 thinking/organizing/recalling/composing/처리중/기술용어 0건', () => {
    const offenders: string[] = [];
    for (const key of quipKeys) for (const tone of toneKeys) for (const locale of ['ko', 'en'] as const) {
      const text = QUIPS[key][tone][locale];
      for (const [re, label] of FORBIDDEN) if (re.test(text)) offenders.push(`${key}.${tone}.${locale} → ${label}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });

  it('전체 키×톤×로케일 조합이 빈 문자열 없이 채워져 있다', () => {
    for (const key of ['started', 'thinking', 'organizing', 'finalizing', 'rendering', 'patience_check', 'patience_nearly'] as QuipKey[])
      for (const tone of toneKeys) for (const locale of ['ko', 'en'] as const)
        expect(QUIPS[key][tone][locale].length, `${key}.${tone}.${locale}`).toBeGreaterThan(0);
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

  it('pickQuip — 미지정 톤은 warm, formal이면 brisk 문구', () => {
    expect(pickQuip('started', 'ko')).toBe(QUIPS.started.warm.ko);
    expect(pickQuip('started', 'ko', { formality: 'formal' })).toBe(QUIPS.started.brisk.ko);
    expect(pickQuip('started', 'en', { formality: 'casual' })).toBe(QUIPS.started.playful.en);
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
