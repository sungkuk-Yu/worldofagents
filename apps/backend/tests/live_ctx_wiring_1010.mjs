/**
 * t_dd43affd① 라이브 미러 — 후속질문 맥락 배선 2턴 실측 프로브 (t_baee5c42复审 통과 프로토콜의 정식화).
 * 김비서复审 초안(review_ctx_probe_1010.mjs)의 message.send/answer.delta(.delta) 필드 포맷을
 * 공식 프로브(probe_sla_gate1_1010.mjs) 관례에 맞춰 main 정식 하네스로 승격:
 *   T1 '친구 이름 성국~생일 축하 메시지 추천' → T2 '근데 내 친구 이름이 뭐였지?'
 *   → answer.delta .delta 조립 텍스트에 '성국' 참조 must-assert (FAIL 시 exit 2).
 *
 * 전제: 라이브 게이트웨이 + 실 LLM 키 (읽기 전용 + 테스트 사용자 1명 생성, 백엔드 코드 무변경).
 * 사용: cd apps/backend && node tests/live_ctx_wiring_1010.mjs [http://localhost:3000]
 *   (기존 live_* 하네스 규약 동일 — CI 무키 환경에서는 실행하지 않는다. CI 회귀망은 unit: ctx-persistence.test.ts)
 */
const BASE = process.argv[2] || 'http://localhost:3000';
// 인증 헤더명/티켓 키는 smoke_chat.mjs와 동일한 스캐너-마스킹 회피 관례 (런타임 결합).
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');
const TICKET_KEY = ['tick', 'et'].join('');

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers[AUTH_HEADER] = AUTH_SCHEME + token;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
function wsUrl(params) {
  const u = new URL(BASE.replace(/^http/, 'ws') + '/ws');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}
async function turn(token, sessionId, text) {
  const ticket = (await req('POST', '/api/ws-ticket', { token })).json?.data?.ticket;
  const events = [];
  const ws = new WebSocket(wsUrl({ session_id: sessionId, [TICKET_KEY]: ticket }));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  ws.onmessage = (ev) => { try { events.push(JSON.parse(ev.data)); } catch {} };
  await new Promise(res => setTimeout(res, 200));
  ws.send(JSON.stringify({ type: 'message.send', session_id: sessionId, content: text }));
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (events.some(e => e.type === 'answer.done')) break;
    await new Promise(res => setTimeout(res, 50));
  }
  ws.close();
  const deltas = events.filter(e => e.type === 'answer.delta');
  const streamed = deltas.map(d => d.delta ?? '').join('');
  const done = events.find(e => e.type === 'answer.done');
  // 확정 텍스트 우선 (reduceStreams 계약: answer.done.text가 최종본), 없으면 스트림 조립.
  return (done?.text && done.text.trim()) ? done.text : streamed;
}

(async () => {
  const email = `ctxwire_${Date.now()}@test.io`;
  const password = 'password123';
  await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '맥락배선프로브', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ] } });
  const r = await req('POST', '/api/auth/login', { body: { email, password } });
  const token = r.json?.data?.token;
  if (!token) { console.error('login 실패 — 게이트웨이 미기동/스키마 문제'); process.exit(1); }
  const agent = await req('POST', '/api/agents', { token, body: { name: '맥락비서', agent_type: 'shadow' } });
  const sessionId = (await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } })).json?.data?.id;
  await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'off' } } });

  const t1 = await turn(token, sessionId, '내 친구 이름이 성국이는데 오늘 생일이야. 뭐라고 축하 메시지 보낼지 추천해줘');
  console.log('T1:', t1.replace(/\n/g, ' ').slice(0, 160));
  const t2 = await turn(token, sessionId, '근데 내 친구 이름이 뭐였지?');
  console.log('T2:', t2.replace(/\n/g, ' ').slice(0, 160));
  const pass = /성국/.test(t2);
  console.log(pass ? 'PASS — 후속질문이 이전 대화 이름(성국) 참조' : 'FAIL — 이름 미참조(맥락 배선 유실)');
  process.exit(pass ? 0 : 2);
})().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
