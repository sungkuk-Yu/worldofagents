/**
 * t_c956e3ee — bt/t_2133e4fc(c189b60a) 음성 user 발화 선방송 계약 프로토콜 실측 (frонт 수신 관점).
 * 백엔드(:3155, DEV_MODE)에 WS로 transcript 프레임을 넣고, 프론트가 소비하는 이벤트 흐름을 기록해
 * 다음 수락기준을 판정한다:
 *  A. message.new(user)가 run.completed보다 먼저 도착 (선방송)
 *  B. 이벤트 순서: transcript.final ≲ message.new(user) < run.started (불변식)
 *  C. user message.new는 정확히 1회 (중복 발행 0 — persistedUser 재발행 금지 봉인)
 *  D. transcript.final.message_id == message.new(user).id (id 안정성 = 프론트 dedup 성립)
 *  E. 후속 answer message.new/ run.completed 정상 종결 (턴 자체는 살아간다)
 * 사용법: node ws_early_probe.cjs [http://localhost:3155]
 */
const BASE = process.argv[2] || 'http://localhost:3155';
const WS_BASE = BASE.replace(/^http/, 'ws');
const TEXT = '오늘 일정 알려줘';

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

(async () => {
  const email = `c956_${Date.now()}@test.io`;
  let r = await req('POST', '/api/auth/signup', { body: { email, password: 'Voice1234!', display_name: 'c956', age_confirmed: true, consents: [
    { type: 'terms', version: '1.0', consented: true },
    { type: 'privacy', version: '1.0', consented: true },
    { type: 'voice_recording', version: '1.0', consented: true },
    { type: 'overseas_transfer', version: '1.0', consented: true },
  ] } });
  const token = r.json?.data?.token;
  check('signup', !!token, `status=${r.status}`);

  r = await req('GET', '/api/agents', { token });
  const agents = r.json?.data?.agents || r.json?.data || [];
  let agentId = Array.isArray(agents) && agents[0]?.id;
  if (!agentId) {
    r = await req('POST', '/api/agents', { token, body: { name: 'c956파트너' } });
    agentId = r.json?.data?.id;
  }
  check('agent 확보', !!agentId);

  r = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agentId } });
  const sessionId = r.json?.data?.id || r.json?.data?.session_id;
  check('session ensure', !!sessionId, `status=${r.status}`);

  const tr = await req('POST', '/api/ws-ticket', { token, body: {} });
  const ticket = tr.json?.data?.ticket;
  if (!ticket) { console.error('WS ticket fail:', JSON.stringify(tr.json)); process.exit(1); }

  const events = [];
  const t0 = Date.now();
  const ws = new WebSocket(`${WS_BASE}/ws?session_id=${sessionId}&ticket=${ticket}`);
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const done = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('WS timeout 120s')); }, 120000);
    ws.onopen = () => send({ type: 'subscribe', session_id: sessionId, last_seq: 0 });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'connected') { send({ type: 'transcript', session_id: sessionId, text: TEXT, is_final: true }); return; }
      if (['transcript.final', 'message.new', 'run.started', 'run.progress', 'run.completed', 'run.failed', 'answer.delta', 'answer.done', 'queue.update', 'error'].includes(msg.type)) {
        events.push({ t: Date.now() - t0, ...msg });
      }
      if (msg.type === 'run.completed' || msg.type === 'run.failed' || msg.type === 'error') {
        clearTimeout(timer); setTimeout(() => { ws.close(); resolve(); }, 800);
      }
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error('WS error ' + (e?.message || ''))); };
  }).catch((e) => { console.error('WS fail:', String(e)); return false; });
  if (done === false) process.exit(1);

  const userNews = events.filter((e) => e.type === 'message.new' && e.message?.role === 'user');
  const finals = events.filter((e) => e.type === 'transcript.final');
  const runStarted = events.find((e) => e.type === 'run.started');
  const runCompleted = events.find((e) => e.type === 'run.completed');
  const runFailed = events.find((e) => e.type === 'run.failed');
  const agentNews = events.filter((e) => e.type === 'message.new' && e.message?.role !== 'user');

  console.log('\n  ── 이벤트 스트림 (type@tms) ──');
  for (const e of events) console.log(`   ${String(e.t).padStart(6)}ms  ${e.type}${e.message ? ` [${e.message.role}:${String(e.message.id).slice(0, 8)}]` : ''}${e.run_id ? ` run=${String(e.run_id).slice(0, 8)}` : ''}`);
  console.log('');

  check('A. message.new(user)가 run.completed보다 먼저 (선방송)', userNews.length > 0 && runCompleted ? userNews[0].t < runCompleted.t : userNews.length > 0 && runFailed ? true : false,
    `user@${userNews[0]?.t}ms vs completed@${runCompleted?.t}ms`);
  check('B. message.new(user) < run.started 불변식', userNews.length > 0 && runStarted ? userNews[0].t <= runStarted.t : !!userNews.length,
    `user@${userNews[0]?.t}ms vs started@${runStarted?.t}ms`);
  check('C. user message.new 정확히 1회', userNews.length === 1, `count=${userNews.length}`);
  check('D. transcript.final.message_id == user 행 id', finals.length > 0 && userNews.length > 0 && finals[0].message_id === userNews[0].message?.id,
    `final=${finals[0]?.message_id?.slice(0, 8)} user=${userNews[0]?.message?.id?.slice(0, 8)}`);
  check('E. 턴 종결 (run.completed + answer 카드)', !!runCompleted && agentNews.length > 0, `answerNews=${agentNews.length} failed=${!!runFailed}`);
  check('F. transcript.final text = 발화 원문', finals[0]?.text === TEXT);
  check('G. user content = 발화 원문(프론트 카드 렌더 소재)', userNews[0]?.message?.content === TEXT);

  console.log(`\nRESULT ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})();
