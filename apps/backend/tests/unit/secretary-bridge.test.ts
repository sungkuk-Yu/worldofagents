/**
 * t_620d5549 — 앱 속 실 김비서 브리지 (김비서 room → Hermes kimsecretary 왕복)
 *  ① 매칭/설계 규칙: 이름 정합·endpoint 게이트·reasoning 블록 제거·회신 추출 우선순위
 *  ② 왕복: A2A message/send payloads(contextId 재사용)·컨텍스트 영속·턴 카운트·자전
 *  ③ 실패 정책: transport/timeout/빈 본문 → 폴백 문장(턴 생존), 안티루프 REJECTED → 1회 재시도
 *  fetch는 전량 모킹 — 실 9902 호출 없이 wire 형상만 검증한다 (라이브 왕복은 스모크가 담당).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import {
  buildContextDigest, bridgeFallbackText, BridgeError, extractReplyText, isAntiLoopRejection,
  isBridgeConfigured, isKimSecretaryAgent, sendTurnToSecretary, stripReasoningBlock, TONE_KIT_MARKER,
} from '../../src/lib/secretaryBridge';
import { DbClient } from '../../src/lib/supabase';

const SESSION = 'session-bridge-1';

let store: ReturnType<typeof createStore>;
let db: DbClient;

beforeEach(() => {
  store = createStore();
  db = createDevClient(store) as DbClient;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** endpoint를 getter 스파이로 켠다 (vitest env는 기본 봉인 — config.perplexity 컨벤션 동일). */
function withBridge(endpoint = 'http://127.0.0.1:9902', timeoutMs = 5000, maxTurns = 15) {
  vi.spyOn(config.secretaryBridge, 'endpoint', 'get').mockReturnValue(endpoint);
  vi.spyOn(config.secretaryBridge, 'timeoutMs', 'get').mockReturnValue(timeoutMs);
  vi.spyOn(config.secretaryBridge, 'maxTurns', 'get').mockReturnValue(maxTurns);
}

function a2aResult(text: string, opts: { contextId?: string; state?: string } = {}) {
  return {
    jsonrpc: '2.0', id: 'x',
    result: {
      id: 'task-1',
      contextId: opts.contextId ?? 'ctx-abc',
      status: { state: opts.state ?? 'TASK_STATE_COMPLETED', message: { role: 'ROLE_AGENT', parts: [{ text }] } },
      artifacts: [{ artifactId: 'a1', parts: [{ text }] }],
    },
  };
}

describe('① 설계 규칙 (pure)', () => {
  it('endpoint 미설정 = 브리지 OFF (기타 room·기본 환경 무영향)', () => {
    expect(isBridgeConfigured()).toBe(false);
    withBridge('');
    expect(isBridgeConfigured()).toBe(false);
    withBridge('http://127.0.0.1:9902');
    expect(isBridgeConfigured()).toBe(true);
  });

  it('에이전트 이름은 정확히 김비서만 매칭 — 부분일치·오행·test 에이전트 금지', () => {
    expect(isKimSecretaryAgent('김비서')).toBe(true);
    expect(isKimSecretaryAgent(' 김비서 ')).toBe(true);
    expect(isKimSecretaryAgent('김비서2')).toBe(false);
    expect(isKimSecretaryAgent('내 김비서')).toBe(false);
    expect(isKimSecretaryAgent('KimSecretary')).toBe(false);
    expect(isKimSecretaryAgent(undefined)).toBe(false);
    expect(isKimSecretaryAgent(null)).toBe(false);
  });

  it('회신 추출: artifacts 우선, status.message 폴백', () => {
    expect(extractReplyText({ artifacts: [{ parts: [{ text: '최종' }] }], status: { message: { parts: [{ text: '중간' }] } } })).toBe('최종');
    expect(extractReplyText({ status: { message: { parts: [{ text: '중간' }] } } })).toBe('중간');
    expect(extractReplyText({})).toBe('');
  });

  it('게이트웨이 reasoning 블록(선두 💭+fence)만 제거 — 본문 중간 펜스는 보존', () => {
    const withReasoning = '💭 **Reasoning:**\n```\nsome inner thought\n```\n\npong — 김비서 정상 응답.';
    expect(stripReasoningBlock(withReasoning)).toBe('pong — 김비서 정상 응답.');
    const midFence = '정리해줄게:\n```py\nprint(1)\n```\n이렇게요.';
    expect(stripReasoningBlock(midFence)).toBe(midFence);
    expect(stripReasoningBlock('일반 답변')).toBe('일반 답변');
  });

  it('안티루프 REJECTED 판정: 상태+문구 모두 맞을 때만', () => {
    const rej = { status: { state: 'TASK_STATE_REJECTED', message: { parts: [{ text: 'Anti-loop protection: exceeded 20 turns' }] } } };
    expect(isAntiLoopRejection(rej as any)).toBe(true);
    expect(isAntiLoopRejection({ status: { state: 'TASK_STATE_COMPLETED', message: { parts: [{ text: 'anti-loop' }] } } } as any)).toBe(false);
    expect(isAntiLoopRejection({ status: { state: 'TASK_STATE_REJECTED', message: { parts: [{ text: 'Empty task' }] } } } as any)).toBe(false);
  });

  it('자전 다이제스트는 최근 발화를 담고 이전 발화를 마지막에 둔다', () => {
    const d = buildContextDigest(
      [{ role: 'user', content: '오늘 일정 알려줘' }, { role: 'agent', content: '3건입니다' }],
      '2번 미팅 시간 옮겨',
    );
    expect(d).toContain('대표: 오늘 일정 알려줘');
    expect(d).toContain('김비서: 3건입니다');
    expect(d.endsWith('2번 미팅 시간 옮겨')).toBe(true);
    expect(d).not.toMatch(/Anti-loop/);
  });

  it('폴백 문장은 로케일별 1문장 원인 고지 — 기술 용어(A2A/JSON-RPC) 노출 금지', () => {
    const ko = bridgeFallbackText('ko', 'timeout');
    expect(ko).toContain('지연');
    expect(ko).not.toMatch(/A2A|JSON|RPC|HTTP/);
    const en = bridgeFallbackText('en', 'transport');
    expect(en).toContain('KimSecretary');
    expect(en).not.toMatch(/A2A|JSON-RPC/);
  });
});

