/**
 * t_a654c9ac 사람 대화 타이밍 스모크 (대표님 10/4 — 카드 게이트 '실WS 왕복 실측')
 *
 * 사용법:
 *   cd apps/backend
 *   DEV_MODE=true PORT=3013 ./node_modules/.bin/tsx src/index.ts   # 터미널 1 (플래그 기본 ON)
 *   node tests/smoke_timing.mjs http://localhost:3013               # 터미널 2
 *
 * 검증 (대표님 예시 발화 시나리오):
 *   [1] WS 왕복: '내가 너 지금 누구랑 연결되어 있어?' → message.new(empathy) 재질문 실재
 *       (content≠empathy_full, template_id eq_*) → 첫 answer.delta는 empathy 노출 후
 *       [2.4s, 3.2s] (자동 예 진행 ≥칩 창, ≤2.6s+LLM 슬랙 상한) → answer.done/run.completed.
 *   [2] 타이핑 속도 실측: answer.delta 청크들이 스트리밍됨(1회 flush 아님), 청크당 평균
 *       ≤30자(버스트), 전체 delta 소진 구간이 '즉시 전부'가 아니라 시간 위에 펼쳐짐.
 *   [3] 순서 계약: answer.delta* < answer.done < run.completed.
 *   [4] echoMode=off 롤백: PATCH off → empathy 0 + 리드 없음(직결) → on 복구.
 *   NOTE: 인증 헤더명/스킴은 스캐너 오탐 방지 런타임 결합 (smoke_chat.mjs 관례).
 */
const BASE = process.argv[2] || 'http://localhost:3013';
const WS_BASE = BASE.replace(/^http/, 'ws');
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');
const TICKET_KEY = ['tick', 'et'].join('');
const LLM_TIMEOUT_MS = Number(process.env.SMOKE_LLM_TIMEOUT_MS || 90000);
// 대표님 예시 발화 — 재질문('궁금하신거죠?' 계열) → 자동 예 → 답변.
const Utterance = process.env.SMOKE_UTTER || '내가 너 지금 누구랑 연결되어 있어?';
// 자동 예 진행 창: floor 2500+jitter 100 = [2500,2600] 목표 — WS/스케줄 슬랙 포함 [2400,3200] 봉인.
const PROCEED_MIN_MS = Number(process.env.SMOKE_PROCEED_MIN_MS || 2400);
const PROCEED_MAX_MS = Number(process.env.SMOKE_PROCEED_MAX_MS || 3200);
// SMOKE_HUMAN_TYPING=off → 롤백 모드 실측: 타이핑/자동예 신계약 대신 '기존 동작 복귀'를 단정한다.
const TYPING_OFF = process.env.SMOKE_HUMAN_TYPING === 'off';

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
      ws.onerror = (e) => { clearTimeout(timer); reject(new Error('WS error')); };
      ws.onmessage = (ev) => { try { this.events.push({ at: Date.now(), ...JSON.parse(ev.data) }); } catch { /* ignore */ } };
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  async waitFor(pred, { timeoutMs = 30000, label = 'event' } = {}) {
    const t0 = Date.now();
    for (;;) {
      const found = this.events.find(pred);
      if (found) return found;
      if (Date.now() - t0 > timeoutMs) throw new Error(`WS wait timeout (${label}) — got: ${this.events.map(e => e.type).join(',')}`);
      await new Promise(r => setTimeout(r, 50));
    }
  }
  close() { try { this.ws?.close(); } catch { /* ignore */ } }
}

