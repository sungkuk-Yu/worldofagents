/**
 * t_5cba9ebb — 페르소나 보이스 채널 + 음성 즉시 진행 + 화법 톤 키트
 * 대표님 9/29:
 *  ① 음성 경로 공감 스테이지 생략 (복명복창 폐기) + answer 리드 지연 0 → 첫 delta 즉시
 *  ② 모든 연출 발화가 persona.line 한 줄로 수렴, 답변 스트리밍 시작 시 소멸 (kill)
 *  ③ 김비서 화법 톤 키트는 새 컨텍스트 첫 발화에만 (이어받기 재주입 금지)
 *  ④ busy 입력 합류 안내는 1인칭 한 줄, ETA 금지
 *  ⑤ mock 오염 식별(고정 문장)은 stt.ts 단일 소스
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, PersonaVoice, TurnEmitEvent } from '../../src/lib/chatTurn';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';
import {
  PERSONA_SILENCE_FILL_MS, queueJoinLine, personaLine, personaAckLine,
} from '../../src/lib/personaVoice';
import {
  applyToneKit, isKimSecretaryAgent, sendTurnToSecretary, SECRETARY_TONE_KIT, TONE_KIT_MARKER,
} from '../../src/lib/secretaryBridge';
import { MOCK_STT_PHRASE } from '../../src/lib/stt';

const session = (agentId = 'agent') => ({ id: 'session', user_id: 'user', agent_id: agentId, persona_id: 'persona', status: 'active' }) as SessionsRow;

let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  store.tables.personas.push({ id: 'persona', tone_config: {} });
  store.tables.agents.push({ id: 'agent', name: '내 그림자 비서' });
  store.tables.sessions.push(session('agent'));
  db = createDevClient(store) as DbClient;
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
  vi.spyOn(config.secretaryBridge, 'endpoint', 'get').mockReturnValue(''); // 브리지 OFF (별도 describe에서 켠다)
  vi.spyOn(config.suggestedQuestions, 'enabled', 'get').mockReturnValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function streamFetch() {
  return vi.fn(async () => new Response('data: {"model":"test-model","choices":[{"delta":{"content":"실제 답변입니다."}}]}\n\ndata: [DONE]\n'));
}

describe('① 음성 턴 — 공감 생략·리드 0 (대표님 9/29 #325 확정)', () => {
  it('sttMetadata 턴: empathy 행 없이 user+answer만 저장, persona.line ack 1건', async () => {
    vi.stubGlobal('fetch', streamFetch());
    const events: TurnEmitEvent[] = [];
    const r = await runTextTurn(db, session(), 'user', '오늘 일정 알려줘', {
      sttMetadata: { service: 'local', confidence: 0.9 },
      emit: e => events.push(e),
    });
    expect(r.empathyMessageId).toBeNull();
    expect(r.messages.empathy).toBeNull();
    expect(r.answerResponse).toBe('실제 답변입니다.');
    // 저장된 user 행은 voice (message_type) + stt_metadata 원본 유지
    const user = store.tables.messages.find(m => m.role === 'user');
    expect(user.message_type).toBe('voice');
    expect(user.stt_metadata.service).toBe('local');
    // empathy 뉴런 이벤트 없음 (스테이지 자체가 도지 않는다)
    expect(events.filter(e => e.type === 'neuron.status' && (e as any).neuron?.slug === 'empathy')).toHaveLength(0);
    // 페르소나 줄: ack 1건(≤2s 첫 발화) 이후 답변이 없으면 4s fill — fake timer 없이 실 타임아웃이면 kill 전 개수만 ack
    const lines = events.filter(e => e.type === 'persona.line');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toMatchObject({ source: 'ack', line: personaAckLine('ko') });
  });

  it('리드 지연 0: 음성 턴의 answer 스트리밍은 empathy 대기 없이 시작 (answerLeadMs>0이어도 무관)', async () => {
    vi.spyOn(config, 'answerLeadMs', 'get').mockReturnValue(3000);
    vi.stubGlobal('fetch', streamFetch());
    const t0 = Date.now();
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, session(), 'user', '음성 발화입니다', {
      sttMetadata: { service: 'local' },
      emit: e => events.push(e),
    });
    const firstDelta = events.find(e => e.type === 'answer.delta');
    expect(firstDelta).toBeTruthy();
    // 3초 lead가 걸렸다면 elapsed ≥3000 — 음성 경로에서는 0으로 우회돼야 한다.
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('텍스트 턴은 기존 empathy 재질문 계약 유지 (t_44f8896c 회귀 금지)', async () => {
    vi.stubGlobal('fetch', streamFetch());
    const events: TurnEmitEvent[] = [];
    const r = await runTextTurn(db, session(), 'user', '내일 회의 자료를 정리해 줄래?', { emit: e => events.push(e) });
    expect(r.empathyMessageId).toBeTruthy();
    const em = store.tables.messages.find(m => m.source_neuron === 'empathy');
    expect(em?.structured_payload.empathy_question).toBeTruthy();
  });
});

describe('② PersonaVoice 단일 줄 수렴', () => {
  it('한 시점 한 줄: 동일 문장 연속 재발송 금지, stage briefing/done 생략', () => {
    const out: TurnEmitEvent[] = [];
    const v = new PersonaVoice(e => out.push(e), { session_id: 's', run_id: 'r' }, 'ko');
    v.ack();
    v.ack(); // 중복 — 무시
    v.stage('briefing'); // ack과 역할 중복 — 생략
    v.stage('done'); // 답변이 담당 — 생략
    v.stage('research');
    expect(out).toHaveLength(2);
    expect((out[0] as any).source).toBe('ack');
    expect((out[1] as any).line).toBe(personaLine('research', 'ko'));
  });

  it('answer.delta 스트리밍 시작 = 줄 소멸 (kill 후 발화 0)', () => {
    const out: TurnEmitEvent[] = [];
    const v = new PersonaVoice(e => out.push(e), { session_id: 's', run_id: 'r' }, 'ko');
    v.kill();
    v.ack(); v.stage('drafting'); v.patience(1); v.queueJoin(3);
    expect(out).toHaveLength(0);
    expect(v.killed).toBe(true);
  });

  it('다중 발화 대기 합류 안내: 같은 라인에 1인칭 큐 문장, ETA(시간 약속) 금지', () => {
    const line = personaLine('research', 'ko', { pending: 2 });
    expect(line).toContain(queueJoinLine(2, 'ko'));
    expect(queueJoinLine(0, 'ko')).toBe(''); // 대기 없으면 합류 문장 없음
    expect(queueJoinLine(3, 'en')).toMatch(/3 questions ahead/);
    for (const s of [line, queueJoinLine(2, 'ko')]) {
      expect(s).not.toMatch(/분 후|초 후|seconds? later|minutes? later/); // 감소하는 위치만, ETA 금지
    }
  });

  it('침묵 fill 상수 = 4000ms (볼트 리서치 §2 — 4초+ 구간 content-bearing 강제)', () => {
    expect(PERSONA_SILENCE_FILL_MS).toBe(4000);
    // content-bearing: 진행 표시가 아니라 내용을 말한다 (in-car agent 실험 — artificial indicator 무효과)
    for (const stage of ['research', 'drafting', 'wrapping'] as const) {
      expect(personaLine(stage, 'ko').length).toBeGreaterThan(8);
      expect(personaLine(stage, 'ko')).not.toMatch(/Loading|%|…\s*$/);
    }
  });

  it('persona.line run에 연결: run.completed까지 emit 경로에 source 포함, answer.delta 후 추가 줄 없음', async () => {
    vi.stubGlobal('fetch', streamFetch());
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, session(), 'user', '텍스트 질문입니다', { emit: e => events.push(e) });
    const firstDeltaIdx = events.findIndex(e => e.type === 'answer.delta');
    expect(firstDeltaIdx).toBeGreaterThan(-1);
    const linesAfterDelta = events.slice(firstDeltaIdx + 1).filter(e => e.type === 'persona.line');
    expect(linesAfterDelta).toHaveLength(0); // 답변이 말을 시작하면 줄은 소멸
  });
});

describe('③ 김비서 화법 톤 키트 — 새 컨텍스트에만 주입', () => {
  const withBridge = () => {
    vi.spyOn(config.secretaryBridge, 'endpoint', 'get').mockReturnValue('http://127.0.0.1:9902');
    vi.spyOn(config.secretaryBridge, 'timeoutMs', 'get').mockReturnValue(5000);
    vi.spyOn(config.secretaryBridge, 'maxTurns', 'get').mockReturnValue(15);
  };
  const a2aOk = (contextId: string) => new Response(JSON.stringify({
    jsonrpc: '2.0', id: 'x',
    result: { id: 't', contextId, status: { state: 'TASK_STATE_COMPLETED', message: { role: 'ROLE_AGENT', parts: [{ text: '네, 확인했습니다.' }] } }, artifacts: [{ parts: [{ text: '네, 확인했습니다.' }] }] },
  }));

  it('첫 발화: 톤 키트 선행 + 원 발화 원형 유지(끝)', async () => {
    withBridge();
    const fetchMock = vi.fn(async () => a2aOk('ctx-1'));
    vi.stubGlobal('fetch', fetchMock);
    await sendTurnToSecretary(db, 'session', '오늘 일정 알려줘');
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as any[])[1].body)).params.message.parts[0].text as string;
    expect(sent.startsWith(TONE_KIT_MARKER)).toBe(true);
    expect(sent.endsWith('오늘 일정 알려줘')).toBe(true);
    // 톤 키트 내용 계약: brevity·존댓말·목록 금지·되물음 금지 (대표님 원문 반영)
    expect(SECRETARY_TONE_KIT).toMatch(/2~4문장/);
    expect(SECRETARY_TONE_KIT).toMatch(/목록/);
    expect(SECRETARY_TONE_KIT).toMatch(/알려주세요/);
  });

  it('이어받기(기존 contextId): 재주입 없음', async () => {
    withBridge();
    const f1 = vi.fn(async () => a2aOk('ctx-1'));
    vi.stubGlobal('fetch', f1);
    await sendTurnToSecretary(db, 'session', '첫 발화');
    await vi.waitFor(() => expect(store.tables.context_patches.filter(p => p.key === 'secretary.bridge').length).toBe(1));
    const f2 = vi.fn(async () => a2aOk('ctx-1'));
    vi.stubGlobal('fetch', f2);
    await sendTurnToSecretary(db, 'session', '두 번째 발화');
    const sent2 = JSON.parse(String((f2.mock.calls[0] as any[])[1].body)).params.message.parts[0].text as string;
    expect(sent2).toBe('두 번째 발화'); // 톤 키트 없음 — 게이트웨이 세션이 이미 기억
  });

  it('applyToneKit 이중 주입 방지 + 매칭 규칙 불변', () => {
    const once = applyToneKit('원 발화');
    expect(applyToneKit(once)).toBe(once);
    expect(isKimSecretaryAgent('김비서')).toBe(true);
    expect(isKimSecretaryAgent('나의 그림자 비서')).toBe(false);
  });
});

describe('⑤ mock 오염 식별 단일 소스', () => {
  it('MOCK_STT_PHRASE는 stt.ts export이고 감사 스크립트 식별 키와 동일', () => {
    expect(MOCK_STT_PHRASE).toBe('안녕하세요, 오늘 할 일을 정리해 주세요.');
  });
});