describe('② 왕복·연속성', () => {
  it('첫 턴: message/send payload(ROLE_USER·text part) 발송 → 회신 원문 + contextId 영속', async () => {
    withBridge();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(a2aResult('네, 확인했습니다.'))));
    vi.stubGlobal('fetch', fetchMock);

    const r = await sendTurnToSecretary(db, SESSION, '오늘 일정 알려줘');
    expect(r.text).toBe('네, 확인했습니다.');
    expect(r.state).toBe('TASK_STATE_COMPLETED');
    expect(r.contextId).toBe('ctx-abc');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:9902');
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe('message/send');
    expect(body.params.message.role).toBe('ROLE_USER');
    // t_5cba9ebb 1항: 새 컨텍스트 첫 발화에는 텔레그램 화법 톤 키트가 선행 주입되고
    // 원 발화는 맨 마지막에 원형 그대로 이어붙는다 (본문 변형 금지).
    const sent = String(body.params.message.parts[0].text);
    expect(sent.startsWith(TONE_KIT_MARKER)).toBe(true);
    expect(sent.endsWith('오늘 일정 알려줘')).toBe(true);
    expect(body.params.message.contextId).toBeUndefined(); // 첫 턴은 컨텍스트 없음

    await vi.waitFor(async () => {
      const ctx = store.tables.context_patches.filter(p => p.key === 'secretary.bridge');
      expect(ctx.length).toBe(1);
      expect((ctx[0].delta as any).value.contextId).toBe('ctx-abc');
    });
  });

  it('다음 턴: 저장된 contextId를 이어붙이고 turn count가 증가한다 (헤르메스 세션 연속)', async () => {
    withBridge();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(a2aResult('ok')))));
    await sendTurnToSecretary(db, SESSION, '첫 발화');
    await vi.waitFor(async () => expect(store.tables.context_patches.length).toBe(1));

    const second = vi.fn(async (_u: any, init: any) => {
      const b = JSON.parse(String(init.body));
      expect(b.params.message.contextId).toBe('ctx-abc'); // v1.0: Message 내부
      return new Response(JSON.stringify(a2aResult('ok2', { contextId: 'ctx-abc' })));
    });
    vi.stubGlobal('fetch', second);
    const r = await sendTurnToSecretary(db, SESSION, '두 번째 발화');
    expect(r.turns).toBe(2);
    await vi.waitFor(async () => {
      const rows = store.tables.context_patches.filter(p => p.key === 'secretary.bridge');
      expect((rows.at(-1)!.delta as any).value.turns).toBe(2);
    });
  });

  it('maxTurns 도달 시 컨텍스트 자전: 새 contextId(없음) + 이전 발화 다이제스트 첨부', async () => {
    withBridge('http://127.0.0.1:9902', 5000, 2);
    // 사전 상태: ctx-old가 이미 2턴 소비
    store.tables.context_patches.push({
      session_id: SESSION, key: 'secretary.bridge', operation: 'set',
      delta: { value: { contextId: 'ctx-old', turns: 2 } }, source_neuron: 'bridge',
    });
    vi.stubGlobal('fetch', vi.fn(async (_u: any, init: any) => {
      const b = JSON.parse(String(init.body));
      expect(b.params.message.contextId).toBeUndefined(); // 자전 — 새 컨텍스트
      expect(b.params.message.parts[0].text).toContain('인계'); // 다이제스트 헤더
      expect(b.params.message.parts[0].text.endsWith('새 발화')).toBe(true);
      return new Response(JSON.stringify(a2aResult('이어받았습니다', { contextId: 'ctx-new' })));
    }));
    const r = await sendTurnToSecretary(db, SESSION, '새 발화', [
      { role: 'user', content: '과거 발화' }, { role: 'agent', content: '과거 회신' },
    ]);
    expect(r.contextId).toBe('ctx-new');
    expect(r.turns).toBe(1);
  });

  it('구버전 문자열 컨텍스트 값도 읽는다 (형상 마이그레이션 내성)', async () => {
    withBridge();
    store.tables.context_patches.push({
      session_id: SESSION, key: 'secretary.bridge', operation: 'set',
      delta: { value: 'ctx-legacy' }, source_neuron: 'bridge',
    });
    const mock = vi.fn(async (_u: any, init: any) => {
      expect(JSON.parse(String(init.body)).params.message.contextId).toBe('ctx-legacy');
      return new Response(JSON.stringify(a2aResult('ok', { contextId: 'ctx-legacy' })));
    });
    vi.stubGlobal('fetch', mock);
    const r = await sendTurnToSecretary(db, SESSION, '발화');
    expect(r.turns).toBe(2); // legacy 1 + 이번
  });

  it('INPUT_REQUIRED는 성공 회신으로 통과한다 (김비서 추가 확인 → 답변 텍스트로 노출)', async () => {
    withBridge();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(
      a2aResult('몇 시 회의 말씀인가요?', { state: 'TASK_STATE_INPUT_REQUIRED' })))));
    const r = await sendTurnToSecretary(db, SESSION, '회의 옮겨줘');
    expect(r.text).toBe('몇 시 회의 말씀인가요?');
    expect(r.state).toBe('TASK_STATE_INPUT_REQUIRED');
  });
});

