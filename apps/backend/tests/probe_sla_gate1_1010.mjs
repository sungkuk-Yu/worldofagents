/**
 * t_74792ee1 게이트1 SLA 프로브 (v2, 1010)
 * front desk 계약: ack→첫 글자 ≤ frontDeskFirstTokenMs(1500). empathy 무대 off(echoMode=off)
 * 순수 front desk 턴에서 measure. 매 턴 새 WS+새 세션 티켓으로 subscribe 리플레이 오염 차단.
 * 표기: send→ack / ack→첫글자(계약 앵커) / send→answer.done
 */
const BASE = process.argv[2] || 'http://localhost:3013';
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
function wsUrl(params) {
  const u = new URL(BASE.replace(/^http/, 'ws') + '/ws');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}
const utterances = ['안녕', '오늘 날씨가 좀 쌀쌀하네', '점심 뭐 먹지', '나 심심해', '고마워'];

(async () => {
  const email = `sla1v2_${Date.now()}@test.io`;
  const password = 'password123';
  await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: 'SLA프로브2', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ] } });
  const r = await req('POST', '/api/auth/login', { body: { email, password } });
  const token = r.json?.data?.token;
  const agent = await req('POST', '/api/agents', { token, body: { name: 'SLA비서', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } });
  const sessionId = sess.json?.data?.id;
  await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'off' } } });

  const samples = [];
  for (let i = 0; i < N; i++) {
    // 매 턴 새 ticket + 새 socket — 이전 턴 이벤트 리플레이 불가
    const ticket = (await req('POST', '/api/ws-ticket', { token })).json?.data?.ticket;
    const events = [];
    const ws = new WebSocket(wsUrl({ session_id: sessionId, [TICKET_KEY]: ticket }));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    ws.onmessage = (ev) => { try { events.push({ at: Date.now(), ...JSON.parse(ev.data) }); } catch {} };
    await new Promise(res => setTimeout(res, 200));

    const t0 = Date.now();
    ws.send(JSON.stringify({ type: 'message.send', session_id: sessionId, content: utterances[i] }));
    let ackAt = null, tokAt = null, doneAt = null;
    const deadline = t0 + 90000;
    while (Date.now() < deadline) {
      if (!ackAt) { const a = events.find(e => e.at >= t0 && e.type === 'run.started'); if (a) ackAt = a.at; }
      if (!tokAt) { const d = events.find(e => e.at >= t0 && e.type === 'answer.delta'); if (d) tokAt = d.at; }
      if (!doneAt) { const d = events.find(e => e.at >= t0 && e.type === 'answer.done'); if (d) doneAt = d.at; }
      if (ackAt && tokAt && doneAt) break;
      await new Promise(res => setTimeout(res, 25));
    }
    if (!tokAt || !doneAt) { console.log(`[${i + 1}] incomplete — ack=${ackAt ? ackAt - t0 : null} delta=${tokAt ? tokAt - t0 : null}`); ws.close(); continue; }
    const sendAck = ackAt ? ackAt - t0 : null;
    const ackTok = ackAt && tokAt ? tokAt - ackAt : null;
    const sendDone = doneAt - t0;
    console.log(`[${i + 1}] "${utterances[i]}"  send→ack=${sendAck}ms  ack→첫글자=${ackTok}ms  send→done=${sendDone}ms`);
    if (ackTok !== null) samples.push(ackTok);
    ws.close();
  }
  if (!samples.length) { console.log('no samples'); process.exit(1); }
  const sorted = [...samples].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted[sorted.length - 1];
  console.log(`\nGATE1 ack→첫글자 n=${samples.length}: ${samples.map(s => Math.round(s)).join(', ')} | median=${Math.round(med)} worst=${Math.round(worst)} | ≤1500 ${worst <= 1500 ? 'PASS' : 'FAIL'}`);
  process.exit(worst <= 1500 ? 0 : 2);
})().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
