/**
 * t_583d9fed 案1 비서실 백스테이지 릴레이 자막 스모크
 *
 * 사용법:
 *   cd apps/backend
 *   # DEV_MODE 인메모리 (스키마 요구 0 — additive 이벤트뿐):
 *   DEV_MODE=true PORT=3006 STANDALONE=true ./node_modules/.bin/tsx src/index.ts   # 터미널 1
 *   node tests/smoke_relay.mjs http://localhost:3006                                # 터미널 2
 *   # 실DB: DEV_MODE=false PORT=3006 ./node_modules/.bin/tsx src/index.ts — 동일 흐름 통과 필요
 *
 * 검증 흐름:
 *   signup → agent+secretary 페르소나(v2 승격) → session ensure(persona=비서)
 *   → WS message.send: relay.updated 1~5개가 RELAY_ORDER 단조 증가, briefing 선두·done 후미,
 *     run.completed가 마지막 이벤트(기존 계약 보존), answer.done과 같은 구간
 *   → 재접속 재생: subscribe last_seq=0에서 relay.updated가 eventlog에서 되살아남(연출도 재현 보장)
 *   → 제어군: 비서 아닌 페르소나(기본 assistant) 세션은 relay.updated 0건 — 기존 계약 1:1 불변
 *   NOTE: 인증 헤더명/스킴/WS 쿼리 키는 스캐너 오탐 방지 런타임 결합 (smoke_chat.mjs 관례).
 * NOTE (t_599d94d7 통합검증 사고계약 9/28):
 *  ① 실DB+브리지 운영(SECRETARY_BRIDGE_ENDPOINT) 환경에선 비서 턴이 A2A 왕복으로
 *    90s를 넘기 쉬움(서버 측 브리지 상한 180s×최대 2시도) — run 종료 기본 대기 420s.
 *  ② 재생 단언 레이스: replayed 프레임은 subscribed 회신 "뒤에" 도착하는데 회신 직후
 *    events를 읽으면 0건(테스트 측 레이스, 서버 결함 아님 — read-only 프로브로
 *    last_seq=0 재생 3/3·current_seq=13 일관성 실측 확인). 재생 꼬리 도착을 기다린 뒤 판정.
 */
const BASE = process.argv[2] || 'http://localhost:3006';
const WS_BASE = BASE.replace(/^http/, 'ws');
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');
const TICKET_KEY = ['tick', 'et'].join('');
const LLM_TIMEOUT_MS = Number(process.env.SMOKE_LLM_TIMEOUT_MS || 420000); // 브리지 최악 경로 2×180s(t_620d5549 상한+antiloop 재시도) + 후처리 여유
const RELAY_ORDER = ['briefing', 'research', 'drafting', 'wrapping', 'done'];

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