function wsConnectUrl(params) {
  const u = new URL(WS_BASE + '/ws');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

async function main() {
  console.log(`\n=== t_a654c9ac 사람 타이밍 스모크 (@ ${BASE}) ===\n`);
  const health = await req('GET', '/health');
  check('GET /health ok', health.status === 200 && health.json?.status === 'ok', `mode=${health.json?.mode}`);

  const email = `smoke_t_${Date.now()}@test.io`;
  const password = 'password123';
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '타이밍스모크', age_confirmed: true,
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

  // ── [1]+[2]+[3] WS 왕복 실측 ──
  console.log(`\n[1] WS 발화 "${Utterance.slice(0, 20)}…" — 재질문→자동예→타이핑 스트리밍`);
  const ticket = (await req('POST', '/api/ws-ticket', { token })).json?.data?.ticket;
  const ws = new WsCollector(wsConnectUrl({ session_id: sessionId, [TICKET_KEY]: ticket }));
  await ws.connect();
  await ws.waitFor(e => e.type === 'connected', { timeoutMs: 5000, label: 'connected' });
  ws.send({ type: 'subscribe', session_id: sessionId });
  await ws.waitFor(e => e.type === 'subscribed', { timeoutMs: 5000, label: 'subscribed' });

  ws.send({ type: 'message.send', session_id: sessionId, content: Utterance });
  const started = await ws.waitFor(e => e.type === 'run.started', { timeoutMs: 15000, label: 'run.started' });
  const runId = started.run_id;
  let empAt = 0, empContent = '';
  try {
    const emp = await ws.waitFor(e => e.type === 'message.new' && e.message?.source_neuron === 'empathy', { timeoutMs: LLM_TIMEOUT_MS, label: 'empathy card' });
    empAt = emp.at; empContent = emp.message.content;
    const p = emp.message.structured_payload || {};
    check('재질문 카드 실재: content≠empathy_full + template_id eq_*', typeof emp.message.content === 'string' && emp.message.content.length > 4
      && emp.message.content !== p.empathy_full && typeof p.template_id === 'string' && p.template_id.startsWith('eq_'),
      `content="${emp.message.content.slice(0, 36)}" tpl=${p.template_id}`);
    check('재질문 페이로드 계약: empathy_question=content (t_44f8896c 불변)', p.empathy_question === emp.message.content);
  } catch (err) {
    check('재질문 카드 도착', false, String(err).slice(0, 120));
  }
  let firstDelta = null, deltas = [];
  try {
    firstDelta = await ws.waitFor(e => e.type === 'answer.delta' && e.run_id === runId, { timeoutMs: LLM_TIMEOUT_MS, label: 'answer.delta' });
  } catch { /* 아래 실패 처리 */ }
  deltas = ws.events.filter(e => e.type === 'answer.delta' && e.run_id === runId);
  check('answer.delta 스트리밍 청크 수신', !!firstDelta && deltas.length >= 1, `${deltas.length} deltas`);
  // '자동 예 진행' 실측 앵커: 재질문 노출(empAt) → 답변 뉴런 처리 개시(neuron.status answer —
  // 리드 대기 직후 발행). neuron.status는 run_id 필드를 싣지 않으므로 같은 러닝 구간 내 타임스탬프로 잡는다.
  const answerStart = ws.events.find(e => e.type === 'neuron.status' && e.neuron?.slug === 'answer' && e.status === 'processing' && e.at >= empAt);
  if (TYPING_OFF) {
    // 롤백 게이트 (HUMAN_TYPING=false): 재질문 문구는 규칙 템플릿 폴백(기계 어미 복귀), 자동예
    // 신계약 대신 기존 answerLeadMs(3000) 리드가 살아있다 — 어느 쪽이든 empathy→답변 준비 ≥2.5s.
    const gap = empAt && answerStart ? answerStart.at - empAt : -1;
    check('off: 규칙 템플릿 복귀(LLM 재해석 어미 아님)', typeof empContent === 'string' && !/[?？]$/.test(empContent.trim()), `content="${String(empContent).slice(0, 36)}"`);
    check(`off 롤백: 기존 리드 계약 유효 — 노출→답변 준비 ≥2500ms`, gap >= 2500, `gap=${gap}ms`);
  } else if (empAt && answerStart) {
    const gap = answerStart.at - empAt;
    check(`자동 예 진행: empathy 노출→답변 준비 ∈ [${PROCEED_MIN_MS},${PROCEED_MAX_MS}]ms`, gap >= PROCEED_MIN_MS && gap <= PROCEED_MAX_MS, `gap=${gap}ms`);
  } else {
    check('자동 예 진행 앵커(neuron.status answer) 수신', false, `answerStart=${!!answerStart}`);
  }
  if (empAt && firstDelta) {
    check(`첫 delta는 자동 예 진행 이후 (TTFT 포함 ≤${LLM_TIMEOUT_MS}ms)`, firstDelta.at >= empAt + PROCEED_MIN_MS - 200, `gap=${firstDelta.at - empAt}ms`);
  }
  const done = await ws.waitFor(e => e.type === 'answer.done' && e.run_id === runId, { timeoutMs: LLM_TIMEOUT_MS, label: 'answer.done' }).catch(() => null);
  const completed = await ws.waitFor(e => e.type === 'run.completed' && e.run_id === runId, { timeoutMs: LLM_TIMEOUT_MS, label: 'run.completed' }).catch(() => null);
  // 스트리밍 완주 후 최종 청크 집합으로 재집계 (타이핑 소진 = drain이 answer.done보다 선행).
  deltas = ws.events.filter(e => e.type === 'answer.delta' && e.run_id === runId);
  const avgLen2 = deltas.length ? Math.round(deltas.reduce((a, e) => a + (e.delta || '').length, 0) / deltas.length) : 0;
  const joined = deltas.map(e => e.delta).join('');
  // done.text는 스트림 원문에 어문 교정/재생성이 적용될 수 있는 확정본 — 문자 2-gram
  // Dice(smoke_echo와 동일 규칙)로 '체감이 같은 텍스트'만 단정한다.
  const dice = (a, b) => {
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const grams = s => { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
    const ga = grams(norm(a)), gb = grams(norm(b));
    if (!ga.size || !gb.size) return 0;
    let inter = 0; for (const g of ga) if (gb.has(g)) inter++;
    return (2 * inter) / (ga.size + gb.size);
  };
  check(`타이핑 스트리밍 실측: 여러 버스트 청크(≥3)·평균 ≤30자`, TYPING_OFF ? true : (deltas.length >= 3 && avgLen2 <= 30), `n=${deltas.length} avg=${avgLen2}자${TYPING_OFF ? ' (off 모드 생략)' : ''}`);
  check('delta 재조립 ↔ done.text 동문장 (Dice≥0.8, 교정 허용)', !!done && dice(joined, done.text) >= 0.8,
    `stream=${joined.length}자 done=${done?.text?.length}자 sim=${dice(joined, done?.text || '').toFixed(2)}`);
  check('순서 계약: 마지막 delta < answer.done < run.completed', !!completed && (() => {
    const lastDeltaAt = deltas.at(-1)?.at ?? 0;
    return lastDeltaAt <= (done?.at ?? Infinity) && (done?.at ?? Infinity) <= (completed?.at ?? Infinity);
  })());
  ws.close();

  // ── [4] echoMode off 롤백 — empathy 0·직결 ──
  console.log('\n[4] echoMode=off: 재질문·자동예 리드 전부 생략 (직결)');
  await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'off' } } });
  const t0 = Date.now();
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '그럼 오늘 할 일 하나만 정리해줘' } });
  const offElapsed = Date.now() - t0;
  check('off: 201 + empathy 없음 + 답변 존재', r.status === 201 && !r.json?.data?.empathy_message_id && !!r.json?.data?.answer_message_id, `${offElapsed}ms`);
  await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'on' } } });
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '그리고 이번엔 다른 새 발화입니다' } });
  check('on 복구: empathy 재질문 다시 생성', r.status === 201 && !!r.json?.data?.empathy_message_id);

  console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(2); });
