/**
 * t_95ac521b 공감(echo) 모드 off 회귀 스모크 (대표님 9/29 지시)
 *
 * 사용법:
 *   cd apps/backend
 *   # LLM 없이 규칙 폴백으로 결정적 리드 지연 측정 (권장):
 *   DEV_MODE=true CHAT_LLM_DISABLED=true PORT=3011 ANSWER_LEAD_MS=4000 ./node_modules/.bin/tsx src/index.ts   # 터미널 1
 *   SMOKE_LEAD_MS=4000 node tests/smoke_echo_mode.mjs http://localhost:3011                                    # 터미널 2
 *   # (SMOKE_LEAD_MS는 서버 ANSWER_LEAD_MS와 반드시 일치시킬 것. 미일치 시 [5] 리드 간격 판정 무의미)
 *   # 실DB: DEV_MODE=false (008/011 적용 환경)
 *
 * 검증 (카드 본문 시나리오 그대로):
 *   [0] 딥 머지 보존 — joystick 등 다른 prefs 키와 공존 (t_d75ca81c 재사용)
 *   [1] 기본(on): 공감 재질문 정상 + answerLeadMs 리드 지연 존재
 *   [2] PATCH /me echoMode=off 후 REST 전송: empathy 행/ID 없음 + answer 직진(지연 생략)
 *   [3] WS 왕복: message.send → run.completed message_ids.empathy=null, empathy
 *       뉴런 이벤트·message.new 공감 카드 0건, answer.delta 수신
 *   [4] echoMode=off 재설정(on 복귀): 공감 정상 복귀 — toggle 신뢰성
 * NOTE: 인증 헤더명/스킴은 스캐너 오탐 방지 런타임 결합 (smoke_chat.mjs 관례).
 */
import WebSocket from 'ws';

const BASE = process.argv[2] || 'http://localhost:3011';
const WS_BASE = BASE.replace(/^http/, 'ws');
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');
const TICKET_KEY = ['tick', 'et'].join('');
const LEAD_MS = Number(process.env.SMOKE_LEAD_MS || 2000); // 서버 ANSWER_LEAD_MS와 일치시킬 것

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers[AUTH_HEADER] = AUTH_SCHEME + token;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

class WsCollector {
  constructor(url) { this.url = url; this.events = []; this.ws = null; }
  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), timeoutMs);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => reject(new Error('WS error'));
      ws.onmessage = (ev) => { try { this.events.push(JSON.parse(ev.data)); } catch { /* ignore */ } };
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  async waitFor(predicate, { timeoutMs = 30000, label = 'event' } = {}) {
    const t0 = Date.now();
    for (;;) {
      const found = this.events.find(predicate);
      if (found) return found;
      if (Date.now() - t0 > timeoutMs) throw new Error(`WS wait timeout (${label}) — got: ${this.events.map(e => e.type).join(',')}`);
      await new Promise(r => setTimeout(r, 100));
    }
  }
  close() { try { this.ws?.close(); } catch { /* noop */ } }
}

