/**
 * P0 검증(t_486cf23b) — 로그인 라우트의 공유 admin 클라이언트 오염 여부 (실 DB).
 *
 * diag_pollution.ts와의 차이: 이 스크립트는 라이브러리를 직접 호출하지 않고
 * **수정된 /api/auth/login 라우트(app.inject)** 를 거쳐 오염 여부를 판정한다.
 *
 * 실행 (DEV_MODE=false 필수 — 실 Supabase 대상):
 *   cd apps/backend
 *   DEV_MODE=false ./node_modules/.bin/tsx tests/verify_login_pollution.ts
 *
 * 판정:
 *   1) BEFORE insert OK
 *   2) login 라우트 200
 *   3) AFTER insert OK  ← (구현 전이면 여기서 RLS 42501)
 *   4) 공유 supabaseAdmin.auth.getSession() === null (세션 미잔류 직접 증거)
 *   5) cleanup: DELETE /api/me cascade → 잔여 행 0
 */
import { app, build } from '../src/index';
import { config } from '../src/config';
import { supabaseAdmin } from '../src/lib/supabase';

const PASSWORD = ['P0ver', 'ify!', '2026'].join('');

async function main() {
  if (config.devMode) {
    console.error('FATAL: DEV_MODE=false로 실행해야 한다 (devstore는 오염을 재현하지 않음).');
    process.exit(2);
  }
  await build();

  const email = `p0verify_${Date.now()}@test.io`;
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const inject = async (method: string, url: string, token?: string, payload?: unknown) => {
    const res = await app.inject({ method: method as 'POST', url, headers: token ? bearer(token) : undefined, payload });
    return { status: res.statusCode, json: res.json() };
  };

  // 사용자/에이전트/세션 준비 (messages FK용)
  const su = await inject('POST', '/api/auth/signup', undefined, {
    email, password: PASSWORD, display_name: 'P0검증',
    age_confirmed: true,
    consents: ['terms', 'privacy', 'voice_recording', 'overseas_transfer'].map(type => ({ type, version: '1.0', consented: true })),
  });
  if (su.status !== 201) throw new Error(`signup 실패: ${su.status} ${JSON.stringify(su.json).slice(0, 200)}`);
  const token = su.json.data.token;
  const userId = su.json.data.user.id;

  const ag = await inject('POST', '/api/agents', token, { name: 'P0검증 에이전트', agent_type: 'shadow' });
  const se = await inject('POST', '/api/sessions/ensure', token, { agent_id: ag.json.data.id });
  const sessionId = se.json.data.id;
  console.log('setup: signup/agent/session OK —', `user=${userId.slice(0, 8)} session=${String(sessionId).slice(0, 8)}`);

  const probe = async (label: string, turnIndex: number) => {
    const { error } = await supabaseAdmin.from('messages').insert({
      session_id: sessionId, turn_index: turnIndex, role: 'user', message_type: 'text', content: `${label} probe`,
    }).select();
    console.log(`${label} insert via shared supabaseAdmin:`, error ? `FAIL: ${error.message}` : 'OK');
    if (!error) await supabaseAdmin.from('messages').delete().eq('session_id', sessionId).eq('turn_index', turnIndex);
    return !error;
  };

  const before = await probe('BEFORE-login', 990001);

  const login = await inject('POST', '/api/auth/login', undefined, { email, password: PASSWORD });
  console.log('POST /api/auth/login (fixed route):', login.status === 200 ? `OK user=${login.json.data.user.id.slice(0, 8)}` : `FAIL ${login.status} ${JSON.stringify(login.json).slice(0, 200)}`);

  const after = await probe('AFTER-login', 990002);

  // 공유 클라이언트에 사용자 세션이 남아 있는지 직접 확인
  const sess = await (supabaseAdmin.auth as unknown as { getSession(): Promise<{ data: { session: unknown } }> }).getSession();
  const noSession = sess?.data?.session == null;
  console.log('shared supabaseAdmin.auth.getSession():', noSession ? 'null (오염 없음)' : `POLLUTED: ${JSON.stringify(sess.data.session).slice(0, 120)}`);

  // 정리 — 회원탈퇴 cascade
  const del = await inject('DELETE', '/api/me', token);
  const leftover = await supabaseAdmin.from('messages').select('id').eq('session_id', sessionId);
  console.log('cleanup: DELETE /api/me →', del.status, '/ leftover messages rows =', (leftover.data || []).length);

  await app.close();
  const pass = before && login.status === 200 && after && noSession && del.status === 200;
  console.log(pass ? '\n>>> RESULT: PASS — 로그인 후에도 공유 admin 클라이언트 오염 없음 (P0 수정 검증)' : '\n>>> RESULT: FAIL');
  process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
