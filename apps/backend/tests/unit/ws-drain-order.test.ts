/**
 * t_5cba9ebb — WS 보류 큐 드레인 '도착 순서' 회귀 테스트.
 *
 * 실DB 음성 스모크 재현 결함: pendingIngress 드레인이 fire-and-forget 병렬이라
 * 각 프레임의 assertSessionOwnership DB 왕복(수백 ms) 완료 순이 비결정적 →
 * handshake 창에 보류된 audio.start보다 audio.end가 먼저 실행돼
 * '활성 오디오 스트림이 없습니다'. 이 테스트는 왕복 지연을 역순으로 걸어
 * (앞 프레임이 느린 상황 = 실DB에서 재현된 바로 그 조건) 직렬화 보장을 검증한다.
 */
import { describe, expect, it } from 'vitest';
import { __ingressTestHooks } from '../../src/websocket/handler';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('드레인 직렬화 (t_5cba9ebb)', () => {
  it('앞 프레임이 느려도 도착 순서대로 처리된다 — audio.start → audio.end', async () => {
    const socket = {};
    __ingressTestHooks.queue(socket, JSON.stringify({ type: 'audio.start', session_id: 's' }));
    __ingressTestHooks.queue(socket, JSON.stringify({ type: 'audio.end', session_id: 's' }));
    const order: string[] = [];
    await __ingressTestHooks.drain(socket, async (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'audio.start') { await sleep(25); order.push('start'); }
      else order.push('end');
    });
    // 병렬(구구조)이면 느린 start 이후로 end가 선행 기록된다: ['end','start'].
    expect(order).toEqual(['start', 'end']);
  });

  it('개별 프레임 실패가 후속 프레임을 막지 않는다 (FIFO 유지)', async () => {
    const socket = {};
    __ingressTestHooks.queue(socket, '1');
    __ingressTestHooks.queue(socket, '2');
    __ingressTestHooks.queue(socket, '3');
    const seen: string[] = [];
    await __ingressTestHooks.drain(socket, async (raw) => {
      seen.push(String(raw));
      if (raw === '2') throw new Error('frame fail');
    });
    expect(seen).toEqual(['1', '2', '3']);
  });

  it('드레인 후 큐는 비워진다 — 같은 소켓 재드레인 무발화', async () => {
    const socket = {};
    __ingressTestHooks.queue(socket, 'a');
    const seen: string[] = [];
    await __ingressTestHooks.drain(socket, (raw) => { seen.push(String(raw)); });
    await __ingressTestHooks.drain(socket, (raw) => { seen.push(String(raw)); });
    expect(seen).toEqual(['a']);
  });
});
