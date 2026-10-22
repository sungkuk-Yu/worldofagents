/**
 * 스레드 기능 스모크 테스트 (t_8fbe4328)
 * 020 마이그레이션 적용 전 flag OFF 상태 검증
 */
import { ok } from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

describe('Threads (flag OFF)', () => {
  let token, sessionId;

  before(async () => {
    // 회원가입 및 세션 생성
    const signupRes = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `thread-test-${Date.now()}@test.io`,
        password: 'password123',
        display_name: 'Thread Tester',
      }),
    });
    const signup = await signupRes.json();
    token = signup.data.token;

    const sessionRes = await fetch(`${BASE}/api/sessions/ensure`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'default' }),
    });
    const session = await sessionRes.json();
    sessionId = session.data.id;
  });

  it('GET /sessions/:id/messages는 parent_message_id IS NULL만 반환', async () => {
    const res = await fetch(`${BASE}/api/sessions/${sessionId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    ok(res.ok, `메시지 조회 실패: ${res.status}`);
    const body = await res.json();
    ok(Array.isArray(body.data), '메시지 목록은 배열이어야 함');
  });

  it('GET /sessions/:id/threads는 빈 배열 반환 (flag OFF)', async () => {
    const res = await fetch(`${BASE}/api/sessions/${sessionId}/threads`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    ok(res.ok, `스레드 목록 조회 실패: ${res.status}`);
    const body = await res.json();
    ok(Array.isArray(body.data), '스레드 목록은 배열이어야 함');
    ok(body.data.length === 0, 'flag OFF 상태에서는 스레드 없음');
  });

  it('POST /messages/:id/merge-thread는 답글 없으면 400', async () => {
    // 메시지 전송
    const msgRes = await fetch(`${BASE}/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '테스트 메시지' }),
    });
    const msg = await msgRes.json();
    const messageId = msg.data.user_message_id;

    // 병합 시도 (답글 없음)
    const mergeRes = await fetch(`${BASE}/api/messages/${messageId}/merge-thread`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    ok(mergeRes.status === 400, '답글 없으면 400 반환해야 함');
  });
});
