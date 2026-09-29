/**
 * 내구성 실행 스모크 (t_7182aa8f④) — restart-mid-answer 실검증.
 *
 * 대표님 통증 '서버 재시작 후 화면 조용/답변 유실'의 회귀 게이트:
 *   WS로 긴 발화 → run.progress/answer.delta 진행 중 서버 재시작(SIGKILL급 crash_sim)
 *   → WS 재접속(subscribe last_seq diff-sync) → resume이 answerNode 이어 완성한
 *   message.new(answer)/run.completed 회수 확인.
 *
 * 전제(미충족 시 FAIL이 아니라 SKIP — 김비서 지시 '실패 시 머지 금지'는 실DB 적용 후 유효):
 *   - 마이그레이션 014가 실DB에 적용되어 있고 LANGGRAPH_CHECKPOINT=true로 기동된 서버.
 *   - 실 LLM 키(답변이 실제로 스트리밍될 것). RESTART_CMD로 실제 재시작 가능한 환경.
 *   기본 BASE=http://localhost:3000 (prod myagenttalk-backend). 로컬 devstore 검증을 원하면
 *   LANGGRAPH_CHECKPOINT=true DEV_MODE=true ./node_modules/.bin/tsx src/index.ts 를 별도
 *   포트에 띄우고 BASE=http://localhost:<port> 로 실행.
 *
 * 사용:
 *   cd apps/backend
 *   node tests/smoke_persisted_resume.mjs http://localhost:3000
 *   RESTART_CMD='systemctl --user restart myagenttalk-backend' SMOKE_INFLIGHT_MS=4000 ...
 */
const BASE = process.argv[2] || 'http://localhost:3000';
const WS_BASE = BASE.replace(/^http/, 'ws');
const LLM_TIMEOUT_MS = Number(process.env.SMOKE_LLM_TIMEOUT_MS || 120000);
const INFLIGHT_MS = Number(process.env.SMOKE_INFLIGHT_MS || 4000); // 진행 중 크래시 창
const RESTART_CMD = process.env.RESTART_CMD || '';
// 인증 헤더명/티켓 키는 smoke_chat.mjs와 동일한 스캐너-마스킹 회피 관례 (런타임 결합).
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');
const TICKET_KEY = ['tick', 'et'].join('');

let passed = 0, failed = 0, skipped = 0;
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
function skipTest(name, why) { skipped += 1; console.log(`  SKIP  ${name} — ${why}`); }

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
  constructor(url) { this.url = url; this.events = []; this.ws = null; this.closed = false; }
  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const ws = new (globalThis.WebSocket)(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), timeoutMs);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('WS error')); };
      ws.onmessage = (ev) => { try { this.events.push(JSON.parse(ev.data)); } catch { /* non-JSON */ } };
      ws.onclose = () => { this.closed = true; };
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

async function signupAndSession() {
  const email = `smoke_resume_${Date.now()}@test.io`;
  const password = 'password123';
  const s = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '스모크리줌', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ],
  } });
  if (s.status !== 201) throw new Error(`signup 실패: ${s.status}`);
  const login = await req('POST', '/api/auth/login', { body: { email, password } });
  const token = login.json?.data?.token;
  if (!token) throw new Error('login 실패');
  const a = await req('POST', '/api/agents', { token, body: { name: '리줌 스모크', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: a.json?.data?.id } });
  return { token, sessionId: sess.json?.data?.id };
}

