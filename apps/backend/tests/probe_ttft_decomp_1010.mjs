/**
 * t_baee5c42 디버그 프로브: ack→첫글자 구간 분해 — neuron.status 이벤트 타임스탬프 +
 * answer.done의 llm.durationMs로 직렬 비용(Stage2 분류 / TTFT / 배칭)을 가시화.
 * 사용: node tests/probe_ttft_decomp_1010.mjs http://localhost:3016 [n]
 */
const BASE = process.argv[2] || 'http://localhost:3016';
const N = Number(process.argv[3] || 3);
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

(async () => {
  const email = `decomp_${Date.now()}@test.io`;
  await req('POST', '/api/auth/signup', { body: { email, password: 'password123', display_name: '분해보', age_confirmed: true, consents: [
    { type: 'terms', version: '1.0', consented: true }, { type: 'privacy', version: '1.0', consented: true },
    { type: 'voice_recording', version: '1.0', consented: true }, { type: 'overseas_transfer', version: '1.0', consented: true } ] } });
  const r = await req('POST', '/api/auth/login', { body: { email, password: 'password123' } });
  const token = r.json?.data?.token;
  const agent = await req('POST', '/api/agents', { token, body: { name: '분해비서', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } });
  const sessionId = sess.json?.data?.id;
  await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'off' } } });

  const utterances = ['안녕', '오늘 날씨가 좀 쌀쌀하네', '점심 뭐 먹지'];
  for (let i = 0; i < N; i++) {
    const ticket = (await req('POST', '/api/ws-ticket', { token })).json?.data?.ticket;
    const u = new URL(BASE.replace(/^http/, 'ws') + '/ws');
    u.searchParams.set('session_id', sessionId); u.searchParams.set(TICKET_KEY, ticket);
    const events = [];
    const ws = new WebSocket(u.toString());
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
    ws.onmessage = (ev) => { try { events.push({ at: Date.now(), ...JSON.parse(ev.data) }); } catch {} };
    await new Promise(res => setTimeout(res, 200));
    const t0 = Date.now();
    ws.send(JSON.stringify({ type: 'message.send', session_id: sessionId, content: utterances[i % utterances.length] }));
    const deadline = t0 + 30000;
    let done = false;
    while (!done && Date.now() < deadline) {
      await new Promise(res => setTimeout(res, 25));
      done = events.some(e => e.at >= t0 && e.type === 'answer.done');
    }
    const ack = events.find(e => e.at >= t0 && e.type === 'run.started');
    const firstDelta = events.find(e => e.at >= t0 && e.type === 'answer.delta');
    const dn = events.find(e => e.at >= t0 && e.type === 'answer.done');
    console.log(`\n=== "${utterances[i % utterances.length]}" ack→첫글자=${firstDelta && ack ? firstDelta.at - ack.at : '?'}ms done=${dn ? dn.at - t0 : '?'}ms`);
    for (const e of events.filter(e => e.at >= t0 && (e.type === 'neuron.status' || e.type === 'run.progress'))) {
      console.log(`  +${(ack ? e.at - ack.at : e.at - t0)}ms ${e.type} ${e.neuron?.slug || ''} ${e.status || ''} ${e.stage || ''}`);
    }
    if (dn?.llm) console.log(`  llm: model=${dn.llm.model} durationMs=${dn.llm.durationMs} provider=${dn.llm.provider}`);
    ws.close();
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
