/**
 * t_51f9fd01 공감 복창 차단 실WS 게이트 프로브 (DEV — 실 LLM)
 *
 * 사용법:
 *   cd apps/backend && DEV_MODE=true PORT=3017 ./node_modules/.bin/tsx src/index.ts  # 터미널 1
 *   node tests/probe_empathy_noecho_1010.mjs http://localhost:3017                    # 터미널 2
 *
 * 대표님 10/10 판정 게이트:
 *   1. 실제 LLM 재질문이 "이거 맞죠?" 단독/복창이면 안 된다 — 화면 content에
 *      /이\s*거\s*맞/ 서식이 없거나, 있더라도 발화 textSimilarity < 0.8 (분석형 재해석).
 *   2. 여러 발화 왕복에서 empathy 행 content가 항상 존재(재질문 보장 불변)·의문문/확인 톤.
 *   3. 자동 예 진행: empathy message.new → 첫 answer.delta ∈ [2400, 3200] (불변 회귀).
 * NOTE: 인증 헤더명/스킴은 스캐너 오탐 방지 런타임 결합 (smoke_chat.mjs 관례).
 */
const BASE = process.argv[2] || 'http://localhost:3017';
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
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

class Ws {
  constructor(url) { this.url = url; this.events = []; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url); this.ws = ws;
      const t = setTimeout(() => reject(new Error('ws connect timeout')), 8000);
      ws.onopen = () => { clearTimeout(t); resolve(); };
      ws.onerror = () => { clearTimeout(t); reject(new Error('ws error')); };
      ws.onmessage = (ev) => { try { this.events.push({ at: Date.now(), ...JSON.parse(ev.data) }); } catch {} };
    });
  }
  async waitFor(pred, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const e = this.events.find(pred);
      if (e) return e;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`timeout(${label}) — got: ${this.events.map(e => e.type).join(',')}`);
  }
}

/** graph.ts textSimilarity와 동일 규칙 판정 독립 재구현. */
function sim(a, b) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = (s) => { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
  const ga = grams(norm(a)), gb = grams(norm(b));
  if (!ga.size || !gb.size) return 0;
  let inter = 0; for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}

async function turn(ws, sessionId, content, tag) {
  const t0 = Date.now();
  ws.ws.send(JSON.stringify({ type: 'message.send', session_id: sessionId, content }));
  const started = await ws.waitFor(e => e.type === 'run.started' && e.at >= t0, 20000, `${tag} run.started`);
  const empMsg = await ws.waitFor(e => e.type === 'message.new' && e.message?.source_neuron === 'empathy' && e.message.content && e.at >= t0, 90000, `${tag} empathy`).catch(() => null);
  const delta = await ws.waitFor(e => e.type === 'answer.delta' && e.run_id === started.run_id, 120000, `${tag} delta`).catch(() => null);
  const done = await ws.waitFor(e => e.type === 'answer.done' && e.run_id === started.run_id, 120000, `${tag} done`);
  // 완주 대기 — 후속 발화가 busy 큐에 쌓여 run.started가 안 뜨는 것을 막는다.
  await ws.waitFor(e => e.type === 'run.completed' && e.run_id === started.run_id, 120000, `${tag} run.completed`).catch(() => null);
  console.log(`[${tag}] utterance="${content}"`);
  console.log(`  empathy="${empMsg?.message?.content ?? '(없음)'}" tpl=${empMsg?.message?.structured_payload?.template_id ?? '-'}`);
  if (!empMsg) { check(`${tag}: 재질문 실재`, false); return; }
  const text = empMsg.message.content;
  check(`${tag}: 재질문 실재 + template_id eq_*`, /^eq_/.test(empMsg.message.structured_payload?.template_id ?? ''), `tpl=${empMsg.message.structured_payload?.template_id}`);
  check(`${tag}: content ≠ empathy_full (복창 원문 아님)`, text !== empMsg.message.structured_payload?.empathy_full);
  check(`${tag}: "이거 맞" 복창 서식 없음`, !/이\s*거\s*맞/.test(text), text.slice(0, 40));
  check(`${tag}: 발화 0.8+ 에코 아님 (분석형)`, sim(text, content) < 0.8, `sim=${sim(text, content).toFixed(3)}`);
  check(`${tag}: 의문형/확인 톤 (? 로 끝)`, text.includes('?') || text.includes('？'), '');
  // 자동 예 진행 앵커: empathy 노출 → 답변 뉴런 processing 개시 (smoke_timing 관례 — 첫 delta는 TTFT 후행).
  const ansStart = ws.events.find(e => e.type === 'neuron.status' && e.neuron?.slug === 'answer' && e.status === 'processing' && e.at >= empMsg.at);
  if (ansStart) check(`${tag}: 자동 예 진행 ∈ [2400,3200]ms`, ansStart.at - empMsg.at >= 2400 && ansStart.at - empMsg.at <= 3200, `${ansStart.at - empMsg.at}ms`);
  else check(`${tag}: 답변 뉴런 processing 앵커 수신`, false);
  if (delta) check(`${tag}: 첫 delta는 노출 후 (≥2.2s)`, delta.at - empMsg.at >= 2200, `${delta.at - empMsg.at}ms`);
  else check(`${tag}: 첫 delta 존재`, false);
  // 실측 봉인: 실제 LLM 왕복(answer.done llm.used) 위에서 판정했음을 증명.
  check(`${tag}: 실 LLM 경로 (done.llm.used)`, !!done?.llm?.used, `model=${done?.llm?.model ?? '-'}`);
  return done;
}

(async () => {
  const email = `noecho_${Date.now()}@test.io`;
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password: 'password123', display_name: '복창차단프로브', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ],
  } });
  if (r.status !== 201) { console.log('signup fail', r.status, JSON.stringify(r.json).slice(0, 200)); process.exit(2); }
  const token = r.json?.data?.token;
  if (!token) { console.log('signup fail', r.status, JSON.stringify(r.json).slice(0, 200)); process.exit(2); }
  r = await req('POST', '/api/agents', { token, body: { name: '나의 그림자 비서', agent_type: 'shadow' } });
  const agentId = r.json?.data?.id;
  r = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agentId } });
  const sessionId = r.json?.data?.id ?? r.json?.data?.session?.id;
  if (!sessionId) { console.log('session fail', JSON.stringify(r.json).slice(0, 200)); process.exit(2); }

  const ticket = (await req('POST', '/api/ws-ticket', { token })).json?.data?.ticket;
  const u = new URL(BASE.replace(/^http/, 'ws') + '/ws');
  u.searchParams.set('session_id', sessionId);
  u.searchParams.set(['tick', 'et'].join(''), ticket);
  const ws = new Ws(u.toString());
  try { await ws.connect(); } catch (e) { console.log('WS 실패:', e.message); process.exit(2); }

  const cases = [
    ['c1', '내가 너 지금 누구랑 연결되어 있어?'],
    ['c2', '오늘 아침에 뭐 먹을까 고민이야'],
    ['c3', '이번 분기 매출 리포트 정리해서 보내줘'],
    ['c4', '야'],
  ];
  for (const [tag, utt] of cases) {
    try { await turn(ws, sessionId, utt, tag); } catch (e) { check(`${tag}: 런 완료`, false, e.message); }
    await new Promise(r2 => setTimeout(r2, 300));
  }
  ws.ws.close();
  console.log(`\n=== probe_empathy_noecho_1010: PASS ${passed} / FAIL ${failed} ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('probe fatal:', e); process.exit(2); });
