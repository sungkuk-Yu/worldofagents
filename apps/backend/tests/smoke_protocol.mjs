/**
 * t_3486b1d7 프로토콜 종단 스모크 — ①② random_id 멱등+reconcile 에코, ③ seq diff sync, ⑤ 순서 (9/30)
 *
 * 사용법:
 *   cd apps/backend
 *   # DEV_MODE 인메모리 (devstore insert가 client_req_id 기본 null — 013 형상 대칭):
 *   DEV_MODE=true PORT=3987 STANDALONE=true ./node_modules/.bin/tsx src/index.ts   # 터미널 1
 *   node tests/smoke_protocol.mjs http://localhost:3987                            # 터미널 2
 *   # 실DB: 013 적용 후 DEV_MODE=false 재실행 (멱등 히트/CONFLICT 실인덱스 경로는 실DB에서만).
 *
 * 검증:
 *  [1] ⑤ WS 라이브 순서: message.new(user) → run.started (user 카드 선행 계약).
 *  [2] ② reconcile 에코: 동일 client_req_id WS 재전송 → message.new{deduped:true} 1건 + run.* 0건,
 *      같은 message_id. user 행 1개 유지. 3차 재전송도 동일.
 *  [3] REST 재전송: deduped:true 응답 + messages.user = 기존 행.
 *  [4] ③ GET /events?after_seq: 이후 seq 이벤트 단조 반환, current_seq/seq_epoch, truncated=false.
 *      after_seq=-1 → 400.
 *  [5] 무 client_req_id 발화 회귀: 멱등 없음 = 정상 실행 (deduped 없음).
 *  [6] (t_8bac5645) 음성 hold-for-edit: audio.send→final+영속 회귀, audio.end{draft}→transcript.draft
 *      비영속(최소 인그레스 — user/run/final/seq/멱등 저장 0), audio.cancel 폐기 무영향,
 *      ServerMessage 타입 완전성 정적 프루브 (선언-only 유령 0건).
 */