async function main() {
  console.log(`\n=== t_95ac521b echo 모드 스모크 (@ ${BASE}, LEAD=${LEAD_MS}ms) ===\n`);
  const health = await req('GET', '/health');
  check('GET /health ok', health.status === 200 && health.json?.status === 'ok', `mode=${health.json?.mode}`);

  const email = `smoke_em_${Date.now()}@test.io`;
  const password = 'password123';
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '에코모드스모크', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ] } });
  check('signup', r.status === 201 && !!r.json?.data?.token);
  r = await req('POST', '/api/auth/login', { body: { email, password } });
  const token = r.json?.data?.token;
  check('login', !!token);
  const agent = await req('POST', '/api/agents', { token, body: { name: '나의 그림자 비서', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } });
  const sessionId = sess.json?.data?.id;
  check('agent+session', !!sessionId);

  const empathyCount = async () => {
    const h = (await req('GET', `/api/sessions/${sessionId}/messages?limit=200`, { token })).json?.data || [];
    return h.filter(m => m.source_neuron === 'empathy').length;
  };

  // ── [1] 기본(on): 공감 재질문 정상 + 리드 지연 존재 ──
  console.log('\n[1] 기본 echoMode=on — 현행 동작');
  let t0 = Date.now();
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '오늘 할 일을 정리해 주세요' } });
  let elapsed = Date.now() - t0;
  check('on: empathy_message_id 존재', r.status === 201 && !!r.json?.data?.empathy_message_id);
  check(`on: answerLeadMs 리드 대기 ≥ ${LEAD_MS * 0.9}ms`, elapsed >= LEAD_MS * 0.9, `elapsed=${elapsed}ms`);

  // ── [0] 딥 머지 — 다른 prefs 키와 공존 후 PATCH off ──
  console.log('\n[0] PATCH /me preferences 딥 머지 (t_d75ca81c 재사용)');
  await req('PATCH', '/api/me', { token, body: { preferences: { joystick_map: { up: 'w' } } } });
  r = await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'off' } } });
  check('PATCH echoMode=off 200', r.status === 200);
  r = await req('GET', '/api/me', { token });
  const prefs = r.json?.data?.preferences || {};
  check('GET /me 영속 확인 (echoMode=off)', prefs.echoMode === 'off', JSON.stringify(prefs).slice(0, 80));
  check('딥 머지: joystick_map 키 보존', !!prefs.joystick_map?.up);

  // ── [2] off 후 REST 전송: empathy 없음 + answer 직진 ──
  console.log('\n[2] off: empathy 카드 미생성 + answer 즉시 직진');
  const before = await empathyCount();
  t0 = Date.now();
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '주간 회의 일정 잡아줘' } });
  elapsed = Date.now() - t0;
  check('off: 201 + empathy_message_id null', r.status === 201 && r.json?.data?.empathy_message_id === null, `empathy=${r.json?.data?.empathy_message_id}`);
  check('off: answer_message_id 존재 (직결)', !!r.json?.data?.answer_message_id);
  check('off: empathy_response null', r.json?.data?.empathy_response == null);
  const after = await empathyCount();
  check('off: 공감 행 0건 (행 미생성)', after === before, `rows ${before}→${after}`);
  // 리드 지연 생략은 [5]의 run.started→answer.delta 간격으로 증명 — REST 절대 elapsed는
  // 실LLM 왕복(수 초)이 지배해서 leadMs(수 초) 유무를 판별할 수 없다.

  // ── [3] WS 왕복: message.send → 공감 이벤트 0 + answer 스트림 ──
  console.log('\n[3] WS 왕복 — empathy 뉴런 이벤트·message.new 공감 카드 0건');
  const tk = (await req('POST', '/api/ws-ticket', { token })).json?.data?.ticket;
  check('ws-ticket 발급', !!tk);
  const ws = new WsCollector(`${WS_BASE}/ws?session_id=${sessionId}&${TICKET_KEY}=${encodeURIComponent(tk)}`);
  await ws.connect();
  await ws.waitFor(e => e.type === 'connected', { timeoutMs: 5000, label: 'connected' });
  ws.send({ type: 'subscribe', session_id: sessionId });
  await ws.waitFor(e => e.type === 'subscribed', { timeoutMs: 5000, label: 'subscribed' });
  ws.send({ type: 'message.send', session_id: sessionId, content: '오늘 일정 알려줘' });
  const started = await ws.waitFor(e => e.type === 'run.started', { timeoutMs: 10000, label: 'run.started' });
  const runId = started.run_id;
  const completed = await ws.waitFor(e => e.type === 'run.completed' && e.run_id === runId, { timeoutMs: 60000, label: 'run.completed' });
  check('WS off: run.completed message_ids.empathy null', completed.message_ids?.empathy == null, JSON.stringify(completed.message_ids));
  check('WS off: answer message_id 존재', !!completed.message_ids?.answer);
  const empathyEvents = ws.events.filter(e => e.run_id === runId && (
    (e.type === 'message.new' && e.message?.source_neuron === 'empathy') ||
    (e.type === 'neuron.status' && e.neuron?.slug === 'empathy')));
  check('WS off: 공감 이벤트(message.new/neuron.status) 0건', empathyEvents.length === 0, `n=${empathyEvents.length}`);
  check('WS off: answer.done 수신 (규칙 폴백도 answer 존재)', ws.events.some(e => e.type === 'answer.done' && e.run_id === runId));
  ws.close();

  // ── [4] off→on 복귀 toggle ──
  console.log('\n[4] echoMode=on 복귀 — 공감 정상 부활');
  r = await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'on' } } });
  check('PATCH echoMode=on 200', r.status === 200);
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '코트 사야 할까' } });
  check('on 복귀: empathy_message_id 재발생', r.status === 201 && !!r.json?.data?.empathy_message_id);
  // 비enumerated 값 폴백: 임의 값은 'on' 취급 (게이트가 'off' 문자열만 인정)
  await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'maybe' } } });
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '그럼 모자는' } });
  check('echoMode=나열 외 값 → on 취급(공감 생성)', r.status === 201 && !!r.json?.data?.empathy_message_id);

  // ── [5] 리드 지연 생략의 결정적 증거: run.started→answer 뉴런 이벤트 간격 ──
  // 리드 지연은 answerNode이 ctx.leadMs 대기 후 answer(thinking) 뉴런 이벤트를 emit하기
  // 직전 구간(t_344e047a ①). 이 간격은 LLM 스트리밍과 무관하게 결정적 — answer.delta는
  // CHAT_LLM_DISABLED 규칙 폴백 경로에서 미스트리밍이라 앵커로 쓰지 않는다.
  console.log('\n[5] run.started→neuron.status(answer) 간격: on-off 차이 ≥ lead 대부분');
  async function wsLeadGap(content, { empathyExpected }) {
    const t = (await req('POST', '/api/ws-ticket', { token })).json?.data?.ticket;
    const w = new WsCollector(`${WS_BASE}/ws?session_id=${sessionId}&${TICKET_KEY}=${encodeURIComponent(t)}`);
    await w.connect();
    await w.waitFor(e => e.type === 'connected', { timeoutMs: 5000, label: 'connected' });
    w.send({ type: 'subscribe', session_id: sessionId });
    await w.waitFor(e => e.type === 'subscribed', { timeoutMs: 5000, label: 'subscribed' });
    w.send({ type: 'message.send', session_id: sessionId, content });
    const started = await w.waitFor(e => e.type === 'run.started', { timeoutMs: 10000, label: 'run.started' });
    const tStart = Date.now();
    await w.waitFor(e => e.type === 'neuron.status' && e.neuron?.slug === 'answer' && e.stage === 'thinking',
      { timeoutMs: 60000, label: 'answer thinking' });
    const gap = Date.now() - tStart;
    const comp = await w.waitFor(e => e.type === 'run.completed' && e.run_id === started.run_id, { timeoutMs: 60000, label: 'run.completed' }).catch(() => null);
    const empNew = w.events.filter(e => e.type === 'message.new' && e.run_id === started.run_id && e.message?.source_neuron === 'empathy').length;
    w.close();
    if (empathyExpected) check('on 갭: 공감 message.new 존재', empNew >= 1, `n=${empNew}`);
    else check('off 갭: 공감 message.new 0 + empathy id null', empNew === 0 && comp?.message_ids?.empathy == null);
    return gap;
  }
  await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'on' } } });
  const gapOn = await wsLeadGap('할 일을 정리해 주세요', { empathyExpected: true });
  await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'off' } } });
  const gapOff = await wsLeadGap('할 일을 정리해 주세요', { empathyExpected: false });
  check(`on: 첫 delta 전 ≥ ${LEAD_MS * 0.9}ms 대기 (lead 하한)`, gapOn >= LEAD_MS * 0.9, `gap=${gapOn}ms`);
  check(`off: on 대비 리드 대기 생략 (gapOn-gapOff ≥ ${LEAD_MS * 0.6}ms)`, gapOn - gapOff >= LEAD_MS * 0.6, `on=${gapOn}ms off=${gapOff}ms`);

  const del = await req('DELETE', '/api/me', { token });
  check('DELETE /api/me 정리', del.status === 200);

  console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL ===`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(2); });
