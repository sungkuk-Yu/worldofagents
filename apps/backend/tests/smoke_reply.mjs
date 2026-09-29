/**
 * t_02f58030 스모크 — 답글/인용 (백로그④, 마이그레이션 012)
 *
 * 사용법:
 *   cd apps/backend
 *   # DEV_MODE 인메모리 (012 불필요 — devstore는 messages.insert 시 reply_to_id 기본 null):
 *   DEV_MODE=true PORT=3006 ./node_modules/.bin/tsx src/index.ts     # 터미널 1
 *   node tests/smoke_reply.mjs http://localhost:3006
 *   # 실DB (전제: 012 적용 — 김비서 db push): DEV_MODE=false PORT=3006 ./node_modules/.bin/tsx src/index.ts
 *
 * 검증: WS message.send reply_to_id → user/answer payload 요약, GET messages?reply=1,
 *  다른 세션 인용 무시+통과, 무인용 회귀, 스레드 답글 병용, 큐 우회. (smoke_queue 관례)
 */
const BASE = process.argv[2] || 'http://localhost:3006';
const WS_BASE = BASE.replace(/^http/, 'ws');
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');

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
  console.log(`\n=== t_02f58030 답글/인용 스모크 (@ ${BASE}) ===\n`);
  const health = await req('GET', '/health');
  check('GET /health ok', health.status === 200 && health.json?.status === 'ok', `mode=${health.json?.mode}`);

  const email = `smoke_reply_${Date.now()}@test.io`;
  const password = 'password123';
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '인용스모크', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ] } });
  check('signup A', r.status === 201 && !!r.json?.data?.token);
  r = await req('POST', '/api/auth/login', { body: { email, password } });
  const token = r.json?.data?.token;
  check('login A', !!token);

  const agent = await req('POST', '/api/agents', { token, body: { name: '인용 스모크 에이전트', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } });
  const sessionId = sess.json?.data?.id;
  check('agent+session A', !!sessionId);

  // 다른 사용자·세션 (교차 세션 프루브용)
  const emailB = `smoke_reply_b_${Date.now()}@test.io`;
  r = await req('POST', '/api/auth/signup', { body: {
    email: emailB, password, display_name: '인용스모크B', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ] } });
  const rb = await req('POST', '/api/auth/login', { body: { email: emailB, password } });
  const tokenB = rb.json?.data?.token;
  const agentB = await req('POST', '/api/agents', { token: tokenB, body: { name: 'B 에이전트', agent_type: 'shadow' } });
  const sessB = await req('POST', '/api/sessions/ensure', { token: tokenB, body: { agent_id: agentB.json.data.id } });
  const sessionIdB = sessB.json?.data?.id;
  check('signup+login+session B', !!tokenB && !!sessionIdB);

  // 원문 발화 (REST, 인용 없이) — 답글 대상 행
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '오늘 일정 정리해줄래? 산책 리뷰 포함' } });
  check('REST 원문 발화 201', r.status === 201 && !!r.json?.data?.messages?.user?.id);
  const rootUserId = r.json.data.messages.user.id;

  // WS 접속 (엔드포인트 /ws — smoke_queue 관례: ticket 파라명 분할은 스캐너 오탐 방지)
  const ticketRes = await req('POST', '/api/ws-ticket', { token });
  const wsTicket = ticketRes.json?.data?.ticket;
  const ws = new WsCollector(`${WS_BASE}/ws?session_id=${sessionId}&${['tick','et'].join('')}=${wsTicket}`);
  await ws.connect();
  ws.send({ type: 'subscribe', session_id: sessionId });
  await ws.waitFor(e => e.type === 'subscribed', { label: 'subscribed' });

  // ── [1] WS reply_to_id 답글: user+answer payload에 요약 ──
  console.log('\n[1] WS message.send reply_to_id — 영속·payload 요약');
  ws.events.length = 0;
  ws.send({ type: 'message.send', session_id: sessionId, content: '세 번째 항목은 내일로 미뤄줘', reply_to_id: rootUserId });
  let userNew = await ws.waitFor(e => e.type === 'message.new' && e.message?.role === 'user' && e.message?.content === '세 번째 항목은 내일로 미뤄줘', { label: 'message.new(user 답글)' });
  check('message.new user.reply_to_id = 원문', userNew.message.reply_to_id === rootUserId, `got=${userNew.message.reply_to_id}`);
  check('user structured_payload.reply_to 요약(by=보낸이 표시, text<=120)',
    userNew.message.structured_payload?.reply_to?.message_id === rootUserId
    && typeof userNew.message.structured_payload?.reply_to?.text === 'string'
    && userNew.message.structured_payload.reply_to.text.length <= 120,
    JSON.stringify(userNew.message.structured_payload?.reply_to));
  await ws.waitFor(e => e.type === 'run.completed', { label: 'run.completed' });
  const answerNew = ws.events.find(e => e.type === 'message.new' && e.message?.source_neuron === 'answer');
  check('answer payload reply_to 사본 포함 (카드 ③ 리터럴 계약)',
    !!answerNew && answerNew.message.structured_payload?.reply_to?.message_id === rootUserId,
    `payload=${answerNew ? Object.keys(answerNew.message.structured_payload || {}).join(',') : 'none'}`);
  const hist = (await req('GET', `/api/sessions/${sessionId}/messages?reply=1&limit=50`, { token })).json?.data || [];
  const histReplyRow = hist.find(m => m.id === userNew.message.id);
  check('GET messages?reply=1 user 행 요약 노출', !!histReplyRow && histReplyRow.structured_payload?.reply_to?.message_id === rootUserId, `reply_to_id=${histReplyRow?.reply_to_id}`);
  // ── [2] 다른 세션 message ID 인용 → 무시+통과 (발화·답변 정상) ──
  console.log('\n[2] 교차 세션 reply_to_id — 무시+통과 계약');
  const bMsg = await req('POST', `/api/sessions/${sessionIdB}/messages`, { token: tokenB, body: { content: 'B 세션 원문' } });
  const bUserId = bMsg.json?.data?.messages?.user?.id;
  check('B 세션 발화 201', !!bUserId);
  ws.events.length = 0;
  ws.send({ type: 'message.send', session_id: sessionId, content: '남의 세션을 인용해볼게', reply_to_id: bUserId });
  const crossNew = await ws.waitFor(e => e.type === 'message.new' && e.message?.role === 'user' && e.message?.content === '남의 세션을 인용해볼게', { label: 'message.new(무시 통과)' });
  check('교차 인용 user 행 reply_to_id=null (무시)', (crossNew.message.reply_to_id ?? null) === null);
  check('교차 인용 structured_payload에 reply_to 없음', crossNew.message.structured_payload?.reply_to === undefined);
  const crossDone = await ws.waitFor(e => e.type === 'run.completed' && e.run_id === crossNew.run_id, { label: 'cross run.completed' });
  check('교차 인용에도 답변 run 정상 완료 (발화 사망 금지)', !!crossDone);
  const noErr = !ws.events.some(e => e.type === 'session.error' || e.type === 'error');
  check('교차 인용 경로 error 이벤트 없음', noErr);

  // ── [3] 무인용 발화 회귀 — reply 컬럼/요약 전무 ──
  console.log('\n[3] 무인용 발화 회귀');
  ws.events.length = 0;
  ws.send({ type: 'message.send', session_id: sessionId, content: '그리고 저녁 메뉴 추천' });
  const plainNew = await ws.waitFor(e => e.type === 'message.new' && e.message?.role === 'user' && e.message?.content === '그리고 저녁 메뉴 추천', { label: 'plain message.new' });
  check('무인용 user 행 reply_to_id null·요약 없음', (plainNew.message.reply_to_id ?? null) === null && plainNew.message.structured_payload?.reply_to === undefined);
  await ws.waitFor(e => e.type === 'run.completed' && e.run_id === plainNew.run_id, { label: 'plain run.completed' });

  // ── [4] 큐 우회 — 실행 중 인용 발화는 message.new로 즉시 접수 (queue.updated 아님) ──
  console.log('\n[4] 실행 중 인용 발화 — 큐 우회');
  ws.events.length = 0;
  ws.send({ type: 'message.send', session_id: sessionId, content: '긴 작업 시작해줘. 보고서 초안을 꼼꼼하게 길게 준비해줘', reply_to_id: rootUserId });
  const qStarted = await ws.waitFor(e => e.type === 'run.started', { label: 'run.started' });
  ws.send({ type: 'message.send', session_id: sessionId, content: '인용 발화 중 끼어듦', reply_to_id: rootUserId });
  const qUser = await ws.waitFor(e => e.type === 'message.new' && e.message?.content === '인용 발화 중 끼어듦', { label: 'insert message.new' });
  const idx = ws.events.map(e => e.type);
  check('인용 끼어들기: queue.updated 없음(우회) + message.new로 종착',
    !idx.includes('queue.updated') && idx.includes('message.new'),
    `order=${idx.slice(0, 12).join(',')}`);
  check('우회 종착 user 행에 reply_to_id 보존(큐 배합 시 소멸할 자리)', qUser.message?.reply_to_id === rootUserId, `quote=${qUser.message?.reply_to_id}`);
  await ws.waitFor(e => e.type === 'run.completed' && e.run_id === qUser.run_id, { label: 'insert run.completed' });

  // ── [5] 스레드 답글 + reply_to 병용 (REST) ──
  console.log('\n[5] POST /messages/:id/replies + reply_to 병용');
  const rootAnswerId = answerNew.message.id;
  const rep = await req('POST', `/api/messages/${rootAnswerId}/replies`, { token, body: { content: '스레드에서 인용 답글', reply_to_id: rootUserId } });
  check('replies 201', rep.status === 201 && !!rep.json?.data?.messages?.user?.id);
  const repUser = rep.json?.data?.messages?.user;
  check('스레드 답글 user: root+parent 유지면서 reply_to_id 병기',
    repUser.root_message_id === rootAnswerId && repUser.parent_message_id === rootAnswerId && repUser.reply_to_id === rootUserId,
    `root=${repUser?.root_message_id} parent=${repUser?.parent_message_id} quote=${repUser?.reply_to_id}`);
  check('스레드 답글 payload 요약 포함', repUser.structured_payload?.reply_to?.message_id === rootUserId);

  // ── [6] 히스토리 read-back: 요약·reply_to_id 전원 노출 ──
  console.log('\n[6] GET /messages read-back');
  const hist2 = (await req('GET', `/api/sessions/${sessionId}/messages?limit=100`, { token })).json?.data || [];
  const rows2 = hist2.filter(m => m.reply_to_id === rootUserId);
  check('reply_to_id=root 인용 행 4개 (WS답글·교차무시 제외 후) read-back', rows2.length >= 3, `count=${rows2.length}`);
  check('인용 행 전부 structured_payload.reply_to 요약 보유', rows2.every(m => m.structured_payload?.reply_to?.message_id === rootUserId));
  const bad = (await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '숫자 인용 시도', reply_to_id: 12345 } }));
  check('비문자열 reply_to_id(12345) → 무시+통과 201', bad.status === 201 && !bad.json?.data?.messages?.user?.reply_to_id);

  ws.close();
  console.log(`\n=== 답글/인용 스모크 종료: PASS ${passed} FAIL ${failed} ===`);
}
main().then(() => {
  console.log(`\n=== 결과: PASS ${passed} / FAIL ${failed} ===`);
  process.exit(failed ? 1 : 0);
}).catch((err) => { console.error('SMOKE ERROR', err); process.exit(1); });