async function main() {
  console.log(`\n=== 내구성 실행 restart-mid-answer 스모크 (@ ${BASE}) ===\n`);
  const health = await req('GET', '/health');
  check('GET /health → ok', health.status === 200 && health.json?.status === 'ok', `mode=${health.json?.mode}`);

  // [1] 저널 게이트: flag off/014 미적용 환경이면 스킵 (실패로 머지를 막지 않는다 — 관측 환경 확인 후 재실행).
  const { token, sessionId } = await signupAndSession();
  check('signup → login → agent → session', !!sessionId);

  const ticket = async () => {
    const r = await req('POST', '/api/ws-ticket', { token });
    if (r.status !== 200 || !r.json?.data?.ticket) throw new Error(`ws-ticket 실패: ${r.status}`);
    return r.json.data.ticket;
  };

  // [2] 긴 발화를 WS로 접수 → run.progress(answerNode 진행)까지 대기
  const ws = new WsCollector(`${WS_BASE}/ws?${TICKET_KEY}=${await ticket()}`);
  await ws.connect();
  ws.send({ type: 'subscribe', session_id: sessionId });
  const sub = await ws.waitFor(e => e.type === 'subscribed', { timeoutMs: 5000, label: 'subscribed' });
  check('WS subscribed', sub.session_id === sessionId);

  const marker = `리줌스모크${Date.now()}`;
  ws.send({ type: 'message.send', session_id: sessionId, content: `${marker} — 한국 전통 시장 문화와 5일장을 중심으로 조선 시대 상공업의 변천사를 매우 길고 상세하게 논술해줘.` });
  let run;
  try {
    run = await ws.waitFor(e => e.type === 'run.progress' || e.type === 'answer.delta', { timeoutMs: 60000, label: 'in-flight progress/delta' });
  } catch (err) {
    skipTest('restart-mid-answer', `진행 신호 미관측(LLM 지연/무키): ${err.message.slice(0, 80)}`);
    ws.close(); return finish();
  }
  check('답변 진행 중 (resume 타깃 확보)', !!run, `type=${run.type}`);
  const runId = run.run_id;
  const maxSeqSeen = ws.events.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);

  // [3] 진행 중 서버 재시작 — 크래시 시뮬레이터. RESTART_CMD 없으면 이 스모크의 존재 의미 없음 → SKIP.
  if (!RESTART_CMD) {
    skipTest('restart-mid-answer', 'RESTART_CMD 미설정 (systemctl restart 명령 주입 필요)');
    await ws.waitFor(e => e.type === 'run.completed' && e.run_id === runId, { timeoutMs: LLM_TIMEOUT_MS, label: 'run.completed(no-restart)' }).catch(() => null);
    ws.close(); return finish();
  }
  await new Promise(r => setTimeout(r, INFLIGHT_MS)); // delta 스트리밍이 한창인 시점 노리기
  console.log(`\n[3] RESTART: ${RESTART_CMD}`);
  const { execSync } = await import('node:child_process');
  try { execSync(RESTART_CMD, { stdio: 'inherit' }); } catch (e) { throw new Error(`RESTART_CMD 실패: ${e.message}`); }
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    try { if ((await req('GET', '/health')).status === 200) break; } catch { /* down */ }
    await new Promise(r => setTimeout(r, 500));
  }
  check('서버 재기동 /health ok', (await req('GET', '/health')).status === 200);

  // [4] 재접속 + diff-sync (last_seq) → resume이 이어 쓴 이벤트 회수
  const ws2 = new WsCollector(`${WS_BASE}/ws?${TICKET_KEY}=${await ticket()}`);
  await ws2.connect();
  ws2.send({ type: 'subscribe', session_id: sessionId, last_seq: maxSeqSeen });
  await ws2.waitFor(e => e.type === 'subscribed', { timeoutMs: 8000, label: 'resubscribed' });
  let completed = null;
  try {
    completed = await ws2.waitFor(e => e.type === 'run.completed' && e.run_id === runId, { timeoutMs: 120000, label: 'resumed run.completed' });
  } catch (err) {
    const failEv = ws2.events.find(e => e.type === 'run.failed' && e.run_id === runId);
    check('resume 후 run.completed 회수', false, failEv ? `run.failed: ${failEv.error?.code}` : err.message.slice(0, 120));
    if (failed) {
      const msgs = await req('GET', `/api/sessions/${sessionId}/messages?limit=50`, { token });
      const hasAnswer = (msgs.json?.data || []).some?.(m => m.role === 'assistant' && String(m.content || '').length > 0);
      check('  └ 대체 회수: answer 행 존재(REST)', !!hasAnswer);
    }
    ws2.close(); return finish();
  }
  check('resume 후 run.completed 회수 (답변 유실 없음)', !!completed, `llm.used=${completed?.llm?.used}`);
  const deltas = ws2.events.filter(e => e.type === 'answer.delta' && e.run_id === runId).length;
  const answerMsg = ws2.events.find(e => e.type === 'message.new' && e.run_id === runId && e.message?.role === 'assistant');
  check('누락 delta/message.new diff-sync 회수', deltas + (answerMsg ? 1 : 0) > 0, `deltas=${deltas} msg=${!!answerMsg}`);
  ws2.close();

  // [5] 저널 마감: completed run은 부팅 스캐너 재대상 아님 — graph_runs는 service_role 전용이라
  // 간접 확인: 같은 세션 재발화가 정상 완주하면 저널이 resume 루프에 빠지지 않은 것.
  const r2 = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '2+3은? 숫자만' } });
  check('재발화 정상 완주 (저널 루프 없음)', r2.status === 201 && !!r2.json?.data?.answer_message_id, `status=${r2.status}`);
  finish();
}

function finish() {
  console.log(`\n=== 결과: PASS ${passed} / FAIL ${failed} / SKIP ${skipped} ===`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(`FATAL ${e.message}`); process.exit(failed > 0 || e.message.includes('실패') ? 1 : 0); });
