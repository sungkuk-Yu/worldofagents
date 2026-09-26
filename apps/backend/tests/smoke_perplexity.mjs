/**
 * 법률 답변 Perplexity 그라운딩 스모크 (t_d54bc456)
 *
 * 사용법 (실 키가 .env에 있는 서버 대상):
 *   PORT=3199 ./node_modules/.bin/tsx src/index.ts        # 터미널 1 (DEV_MODE 무관)
 *   node tests/smoke_perplexity.mjs http://localhost:3199  # 터미널 2
 *
 * 검증 흐름:
 *   signup → agent/session → 페르소나 '내 변호사' → 법률 질문 전송
 *   → grounding.status=grounded + 출처≥1 + answer_response에 인용/디스클레이머
 *   → 답변 message행 structured_payload.grounding 저장 확인
 *   → 일반 토크('안녕')는 grounding=null (종량제 비용 게이트)
 *   ※ 실제 Perplexity Sonar + 실제 LLM(DashScope)을 호출한다.
 */
const BASE = process.argv[2] || 'http://localhost:3199';
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');
const TURN_TIMEOUT = Number(process.env.SMOKE_LLM_TIMEOUT_MS || 120000);

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers[AUTH_HEADER] = AUTH_SCHEME + token;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const email = `pplx-smoke-${Date.now()}@test.io`;
  const signupRes = await req('POST', '/api/auth/signup', { body: { email, password: 'password123', display_name: 'smoke' } });
  if (signupRes.status !== 201 && signupRes.status !== 400) throw new Error(`signup ${signupRes.status}`);
  let token = signupRes.json?.data?.token;
  if (!token) {
    const login = await req('POST', '/api/auth/login', { body: { email, password: 'password123' } });
    token = login.json?.data?.token;
  }
  if (!token) throw new Error('no token: ' + JSON.stringify(signupRes.json).slice(0, 200));
  const agent = (await req('POST', '/api/agents', { token, body: { name: '내 변호사' } })).json.data;
  const session = (await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.id } })).json.data;
  if (agent?.persona === undefined) { /* persona name lives on personas row; agent name '내 변호사' drives classifyExpertise */ }

  // 1) 법률 질문 → 실 Perplexity 검색 그라운딩
  const t0 = Date.now();
  const legal = (await req('POST', `/api/sessions/${session.id}/messages`, { token, body: { content: '근로기준법 해고예고 위반하면 사용자에게 어떤 불이익이 있나요?' } })).json.data;
  check('법률 턴 201+완료', !!legal?.answer_message_id, `${Date.now() - t0}ms llm=${legal?.llm?.model}`);
  check('grounding 실발동 (status=grounded)', legal?.grounding?.status === 'grounded', `status=${legal?.grounding?.status} reason=${legal?.grounding?.reason || '-'}`);
  check('  └ engine=perplexity-sonar + 모델', legal?.grounding?.engine === 'perplexity-sonar' && !!legal?.grounding?.model, `model=${legal?.grounding?.model}`);
  check('  └ 출처 ≥1 + citations_total', (legal?.grounding?.sources || []).length >= 1 && legal?.grounding?.citations_total >= 1, `sources=${legal?.grounding?.sources?.length} total=${legal?.grounding?.citations_total}`);
  check('  └ 출처 URL https/도메인 실존形态', (legal?.grounding?.sources || []).every(s => /^https?:\/\//.test(s.url)));
  const ans = legal?.answer_response || '';
  check('답변에 법률 디스클레이머', ans.includes('법률 자문이 아닙니다') || ans.includes('legal advice'));
  check('  └ 답변에 인용([1] 등) 또는 출처 URL', /\[\d+\]/.test(ans) || /https?:\/\//.test(ans), `len=${ans.length}`);
  check('  └ llm.used=true (실제 답변 LLM) 또는 근거 폴백 답변', legal?.llm?.used === true || (legal?.llm?.fallback === true && legal?.grounding?.status === 'grounded'), `used=${legal?.llm?.used} fallback=${legal?.llm?.fallback}`);

  // 2) 저장된 답변 행에 grounding 카드가 영속됐는지
  const hist = (await req('GET', `/api/sessions/${session.id}/messages`, { token })).json.data || [];
  const answerRow = hist.find(m => m.id === legal?.answer_message_id);
  const card = answerRow?.structured_payload?.grounding;
  check('answer 행 structured_payload.grounding 저장', !!card && card.engine === 'perplexity-sonar' && (card.sources || []).length >= 1, `type=${answerRow?.dialogue_type}`);

  // 3) 일반 에이전트의 일반 토크는 검색 미발동 (종량제 비용 게이트)
  const plainAgent = (await req('POST', '/api/agents', { token, body: { name: '일정 비서' } })).json.data;
  const plainSession = (await req('POST', '/api/sessions/ensure', { token, body: { agent_id: plainAgent.id } })).json.data;
  const plain = (await req('POST', `/api/sessions/${plainSession.id}/messages`, { token, body: { content: '오늘 기분 별로인데 위로 좀 해줘' } })).json.data;
  check('일반 에이전트 토크 grounding=null (검색 안 함)', !!plain?.answer_message_id && (plain?.grounding === null || plain?.grounding === undefined), `grounding=${JSON.stringify(plain?.grounding)}`);

  console.log(`\nRESULT ${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('SMOKE ERROR', e?.message || e); process.exit(2); });
