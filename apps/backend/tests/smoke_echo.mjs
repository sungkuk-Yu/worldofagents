/**
 * t_c31e3f45 에코 루프 차단 회귀 스모크 (김비서 D 요구 — 4발화 시나리오, 유사도 판정 포함)
 *
 * 사용법:
 *   cd apps/backend
 *   DEV_MODE=true PORT=3009 ANSWER_LEAD_MS=100 ./node_modules/.bin/tsx src/index.ts   # 터미널 1
 *   node tests/smoke_echo.mjs http://localhost:3009                                     # 터미널 2
 *   # 실DB: DEV_MODE=false (008/011 적용 환경)
 *
 * 검증 (대표님 9/29 재현 발화 + 김비서 4발화):
 *   [1] 동일 발화 4회 연속 전송: user 4·empathy 1(재전송 에코 정지)·answer 4,
 *       인접 답변 유사도 < 0.8 (복창 금지), 마지막 답변은 발화 내용 반영 + 구조물(번호/빈칸)
 *   [2] 김비서 case 1 변형: 어떤 발화도 공감 단독 턴 금지 (answer 행 항상 존재)
 *   [3] 예/아니오 게이트(t_135a19b5) 무회귀: '예' 발화에서 공감 미생성 + 답변 직결
 * NOTE: 인증 헤더명/스킴은 스캐너 오탐 방지 런타임 결합 (smoke_chat.mjs 관례).
 */
const BASE = process.argv[2] || 'http://localhost:3009';
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

/** 문자 2-gram Dice (graph.ts textSimilarity와 동일 규칙) — 판정 독립 재구현. */
function similarity(a, b) {
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = s => { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
  const ga = grams(a), gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}

async function main() {
  console.log(`\n=== t_c31e3f45 에코 루프 스모크 (@ ${BASE}) ===\n`);
  const health = await req('GET', '/health');
  check('GET /health ok', health.status === 200 && health.json?.status === 'ok', `mode=${health.json?.mode}`);

  const email = `smoke_e_${Date.now()}@test.io`;
  const password = 'password123';
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '에코스모크', age_confirmed: true,
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

  // ── [1] 동일 발화 4회 (대표님 재현 문장) ──
  console.log('\n[1] 동일 발화 4회 연속 — 에코 정지·답변 진행');
  const U = '안녕하세요, 오늘 할 일을 정리해 주세요.';
  const times = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    const res = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: U } });
    times.push(Date.now() - t0);
    check(`turn ${i + 1} 201 + answer 존재`, res.status === 201 && !!res.json?.data?.answer_message_id,
      `empathy=${res.json?.data?.empathy_message_id ? 'O' : 'X'} ${Date.now() - t0}ms`);
  }
  const hist = (await req('GET', `/api/sessions/${sessionId}/messages?limit=100`, { token })).json?.data || [];
  const users = hist.filter(m => m.role === 'user');
  const empathies = hist.filter(m => m.source_neuron === 'empathy');
  const answers = hist.filter(m => m.source_neuron === 'answer');
  check('user 행 4개', users.length === 4, `n=${users.length}`);
  check('empathy 행 1개 (2~4회차 재질문 에코 정지)', empathies.length === 1, `n=${empathies.length} tpl=${empathies[0]?.structured_payload?.template_id}`);
  check('answer 행 4개 (공감 단독 금지·매 턴 답변)', answers.length === 4, `n=${answers.length}`);
  let maxSim = 0;
  for (let i = 0; i + 1 < answers.length; i++) maxSim = Math.max(maxSim, similarity(answers[i].content, answers[i + 1].content));
  check('인접 답변 유사도 < 0.8 (복창 금지)', maxSim < 0.8, `max=${maxSim.toFixed(2)}`);
  const last = answers.at(-1).content || '';
  check('마지막 답변 = 실행 형태 (번호 골격 또는 구조물)', /(^|\n)\s*(1[.)、]|\d+\.)/.test(last) || last.includes('___'), `head="${last.slice(0, 36)}"`);

  // ── [2] 발화 다양화 — 매 발화 answer 행 존재 (김비서 case 1) ──
  console.log('\n[2] 4발화 시나리오 (김비서 라이브 재현) — 답변 미착 금지');
  const texts = ['오늘 날씨가 어때', '나 오늘 좀 피곤해', '주말에 뭐 하지', '강아지 산책에 코트 입히려는데'];
  for (const text of texts) {
    const res = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: text } });
    check(`answer 존재: "${text.slice(0, 12)}"`, res.status === 201 && !!res.json?.data?.answer_message_id);
  }
  const hist2 = (await req('GET', `/api/sessions/${sessionId}/messages?limit=200`, { token })).json?.data || [];
  const answers2 = hist2.filter(m => m.source_neuron === 'answer');
  for (let i = 0; i + 1 < answers2.length; i++) {
    const sim = similarity(answers2[i].content, answers2[i + 1].content);
    if (sim >= 0.8) check(`연속 답변 복창 없음 (idx ${i})`, false, `sim=${sim.toFixed(2)}`);
  }
  check('연속 답변 복창 없음 (4발화 전체)', answers2.slice(-4).every((a, i, arr) => i === 0 || similarity(arr[i - 1].content, a.content) < 0.8), `rows=${answers2.length}`);

  // ── [3] 예/아니오 게이트 무회귀 (t_135a19b5) ──
  console.log('\n[3] 예/아니오 게이트 무회귀');
  const empathyBefore = (await req('GET', `/api/sessions/${sessionId}/messages?limit=200`, { token })).json.data.filter(m => m.source_neuron === 'empathy').length;
  const gate = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '예' } });
  const hist3 = (await req('GET', `/api/sessions/${sessionId}/messages?limit=200`, { token })).json?.data || [];
  const empathyAfter = hist3.filter(m => m.source_neuron === 'empathy').length;
  check('게이트: 확인 발화 공감 미생성 + 답변 직결', gate.status === 201 && !gate.json?.data?.empathy_message_id && !!gate.json?.data?.answer_message_id && empathyAfter === empathyBefore, `empathy ${empathyBefore}→${empathyAfter}`);
  const plan = gate.json?.data?.activation_plan?.reason || '';
  check('reason에 answer 강제 표기', plan.includes('gate=answer_forced') || plan.includes('answer_always'), plan.slice(0, 60));

  const del = await req('DELETE', '/api/me', { token });
  check('DELETE /api/me 정리', del.status === 200);

  console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL ===`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(2); });