const BASE = process.argv[2] || 'http://localhost:3987';
const WS_BASE = BASE.replace(/^http/, 'ws');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* no body */ }
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
  console.log(`\n=== t_3486b1d7 프로토콜 스모크 (@ ${BASE}) ===\n`);
  const health = await req('GET', '/health');
  check('GET /health ok', health.status === 200 && health.json?.status === 'ok', `mode=${health.json?.mode}`);

  const email = `smoke_protocol_${Date.now()}@test.io`;
  const password = 'password123';
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '프로토콜스모크', age_confirmed: true,
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

  const agent = await req('POST', '/api/agents', { token, body: { name: '프로토콜 에이전트', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } });
  const sessionId = sess.json?.data?.id;
  check('agent+session', !!sessionId);

  const ticketRes = await req('POST', '/api/ws-ticket', { token });
  const wsTicket = ticketRes.json?.data?.ticket;
  const ws = new WsCollector(`${WS_BASE}/ws?session_id=${sessionId}&${['tick','et'].join('')}=${wsTicket}`);
  await ws.connect();
  ws.send({ type: 'subscribe', session_id: sessionId });
  const sub = await ws.waitFor(e => e.type === 'subscribed', { label: 'subscribed' });

  const clientReqId = `req-${Date.now()}-A`;

  // [1] ⑤ 첫 전송: message.new(user) → run.started 순 (라이브 WS wire 계약).
  ws.send({ type: 'message.send', session_id: sessionId, content: '프로토콜 첫 발화', client_req_id: clientReqId });
  const firstCard = await ws.waitFor(e => e.type === 'message.new' && e.message?.role === 'user' && e.message?.content === '프로토콜 첫 발화', { label: 'user 카드' });
  await ws.waitFor(e => e.type === 'run.started', { label: 'run.started' });
  const idxCard = ws.events.indexOf(firstCard);
  const idxStarted = ws.events.findIndex(e => e.type === 'run.started');
  check('⑤ user 카드 → run.started 순 (wire)', idxCard >= 0 && idxStarted > idxCard, `card@${idxCard} started@${idxStarted}`);
  check('⑤ user 카드에 user_message_id+client_req_id', !!firstCard.user_message_id && firstCard.message.client_req_id === clientReqId);
  const userId1 = firstCard.message.id;
  await ws.waitFor(e => e.type === 'run.completed' || e.type === 'run.failed', { label: 'run 종결' });

  // [2] ② 동일 client_req_id 재전송: message.new(deduped) 1건 + run.* 0건, 같은 message_id.
  const before = ws.events.length;
  const runsBefore = ws.events.filter(e => e.type.startsWith('run.')).length;
  ws.send({ type: 'message.send', session_id: sessionId, content: '프로토콜 첫 발화', client_req_id: clientReqId });
  const echo = await ws.waitFor(ev => ev.type === 'message.new' && ev.deduped === true, { label: 'dedup 에코', timeoutMs: 15000 });
  await new Promise(res => setTimeout(res, 1500)); // 추가 run 이벤트 유입 관찰 창
  const echoEvents = ws.events.slice(before).filter(e => e.type !== 'pong');
  check('② 재전송: message.new 1건뿐', echoEvents.length === 1, `events=${echoEvents.map(e => e.type).join(',')}`);
  check('② 에코 deduped:true + 같은 message_id', echo.deduped === true && echo.message.id === userId1);
  check('② 에코 run.* 0건', ws.events.filter(e => e.type.startsWith('run.')).length === runsBefore);
  check('② 에코 message.client_req_id 보유', echo.message.client_req_id === clientReqId);

  // [3] REST 재전송: deduped:true, user 행 1개 유지.
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '프로토콜 첫 발화', client_req_id: clientReqId } });
  check('③ REST 재전송 201 + deduped:true', r.status === 201 && r.json?.data?.deduped === true, `deduped=${r.json?.data?.deduped}`);
  check('③ REST 재전송 같은 user_message_id', r.json?.data?.user_message_id === userId1);
  const hist = await req('GET', `/api/sessions/${sessionId}/messages`, { token });
  const userRows = (hist.json?.data || []).filter(m => m.role === 'user' && m.client_req_id === clientReqId);
  check('③ user 행 1개 유지 (멱등)', userRows.length === 1, `count=${userRows.length}`);
  check('③ read-back client_req_id', userRows[0]?.client_req_id === clientReqId);

  // [4] ③ GET /events?after_seq diff sync.
  const midSeq = sub.current_seq;
  const ev = await req('GET', `/api/sessions/${sessionId}/events?after_seq=${midSeq}`, { token });
  check('③ events 200', ev.status === 200);
  const evs = ev.json?.data?.events || [];
  check('③ after_seq 이후만 + 단조 seq', evs.length > 0 && evs.every((e, i, a) => e.seq > midSeq && (i === 0 || e.seq > a[i - 1].seq)), `n=${evs.length} current_seq=${ev.json?.data?.current_seq}`);
  check('③ seq_epoch 일치(재기동 감지 필드)', ev.json?.data?.seq_epoch === sub.seq_epoch);
  check('③ truncated=false', ev.json?.data?.truncated === false);
  check('③ 디듀프 에코도 시퀀스 버퍼에', evs.some(e => e.type === 'message.new' && e.deduped === true));
  const bad = await req('GET', `/api/sessions/${sessionId}/events?after_seq=-1`, { token });
  check('③ after_seq=-1 → 400', bad.status === 400);

  // [5] client_req_id 없는 발화 회귀 — 멱등 없음, 정상 실행.
  ws.send({ type: 'message.send', session_id: sessionId, content: '멱등 없는 평범 발화' });
  await ws.waitFor(e => e.type === 'message.new' && e.message?.content === '멱등 없는 평범 발화', { label: '평범 user 카드' });
  const plain = await ws.waitFor(e => (e.type === 'run.completed' || e.type === 'run.failed') && e.run_id && e.session_id === sessionId, { label: '평범 run 종결' }).catch(() => null);
  await new Promise(res => setTimeout(res, 800));
  const plainCard = ws.events.find(e => e.type === 'message.new' && e.message?.content === '멱등 없는 평범 발화');
  check('⑤ 평범 발화도 user 카드 선행', ws.events.indexOf(plainCard) < ws.events.findIndex(e => e.type === 'run.started' && e.run_id === plainCard.run_id));
  check('⑤ 평범 발화 행은 client_req_id null', plainCard.message.client_req_id === null);

  // [6] 음성 hold-for-edit 브리지 + 발화 회귀 (t_8bac5645).
  // 실행 전제: DEV_MODE + STT 봉인(OPENAI_API_KEY='', 사이드카 없음) → mock STT가 톤에
  // MOCK_STT_PHRASE를 확정에 반환한다 (타이밍·호출수 민감 스모크 봉인 관례).
  //  [6]a ServerMessage 타입 완전성 (카드 verbatim '전체 이벤트 열거'): protocol.ts union의
  //      type 리터럴 전원이 발행 지점(sendJson/broadcastToSession/emit 리터럴)을 갖는다 —
  //      신규 이벤트 wire 누락 사고(선언-only 유령) 회귀. 스모크는 로컬 소스에서 실행되므로
  //      readFileSync 정적 프루브가 가능 (seed-baseline-015 관례). 화이트리스트 = 의도된
  //      선언-only(클라이언트 회신용 ping 재전송 없음) 또는 중개 발행(emit 콜백 경유) 관리.
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const protoSrc = readFileSync('src/websocket/protocol.ts', 'utf8');
  const unionBlock = protoSrc.slice(protoSrc.indexOf('export type ServerMessage'), protoSrc.indexOf('export const NEURON_NAMES'));
  const declaredEventTypes = [...new Set([...unionBlock.matchAll(/type:\s*'([a-z_.]+)'/g)].map(m => m[1]))];
  const walkFiles = (dir) => readdirSync(dir).flatMap(f => { const p = `${dir}/${f}`; return statSync(p).isDirectory() ? walkFiles(p) : (p.endsWith('.ts') ? [p] : []); });
  const srcAll = walkFiles('src').filter(p => !p.endsWith('protocol.ts')).map(p => readFileSync(p, 'utf8')).join('\n');
  // 선언-only 베이스라인 (t_8bac5645 이전부터 미배선 유산 — 아카이브는 REST 응답으로 마감,
  // task 캐리어는 Phase 2 유령, ping heartbeat은 pong 회신만). 이 목록 외 신규 유령 = FAIL:
  // 신규 이벤트는 발행 지점 필수 (카드 검수 4 '전체 이벤트 열거'의 wire 완전성 의도).
  const STATIC_ONLY_ALLOWED = new Set(['ping', 'task.status', 'session.archived']);
  const ghostTypes = declaredEventTypes.filter(t => !STATIC_ONLY_ALLOWED.has(t) && !new RegExp(`type:\\s*'${t.replace('.', '\\.')}'`).test(srcAll));
  check('⑥a ServerMessage 타입 완전성 — 유령(발행 지점 없음) 0건', ghostTypes.length === 0, `declared=${declaredEventTypes.length} ghost=[${ghostTypes.join(',')}]`);
  check('⑥a transcript.draft 선언+발행 실재', declaredEventTypes.includes('transcript.draft') && /type:\s*'transcript\.draft'/.test(srcAll));
  const pcm = (() => { // 3초 16k s16le 사인파 (hasVoiceActivity 통과)
    const n = 16000 * 3;
    const buf = new Uint8Array(n * 2);
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < n; i++) dv.setInt16(i * 2, Math.round(12000 * Math.sin(2 * Math.PI * 220 * i / 16000)), true);
    return buf;
  })();
  // offset-기존 대기: 이전 위상의 동일 타입 이벤트와 매칭되지 않게 기준 인덱스 이후만 본다.
  const waitForAfter = (base, pred, label, timeoutMs = 90000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      for (let i = Math.max(base, 0); i < ws.events.length; i++) if (pred(ws.events[i], i)) { clearInterval(iv); resolve(ws.events[i]); return; }
      if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error(`wait timeout (${label})`)); }
    }, 60);
  });
  const sendPcm = () => { for (let i = 0; i < pcm.length; i += 65536) ws.ws.send(pcm.slice(i, i + 65536)); };

  //  [6]b audio.start→ PCM → audio.end(draft absent) 발화 회귀: transcript.final 확정 id + user message.new.
  const beforeVoice = ws.events.length;
  const runsBefore6 = ws.events.filter(e => e.type.startsWith('run.')).length;
  const seqBefore6 = sub.current_seq;
  ws.send({ type: 'audio.start', session_id: sessionId, config: { sample_rate: 16000, encoding: 'pcm_s16le' } });
  const audioStarted = await waitForAfter(beforeVoice, e => e.type === 'audio.started', 'audio.started', 10000).catch(() => null);
  check('⑥b audio.started wire (config echo)', !!audioStarted?.config && audioStarted.config.sample_rate === 16000);
  sendPcm();
  ws.send({ type: 'audio.end', session_id: sessionId });
  const final6 = await waitForAfter(beforeVoice, e => e.type === 'transcript.final' && e.text, 'transcript.final(음성)').catch(() => null);
  check('⑥b 음성 발화 → transcript.final (확정 id)', !!final6 && typeof final6.message_id === 'string' && final6.message_id.length > 0, final6 ? `text="${(final6.text || '').slice(0, 24)}"` : 'timeout');
  check('⑥b user message.new 영속 (audio.send 경로)', !!final6 && ws.events.some(e => e.type === 'message.new' && e.message?.role === 'user' && e.message?.id === final6.message_id));
  // 런 종결까지 대기 — 이후 [6]c 윈도우에 잔류 run.*/message.new가 섞이지 않게.
  await waitForAfter(beforeVoice, e => e.type === 'run.completed' || e.type === 'run.failed', '음성 런 종결', 120000).catch(() => null);
  check('⑥b 음성 런 run.* 진행', ws.events.filter(e => e.type.startsWith('run.')).length > runsBefore6);

  //  [6]c audio.end{draft:true} hold-for-edit — 전사 회신만, 발화 비영속.
  await new Promise(res => setTimeout(res, 300));
  const before6c = ws.events.length;
  const msgCount = async () => (((await req('GET', `/api/sessions/${sessionId}/messages`, { token })).json?.data) || []).length;
  const rowsBefore6c = await msgCount();
  ws.send({ type: 'audio.start', session_id: sessionId, config: {} });
  await waitForAfter(before6c, e => e.type === 'audio.started', 'audio.started(draft)', 10000).catch(() => null);
  sendPcm();
  ws.send({ type: 'audio.end', session_id: sessionId, draft: true });
  const draft = await waitForAfter(before6c, e => e.type === 'transcript.draft' && e.text, 'transcript.draft').catch(() => null);
  check('⑥c transcript.draft wire 필드 5종', !!draft && typeof draft.text === 'string' && typeof draft.confidence === 'number' && typeof draft.language === 'string' && typeof draft.duration_ms === 'number' && draft.session_id === sessionId, draft ? `keys=${Object.keys(draft).sort().join(',')} text="${(draft.text || '').slice(0, 24)}"` : 'timeout');
  check('⑥c draft에 seq 미채번 (발화 소켓 회신 전용)', !!draft && !('seq' in draft));
  await new Promise(res => setTimeout(res, 800)); // 잔류 전파 관찰 창
  const win6c = ws.events.slice(before6c);
  check('⑥c draft 윈도우: transcript.final 0건', !win6c.some(e => e.type === 'transcript.final'));
  check('⑥c draft 윈도우: message.new 0건', !win6c.some(e => e.type === 'message.new'));
  check('⑥c draft 윈도우: run.* 0건', win6c.filter(e => e.type.startsWith('run.')).length === 0, win6c.filter(e => e.type.startsWith('run.')).map(e => e.type).join(','));
  check('⑥c user 행 영속 0 (read-back)', (await msgCount()) === rowsBefore6c, `before=${rowsBefore6c} after=${await msgCount()}`);

  //  [6]d audio.cancel 폐기 계약 무영향.
  const before6d = ws.events.length;
  ws.send({ type: 'audio.start', session_id: sessionId, config: {} });
  await waitForAfter(before6d, e => e.type === 'audio.started', 'audio.started(cancel)', 10000).catch(() => null);
  sendPcm();
  ws.send({ type: 'audio.cancel', session_id: sessionId });
  await new Promise(res => setTimeout(res, 400));
  const win6d = ws.events.slice(before6d);
  check('⑥d cancel: transcript.draft/final 0건·vad off', !win6d.some(e => e.type === 'transcript.draft' || e.type === 'transcript.final') && win6d.some(e => e.type === 'audio.vad' && e.active === false));
  ws.send({ type: 'audio.end', session_id: sessionId, draft: true }); // cancel된 세그먼트 릴리스
  const err6d = await waitForAfter(before6d, e => e.type === 'error' && e.code === 'VALIDATION_ERROR', 'cancel 후 error', 8000).catch(() => null);
  check('⑥d cancel 후 audio.end{draft} → VALIDATION_ERROR', !!err6d && (err6d.message || '').includes('활성 오디오 스트림'), err6d?.message);

  //  [6]e diff 리플레이에 draft 무채번 — 마지막 final seq 이후 events()에 draft 없음.
  const lastFinalSeq = [...ws.events].reverse().find(e => e.type === 'transcript.final' && typeof e.seq === 'number')?.seq ?? seqBefore6;
  const diff6 = await req('GET', `/api/sessions/${sessionId}/events?after_seq=${lastFinalSeq}`, { token });
  check('⑥e events diff: draft 재폭주 없음', diff6.status === 200 && !(diff6.json?.data?.events || []).some(e => e.type === 'transcript.draft'), `n=${(diff6.json?.data?.events || []).length}`);

  ws.close();
  console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error('SMOKE ERROR:', err?.message || err); process.exit(2); });
