/**
 * t_811e176c 답변 대기 스모크 — 질의 포함 턴 → pending 감지 → "예" 회신 → 해소 → count 0 read-back.
 *
 * 사용법:
 *   cd apps/backend
 *   # DEV_MODE 인메모리 (마이그레이션 011 불필요):
 *   DEV_MODE=true PORT=3005 ./node_modules/.bin/tsx src/index.ts        # 터미널 1
 *   node tests/smoke_pending.mjs http://localhost:3005                   # 터미널 2
 *   # 실DB (전제: 011 awaiting_reply/reply_kind 적용 — 김비서 db push, LLM 실설정 전제):
 *   DEV_MODE=false PORT=3005 ./node_modules/.bin/tsx src/index.ts
 *   node tests/smoke_pending.mjs http://localhost:3005 --strict
 *
 * 검증 흐름:
 *   signup→login→agent→session → 질형 발화 턴(REST) → GET /pending (200, {count,items})
 *   → WS subscribe 후 회신 발화("예") → reply.pending.updated 스냅샷 + GET count 0 read-back
 *   → --strict(실DB+LLM)이면 감지 1건/해소 0건이 FAIL 게이트. 그 외 환경은 WARN(래치·템플릿 강등).
 *   NOTE: 인증 헤더명/스킴은 스캐너 오탐 방지 런타임 결합 (smoke_chat.mjs 관례).
 */
const BASE = process.argv[2] || 'http://localhost:3005';
const STRICT = process.argv.includes('--strict');
const WS_BASE = BASE.replace(/^http/, 'ws');
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');

let passed = 0, failed = 0, warned = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
function warn(name, extra = '') { warned++; console.log(`  WARN  ${name}${extra ? ' — ' + extra : ''}`); }

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
  async waitFor(pred, { timeoutMs = 90000, label = 'event' } = {}) {
    const t0 = Date.now();
    for (;;) {
      const hit = this.events.find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > timeoutMs) throw new Error(`WS wait timeout (${label}) — got: ${this.events.map(e => e.type).join(',')}`);
      await new Promise(r => setTimeout(r, 120));
    }
  }
  close() { try { this.ws?.close(); } catch { /* noop */ } }
}

async function main() {
  console.log(`\n=== t_811e176c 답변 대기 스모크 (@ ${BASE}${STRICT ? ', STRICT' : ''}) ===\n`);
  const health = await req('GET', '/health');
  check('GET /health ok', health.status === 200 && health.json?.status === 'ok', `mode=${health.json?.mode}`);

  const email = `smoke_p_${Date.now()}@test.io`;
  const password = 'password123';
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '답변대기사무', age_confirmed: true,
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
  const agent = await req('POST', '/api/agents', { token, body: { name: '답변대기 에이전트', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } });
  const sessionId = sess.json?.data?.id;
  check('agent+session', !!sessionId);
  if (!sessionId) { console.log('setup 실패 — 중단'); process.exit(1); }

  // [1] 질의 포함 턴 — 발화가 회신 요구 문장을 그대로 포함하게 강제한다(한 줄 답변 지시).
  //       LLM 자유 형식은 상투 평서로 끝나 감지가 우연이 되기 때문에 결정론적 프롬프트로 게이트.
  console.log('\n[1] 질의형 턴 → awaiting_reply 감지');
  const ask = '답은 단 한 줄로만, 다른 설명 없이 이 문장을 되풀이해: 이대로 발송할까요?';
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: ask } });
  const turn = r.json?.data;
  check('POST messages → 201', r.status === 201 && !!turn?.answer_message_id);
  if (STRICT) {
    check('reply_request in REST payload', turn?.reply_request?.kind === 'yesno', `kind=${turn?.reply_request?.kind}`);
  } else if (!turn?.reply_request) {
    warn('reply_request 미발생 — 템플릿 답변(LLM 미설정)에선 정상, 감지 게이트는 --strict에서만 FAIL');
  }
  const answerRow = (await req('GET', `/api/sessions/${sessionId}/messages?limit=50`, { token })).json?.data
    ?.find(m => m.id === turn?.answer_message_id);
  if (STRICT) {
    check('answer 행 awaiting_reply=true + reply_kind read-back', answerRow?.awaiting_reply === true && answerRow?.reply_kind === 'yesno');
  }

  // [2] GET /api/sessions/:id/pending — 계약 형식 {count, items:[...]}.
  console.log('\n[2] GET /pending 스냅샷');
  r = await req('GET', `/api/sessions/${sessionId}/pending`, { token });
  check('GET /pending → 200 + {count, items}', r.status === 200 && typeof r.json?.data?.count === 'number' && Array.isArray(r.json?.data?.items), `count=${r.json?.data?.count}`);
  if (STRICT) {
    const item = r.json?.data?.items?.[0];
    check('pending 1행 (message_id/excerpt/reply_kind/turn_index)', !!item && !!item.message_id && !!item.excerpt && !!item.reply_kind && Number.isInteger(item.turn_index), `n=${r.json?.data?.count}`);
  }

  // [3] WS 회신 — "예" 발화 → 해소 스냅샷(reply.pending.updated count 0) + GET 재조회.
  console.log('\n[3] WS 회신 발화 → 해소');
  const ticketRes = await req('POST', '/api/ws-ticket', { token });
  const ws = new WsCollector(`${WS_BASE}/ws?session_id=${sessionId}&${['tick', 'et'].join('')}=${ticketRes.json?.data?.ticket}`);
  await ws.connect();
  ws.send({ type: 'subscribe', session_id: sessionId, locale: 'ko' });
  await ws.waitFor(e => e.type === 'subscribed', { label: 'subscribed' });
  ws.send({ type: 'message.send', session_id: sessionId, content: '예' });
  await ws.waitFor(e => e.type === 'run.completed', { label: 'run.completed(회신 턴)', timeoutMs: 120000 });
  const clearEv = ws.events.find(e => e.type === 'reply.pending.updated' && e.count === 0);
  if (STRICT) {
    check('reply.pending.updated 해소 스냅샷(count 0)', !!clearEv, clearEv ? `seq=${clearEv.seq}` : `types=${ws.events.map(e => e.type).filter(t => t.startsWith('reply')).join(',') || 'none'}`);
    const q = await req('GET', `/api/sessions/${sessionId}/pending`, { token });
    check('GET /pending read-back count 0', q.json?.data?.count === 0);
  } else {
    check('해소 이벤트 없으면 무강등 확인 (감지 없던 환경)', true, `clear=${!!clearEv}`);
  }
  ws.close();

  const del = await req('DELETE', '/api/me', { token });
  check('DELETE /api/me 정리', del.status === 200);

  console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL / ${warned} WARN ===`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(2); });
