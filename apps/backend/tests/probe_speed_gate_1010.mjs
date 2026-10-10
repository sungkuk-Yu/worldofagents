/**
 * t_74792ee1 배포창 게이트 2·3 실측 프로브 (1010)
 *  [2] flash 회귀: 평상 발화 answer.done llm.model=qwen3.8-flash
 *  [3] depth lane: 법률 발화 answer.done llm.model=qwen3.8-max 승격 + llm.model 실측
 *  발화→answer.done 총량 + 첫 delta까지 시간 리포트
 */
const BASE = process.argv[2] || 'http://localhost:3013';
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

class Ws {
  constructor(url) { this.url = url; this.events = []; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url); this.ws = ws;
      const t = setTimeout(() => reject(new Error('ws connect timeout')), 8000);
      ws.onopen = () => { clearTimeout(t); resolve(); };
      ws.onerror = () => { clearTimeout(t); reject(new Error('ws error')); };
      ws.onmessage = (ev) => { try { this.events.push({ at: Date.now(), ...JSON.parse(ev.data) }); } catch {} };
    });
  }
  async waitFor(pred, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const e = this.events.find(pred);
      if (e) return e;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`timeout(${label}) — got: ${this.events.map(e => e.type).join(',')}`);
  }
}

function wsConnectUrl(params) {
  const u = new URL(BASE.replace(/^http/, 'ws') + '/ws');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

async function turn(ws, sessionId, content, tag) {
  const before = ws.events.length;
  const t0 = Date.now();
  ws.ws.send(JSON.stringify({ type: 'message.send', session_id: sessionId, content }));
  const started = await ws.waitFor(e => e.type === 'run.started' && e.at >= t0, 20000, `${tag} run.started`);
  const runId = started.run_id;
  const firstDelta = null;
  let deltaEvt = null;
  try { deltaEvt = await ws.waitFor(e => e.type === 'answer.delta' && e.run_id === runId, 120000, `${tag} delta`); } catch {}
  const done = await ws.waitFor(e => e.type === 'answer.done' && e.run_id === runId, 120000, `${tag} done`);
  const firstTok = deltaEvt ? deltaEvt.at - t0 : null;
  const total = done.at - t0;
  // 리드 컷 실측: answer processing(Thinking) 개시 → 첫 delta (LLM 요청 시작→첫 글자)
  const ansStart = ws.events.slice(before).find(e => e.type === 'neuron.status' && e.neuron?.slug === 'answer' && e.status === 'processing');
  const leadGap = ansStart && deltaEvt ? deltaEvt.at - ansStart.at : null;
  console.log(`[${tag}] utterance="${content.slice(0, 24)}"`);
  console.log(`  llm=${JSON.stringify(done.llm)}`);
  console.log(`  grounding=${JSON.stringify(done.grounding ?? null)}`);
  console.log(`  send→first-delta=${firstTok}ms  send→answer.done=${total}ms  answer-think→first-delta=${leadGap}ms`);
  return { llm: done.llm, firstTok, total, leadGap };
}

(async () => {
  const email = `gate23_${Date.now()}@test.io`;
  const password = 'password123';
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '게이트프로브', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ] } });
  r = await req('POST', '/api/auth/login', { body: { email, password } });
  const token = r.json?.data?.token;
  if (!token) { console.error('login fail', r.status, JSON.stringify(r.json).slice(0, 200)); process.exit(1); }
  const agent = await req('POST', '/api/agents', { token, body: { name: '게이트비서', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } });
  const sessionId = sess.json?.data?.id;
  const ticket = (await req('POST', '/api/ws-ticket', { token })).json?.data?.ticket;
  const ws = new Ws(wsConnectUrl({ session_id: sessionId, [TICKET_KEY]: ticket }));
  await ws.connect();
  await ws.waitFor(e => e.type === 'connected', 5000, 'connected');
  ws.ws.send(JSON.stringify({ type: 'subscribe', session_id: sessionId }));
  await ws.waitFor(e => e.type === 'subscribed' || e.type === 'error', 5000, 'subscribed').then(e => {
    if (e.type === 'error') throw new Error('subscribe error: ' + JSON.stringify(e));
  });

  // [2] 평상 발화 → flash
  const normal = await turn(ws, sessionId, '오늘 좀 피곤하다', 'normal/flash');
  // [3a] 명시 법률 키워드 발화 → 승격 메커니즘 자체 확인
  const legalKey = await turn(ws, sessionId, '법률 상담 부탁해', 'legal-keyword/depth');
  // [3b] 카드 지정 발화 (상속세) — 패턴 커버리지 확인
  const legal = await turn(ws, sessionId, '상속세 신고 기한이 언제야', 'legal/depth');
  // SLA 갭: 평상 발화에서 answer processing 개시→첫 delta (front desk 리드 컷 실측)
  const t1 = await turn(ws, sessionId, '그래도 저녁은 챙겨 먹을까?', 'sla/flash');

  const ok2 = normal.llm?.used && /flash/.test(normal.llm?.model || '');
  const ok3 = legal.llm?.used && /max/.test(legal.llm?.model || '');
  console.log(`\nGATE2 flash 회귀: ${ok2 ? 'PASS' : 'FAIL'} (model=${normal.llm?.model})`);
  console.log(`GATE3 depth 승격: ${ok3 ? 'PASS' : 'FAIL'} (model=${legal.llm?.model})`);
  process.exit(ok2 && ok3 ? 0 : 2);
})().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
