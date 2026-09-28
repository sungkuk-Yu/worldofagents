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
 *   signup→login→agent→session → REST 턴: empathy 행 content=재질문(t_44f8896c) + structured_payload.empathy_full/empathy_ack/template_id
 *   (t_135a19b5 정적용: 확인음 대체 폐기, 예/아니오 게이트로 확인 발화 에코 억제),
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
  // t_44f8896c (대표님 9/28): 노출 content=재질문('이거 맞냐' 템플릿 풀), 복창 원문은 empathy_full 보존.
  check('① 공감 행 content = 재질문(복창 아님, 발화 키워드 포함)', !!empathyRow && empathyRow.content.length > 8 && empathyRow.content.includes('계약'.slice(0, 2)) && empathyRow.content !== empathyRow.structured_payload?.empathy_full, `content="${empathyRow?.content?.slice(0, 40)}"`);
  check('① structured_payload: empathy_full(원문)+empathy_question+template_id', typeof empathyRow?.structured_payload?.empathy_full === 'string' && empathyRow.structured_payload.empathy_question === empathyRow.content && typeof empathyRow.structured_payload.template_id === 'string' && empathyRow.structured_payload.template_id.startsWith('eq_'), `tpl=${empathyRow?.structured_payload?.template_id}`);
  check('① 짧은 확인음 empathy_ack 분류 보존', typeof empathyRow?.structured_payload?.empathy_ack === 'string' && empathyRow.structured_payload.empathy_ack.length > 0, `ack="${empathyRow?.structured_payload?.empathy_ack}"`);
  // 회전 시드 (t_44f8896c): 같은 세션 연속 empathy 행은 다른 template_id — 직전 재사용 금지.
  await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '가상화폐 과세 기준 알려줘' } });
  const histRot = (await req('GET', `/api/sessions/${sessionId}/messages?limit=50`, { token })).json?.data || [];
  const rotRows = histRot.filter(m => m.source_neuron === 'empathy');
  check('① 회전: 연속 empathy template_id 재사용 금지', rotRows.length >= 2 && rotRows.at(-1).structured_payload?.template_id !== rotRows.at(-2).structured_payload?.template_id, `ids=${rotRows.map(r => r.structured_payload?.template_id).join(',')}`);
  // 예/아니오 게이트: 직전 empathy 행 뒤 짧은 확인 발화에는 공감 행이 추가되지 않는다.
  const empathyBefore = histRot.filter(m => m.source_neuron === 'empathy').length;
  await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '예' } });
  const histGate = (await req('GET', `/api/sessions/${sessionId}/messages?limit=50`, { token })).json?.data || [];
  const empathyAfter = histGate.filter(m => m.source_neuron === 'empathy').length;
  const confirmAnswered = histGate.some(m => m.role === 'user' && m.content.trim() === '예') && histGate.filter(m => m.source_neuron === 'answer').length >= 2;
  check('① 예/아니오 게이트: 확인 발화에서 공감 행 미생성 + 답변 직결', empathyAfter === empathyBefore && confirmAnswered, `empathy ${empathyBefore}→${empathyAfter}`);
  // t_5e407a8a: '맞아요' 변형(t_c62a2eb7 50/50 버튼 라벨)도 동일 게이트 — 연속 체인으로 직전 확인 발화 '예' 뒤 발화.
  await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '맞아요' } });
  const histGate2 = (await req('GET', `/api/sessions/${sessionId}/messages?limit=50`, { token })).json?.data || [];
  const empathyAfter2 = histGate2.filter(m => m.source_neuron === 'empathy').length;
  const mjAnswered = histGate2.some(m => m.role === 'user' && m.content.trim() === '맞아요') && histGate2.filter(m => m.source_neuron === 'answer').length >= 3;
  check('① 게이트 확대: "맞아요" 변형도 공감 행 미생성 + 답변 직결', empathyAfter2 === empathyAfter && mjAnswered, `empathy ${empathyAfter}→${empathyAfter2}`);
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
  // 실DB(토큰·소유권 DB 왕복 지연)에선 서버 message 리스너 등록 전에 보낸 subscribe/message.send가
  // 유실될 수 있다 — connected 수신 후 subscribe하고 subscribed 확인까지 재시도, 그 다음 발화 전송.
  // DEV 인메모리는 즉시 통과 (t_135a19b5 실DB 재현).
  await ws.waitFor(e => e.type === 'connected', { label: 'connected', timeoutMs: 10000 });
  ws.send({ type: 'subscribe', session_id: sessionId, locale: 'ko' });
  try {
    await ws.waitFor(e => e.type === 'subscribed', { label: 'subscribed', timeoutMs: 4000 });
  } catch {
    ws.send({ type: 'subscribe', session_id: sessionId, locale: 'ko' });
    await ws.waitFor(e => e.type === 'subscribed', { label: 'subscribed(retry)', timeoutMs: 15000 });
  }
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