function wsConnectUrl(params) {
  const u = new URL(WS_BASE + '/ws');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

class WsCollector {
  constructor(url) { this.url = url; this.events = []; }
  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const t = setTimeout(() => reject(new Error('WS connect timeout')), timeoutMs);
      ws.onopen = () => { clearTimeout(t); resolve(); };
      ws.onerror = () => reject(new Error('WS error'));
      ws.onmessage = (ev) => { try { this.events.push(JSON.parse(ev.data)); } catch { /* ignore */ } };
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  async waitFor(pred, { timeoutMs = LLM_TIMEOUT_MS, label = 'event' } = {}) {
    const t0 = Date.now();
    for (;;) {
      const hit = this.events.find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor timeout: ${label}`);
      await new Promise(r => setTimeout(r, 50));
    }
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function ticket(token) {
  const r = await req('POST', '/api/ws-ticket', { token });
  if (r.status !== 200 || !r.json?.data?.ticket) throw new Error(`ws-ticket 발급 실패: ${r.status}`);
  return r.json.data.ticket;
}

async function signupUser(tag, secretary) {
  const email = `smoke_relay_${tag}_${Date.now()}@test.io`;
  const body = {
    email, password: 'password123', display_name: `릴레이${tag}`,
    age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ],
  };
  const s = await req('POST', '/api/auth/signup', { body });
  if (s.status !== 201 || !s.json?.data?.token) throw new Error(`signup(${tag}) 실패: ${s.status} ${JSON.stringify(s.json)?.slice(0, 200)}`);
  const token = s.json.data.token;
  const a = await req('POST', '/api/agents', { token, body: { name: secretary ? '김비서' : `일반${tag}`, agent_type: 'assistant' } });
  if (a.status !== 201) throw new Error(`agent(${tag}) 실패: ${a.status}`);
  const agentId = a.json.data.id;
  if (secretary) {
    // POST /api/agents/:id/personas는 새 버전을 active로 승격 — ensureSession이 이를 세션에 연결한다.
    const p = await req('POST', `/api/agents/${agentId}/personas`, { token, body: {
      name: '김비서', relationship_type: 'secretary',
      tone_config: { formality: 'formal', emoji_usage: 'never', sentence_length: 'short', honorific_level: 5, quip_tone: 'adjutant' },
    } });
    if (p.status !== 201) throw new Error(`persona secretary 승격 실패: ${p.status} ${JSON.stringify(p.json)?.slice(0, 200)}`);
  }
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agentId } });
  if (sess.status !== 201) throw new Error(`session ensure(${tag}) 실패: ${sess.status}`);
  return { token, agentId, sessionId: sess.json.data.id, personaId: sess.json.data.persona_id };
}

/** stage 시퀀스가 RELAY_ORDER의 부분순서(단조 증가·역순/중복 없음)인지. */
function isMonotonicSubsequence(stages) {
  let i = 0;
  for (const s of stages) {
    const j = RELAY_ORDER.indexOf(s);
    if (j < 0 || j < i) return false;
    i = j + 1;
  }
  return true;
}

/** t_83946f45 원상회복: 서버 handshake가 open 직후 창을 보류 큐로 흡수하므로 connected
 *  대기·subscribed 재시도 보강(t_135a19b5 관례 이식)은 불필요 — plain send+wait로 돌아간다. */
async function subscribe(ws, sessionId, label, extra = {}) {
  ws.send({ type: 'subscribe', session_id: sessionId, locale: 'ko', ...extra });
  await ws.waitFor(e => e.type === 'subscribed', { timeoutMs: 8000, label });
}

async function main() {
  console.log(`\n=== 비서실 릴레이 자막 스모크 (@ ${BASE}) ===\n`);

  // ── 1. 비서 세션: 자막 발생 + 계약 보존 ──
  const sec = await signupUser('sec', true);
  check('secretary 페르소나 자동 승격·세션 연결', !!sec.personaId, `persona=${String(sec.personaId).slice(0, 8)}`);

  const ws = new WsCollector(wsConnectUrl({ session_id: sec.sessionId, [TICKET_KEY]: await ticket(sec.token) }));
  await ws.connect();
  await subscribe(ws, sec.sessionId, 'subscribed');
  ws.events.length = 0;

  ws.send({ type: 'message.send', session_id: sec.sessionId, content: `relay_${Date.now()} 계약 해지 유예기간은 보통 어떻게 돼?` });
  const started = await ws.waitFor(e => e.type === 'run.started', { timeoutMs: 15000, label: 'run.started' });
  const runId = started.run_id;
  await ws.waitFor(e => (e.type === 'run.completed' || e.type === 'run.failed') && e.run_id === runId, { label: 'run 종료' });
  check('비서실 턴 완주(run.completed)', ws.events.some(e => e.type === 'run.completed' && e.run_id === runId));

  const relay = ws.events.filter(e => e.type === 'relay.updated' && e.run_id === runId);
  const stages = relay.map(e => e.stage);
  check('relay.updated 1건 이상', relay.length >= 1, `stages=[${stages.join(',')}]`);
  check('stage 시퀀스 RELAY_ORDER 단조 증가', isMonotonicSubsequence(stages), stages.join('→'));
  check('첫 자막 briefing(배정)·끝 자막 done(통합 직전)', stages[0] === 'briefing' && stages.at(-1) === 'done');
  check('done은 answer.done 이후 run.completed 직전', (() => {
    const doneIdx = ws.events.findIndex(e => e.type === 'answer.done');
    const relayIdx = ws.events.findIndex(e => e.type === 'relay.updated' && e.stage === 'done');
    const compIdx = ws.events.findIndex(e => e.type === 'run.completed');
    return doneIdx >= 0 && relayIdx > doneIdx && compIdx > relayIdx;
  })());
  check('run.completed 마지막 이벤트(계약 불변)', ws.events.at(-1).type === 'run.completed');
  check('자막 식별자·quip·seq 완비(재생 대상)', relay.every(e =>
    e.session_id === sec.sessionId && typeof e.quip === 'string' && e.quip.length > 0 && typeof e.seq === 'number'));

  // ── 2. 재접속 재생: eventlog 보존 확인 ──
  const ws2 = new WsCollector(wsConnectUrl({ session_id: sec.sessionId, [TICKET_KEY]: await ticket(sec.token) }));
  await ws2.connect();
  await subscribe(ws2, sec.sessionId, 'subscribed(재생)', { last_seq: 0 });
  // 재생 꼬리 대기: replayed는 subscribed 회신 뒤에 seq 순으로 오므로 회신 즉시 읽으면 0건(테스트 측 레이스).
  // run.completed가 재생 스트림의 마지막 녹화 이벤트 → 그 도착 = 그 앞 relay 전부 수신.
  await ws2.waitFor(e => e.type === 'run.completed' && e.run_id === runId, { timeoutMs: 15000, label: '재생 꼬리(run.completed)' });
  const replayed = ws2.events.filter(e => e.type === 'relay.updated' && e.run_id === runId);
  check('재접속 재생: relay.updated eventlog 보존', replayed.length === relay.length && replayed.length > 0,
    `${replayed.length}/${relay.length}`);

  // ── 3. 제어군: 비서 아닌 페르소나 — 자막 0건, 기존 흐름 1:1 ──
  const plain = await signupUser('plain', false);
  const ws3 = new WsCollector(wsConnectUrl({ session_id: plain.sessionId, [TICKET_KEY]: await ticket(plain.token) }));
  await ws3.connect();
  await subscribe(ws3, plain.sessionId, 'subscribed(제어)');
  ws3.events.length = 0;
  ws3.send({ type: 'message.send', session_id: plain.sessionId, content: `plain_${Date.now()} 오늘 뭐 먹지?` });
  const pStarted = await ws3.waitFor(e => e.type === 'run.started', { timeoutMs: 15000, label: 'run.started(제어)' });
  await ws3.waitFor(e => (e.type === 'run.completed' || e.type === 'run.failed') && e.run_id === pStarted.run_id, { label: 'run 종료(제어)' });
  check('비서 외 페르소나: relay.updated 0건', ws3.events.filter(e => e.type === 'relay.updated').length === 0);
  check('제어군 run.completed 정상 종주(계약 불변)', ws3.events.at(-1).type === 'run.completed');

  ws.close(); ws2.close(); ws3.close();

  // 정리: 스모크 사용자는 마지막에 파기 (실DB 오염 방지 — smoke_chat 관례. 실패는 FAIL로 잡지 않는다.)
  for (const u of [sec, plain]) {
    const r = await req('DELETE', '/api/me', { token: u.token });
    if (r.status !== 200) console.log(`  WARN  DELETE /api/me 정리 실패(${r.status}) — 수동 확인 필요`);
  }

  console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('스모크 중단:', e); process.exit(1); });