describe('③ 실패 정책', () => {
  it('transport 실패(HTTP 500) → BridgeError(transport) — 로컬 답변 오염 없음', async () => {
    withBridge();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(sendTurnToSecretary(db, SESSION, '발화')).rejects.toMatchObject({ kind: 'transport' });
    expect(store.tables.context_patches.length).toBe(0); // 실패 턴은 컨텍스트 미영속
  });

  it('타임아웃 → BridgeError(timeout)', async () => {
    withBridge('http://127.0.0.1:9902', 50);
    vi.stubGlobal('fetch', vi.fn((_u: any, init: any) => new Promise((_res, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    await expect(sendTurnToSecretary(db, SESSION, '발화')).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('빈 본문(artifacts·status 모두 없음) → BridgeError(empty)', async () => {
    withBridge();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 'x', result: { id: 't', contextId: 'c', status: { state: 'TASK_STATE_COMPLETED' } },
    }))));
    await expect(sendTurnToSecretary(db, SESSION, '발화')).rejects.toMatchObject({ kind: 'empty' });
  });

  it('JSON-RPC error envelope → BridgeError(rpc)', async () => {
    withBridge();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 'x', error: { code: -32602, message: 'invalid params' },
    }))));
    await expect(sendTurnToSecretary(db, SESSION, '발화')).rejects.toMatchObject({ kind: 'rpc' });
  });

  it('안티루프 REJECTED → 새 컨텍스트로 1회 재시도 성공 시 답변 복귀', async () => {
    withBridge();
    store.tables.context_patches.push({
      session_id: SESSION, key: 'secretary.bridge', operation: 'set',
      delta: { value: { contextId: 'ctx-hot', turns: 1 } }, source_neuron: 'bridge',
    });
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: any, init: any) => {
      call++;
      if (call === 1) {
        expect(JSON.parse(String(init.body)).params.message.contextId).toBe('ctx-hot');
        return new Response(JSON.stringify({
          jsonrpc: '2.0', id: 'x',
          result: { id: 't2', contextId: 'ctx-hot', status: { state: 'TASK_STATE_REJECTED', message: { parts: [{ text: 'Anti-loop protection: context exceeded 20 turns' }] } } },
        }));
      }
      expect(JSON.parse(String(init.body)).params.message.contextId).toBeUndefined(); // 재시도는 새 컨텍스트
      return new Response(JSON.stringify(a2aResult('새 대화로 이어갑니다', { contextId: 'ctx-fresh' })));
    }));
    const r = await sendTurnToSecretary(db, SESSION, '발화', [{ role: 'user', content: '이전 발화' }]);
    expect(call).toBe(2);
    expect(r.text).toBe('새 대화로 이어갑니다');
    expect(r.turns).toBe(1);
  });

  it('BridgeError.kind는 폴백 문장 생성에 그대로 쓰인다 (graph 계약)', () => {
    const e = new BridgeError('timeout', '타임아웃');
    expect(bridgeFallbackText('ko', e.kind)).toContain('지연');
  });
});
