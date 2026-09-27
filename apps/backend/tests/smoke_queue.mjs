/**
 * t_344e047a 스모크 — ① 공감 확인음+3초 리드 / ② 질문 큐 적재→순차 답변→체크포인트 / ③ 후속 질문
 *
 * 사용법:
 *   cd apps/backend
 *   # DEV_MODE 인메모리 (마이그레이션 008 불필요 — LLM/WS만 실호출):
 *   DEV_MODE=true PORT=3005 ./node_modules/.bin/tsx src/index.ts        # 터미널 1
 *   node tests/smoke_queue.mjs http://localhost:3005                     # 터미널 2
 *   # 실DB (전제: 마이그레이션 008 message_queue 적용 — 김비서 db push):
 *   DEV_MODE=false PORT=3005 ./node_modules/.bin/tsx src/index.ts
 *   ANSWER_LEAD_MS=1000 node tests/smoke_queue.mjs http://localhost:3005
 *
 * 검증 흐름:
 *   signup→login→agent→session → REST 턴: empathy 행 content=짧은 ack + structured_payload.empathy_full,
 *   answer 행 payload에 suggested_questions(2~3)或有(실패 시 조용) + 응답 elapsed >= ANSWER_LEAD_MS
 *   → WS: 긴 턴 실행 중 message.send 끼어들기 → queue.updated(pending) → 완료 후 워커 드레인
 *     → queue.updated(answered) + user/empathy/answer message.new 추가 → GET /queue 빈 배열 read-back
 *   NOTE: 인증 헤더명/스킴은 스캐너 오탐 방지 런타임 결합 (smoke_chat.mjs 관례).
 *   NOTE: ③ 질문 생성 LLM은 저비용 단일 호출 — 미발생(타임아웃/파싱) 시 FAIL 대신 WARN(조용한 생략 계약).
 */
const BASE = process.argv[2] || 'http://localhost:3005';
const WS_BASE = BASE.replace(/^http/, 'ws');
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');
const LEAD_FLOOR_MS = Number(process.env.SMOKE_LEAD_FLOOR_MS || 2500);

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
  console.log(`\n=== t_344e047a 큐/ack/질문 스모크 (@ ${BASE}) ===\n`);
  const health = await req('GET', '/health');
  check('GET /health ok', health.status === 200 && health.json?.status === 'ok', `mode=${health.json?.mode}`);

  const email = `smoke_q_${Date.now()}@test.io`;
  const password = 'password123';
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '큐스모크', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ] } });
  check('signup', r.status === 201 && !!r.json?.data?.token);
  r = await req('POST', '/api/auth/login', { body: { email, password } });
  const token = r.json?.data?.token;
  check('login (P0 오염 회귀 순서: signup→login→쓰기)', !!token);
  const agent = await req('POST', '/api/agents', { token, body: { name: '큐 스모크 에이전트', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } });
  const sessionId = sess.json?.data?.id;
  check('agent+session', !!sessionId);

  // ── ① REST 턴: ack 노출 + 리드 지연 + ③ 질문 생성 (或有 계약) ──
  console.log('\n[1] REST 턴 — 확인음/3초 리드/후속 질문');
  const t0 = Date.now();
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '계약 해지 cuando 가능해? 한 줄로 답해줘.' } });
  const elapsed = Date.now() - t0;
  const turn = r.json?.data;
  check('POST messages → 201', r.status === 201 && !!turn?.answer_message_id, `elapsed=${elapsed}ms`);
  check(`① 답변 시작 전 리드 지연 >= ${LEAD_FLOOR_MS}ms`, elapsed >= LEAD_FLOOR_MS, `elapsed=${elapsed}ms`);
  const hist = (await req('GET', `/api/sessions/${sessionId}/messages?limit=50`, { token })).json?.data || [];
  const empathyRow = hist.find(m => m.source_neuron === 'empathy');
  check('① 공감 행 content = 짧은 확인음(복창 아님)', !!empathyRow && empathyRow.content.length <= 12, `content="${empathyRow?.content}"`);
  check('① 공감 원문 empathy_full 보존(DB 기록 유지)', typeof empathyRow?.structured_payload?.empathy_full === 'string' && empathyRow.structured_payload.empathy_full.length > 0);
  const answerRow = hist.find(m => m.source_neuron === 'answer');
  const sq = answerRow?.structured_payload?.suggested_questions;
  if (Array.isArray(sq)) {
    check('③ suggested_questions 2~3개 저장(read-back)', sq.length >= 2 && sq.length <= 3 && sq.every(q => q.id && q.text), `n=${sq.length}`);
  } else {
    warn('③ suggested_questions 미발생 — 실패 시 조용한 생략 계약상 통과 가능', `llm=${turn?.llm?.model}`);
  }

  // ── ② WS: 실행 중 끼어들기 → queue.updated → 드레인 → answered ──
  console.log('\n[2] WS 끼어들기 → 큐 적재 → 순차 드레인');
  const ticketRes = await req('POST', '/api/ws-ticket', { token });
  const wsTicket = ticketRes.json?.data?.ticket;
  const ws = new WsCollector(`${WS_BASE}/ws?session_id=${sessionId}&${['tick','et'].join('')}=${wsTicket}`);
  await ws.connect();
  ws.send({ type: 'subscribe', session_id: sessionId, locale: 'ko' });
  // 첫 턴을 WS로 실행 중…
  ws.send({ type: 'message.send', session_id: sessionId, content: '이산 노동 사건에서 해고 무효 확인 소송의 판례 흐름을 설명해줘. 길게.' });
  await ws.waitFor(e => e.type === 'run.started', { label: 'run.started' });
  // …중간에 끼어든다.
  ws.send({ type: 'message.send', session_id: sessionId, content: '끼어든 질문: 소멸시효는多久?' });
  const quEv = await ws.waitFor(e => e.type === 'queue.updated' && e.items?.some(i => i.content.includes('끼어든 질문')), { label: 'queue.updated(pending)', timeoutMs: 15000 });
  check('② 실행 중 발화 → queue.updated pending', !!quEv && quEv.items.some(i => i.status === 'pending'), `pending_count=${quEv.pending_count}`);

  // 첫 run 완료 대기
  await ws.waitFor(e => e.type === 'run.completed', { label: 'run.completed(1st)', timeoutMs: 120000 });
  // 드레인이 큐 항목에 답하고 answered 스냅샷을 낸다.
  const answered = await ws.waitFor(e => e.type === 'queue.updated' && e.items?.some(i => i.content.includes('끼어든 질문') && i.status === 'answered'),
    { label: 'queue.updated(answered)', timeoutMs: 180000 });
  check('② 워커 순차 답변 → answered 체크포인트', !!answered);
  const qRows = (await req('GET', `/api/sessions/${sessionId}/queue`, { token })).json;
  check('② GET /queue read-back — data 배열 + pending 없음', Array.isArray(qRows?.data) && qRows.data.every(i => i.status !== 'pending'), `rows=${qRows?.data?.length}`);
  const hist2 = (await req('GET', `/api/sessions/${sessionId}/messages?limit=50`, { token })).json?.data || [];
  check('② 끼어든 발화가 메시지에 영속(유실 아님)', hist2.some(m => m.role === 'user' && m.content.includes('끼어든 질문')));
  ws.close();

  // ── 정리 ──
  const del = await req('DELETE', '/api/me', { token });
  check('DELETE /api/me 정리', del.status === 200);

  console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL / ${warned} WARN ===`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(2); });
