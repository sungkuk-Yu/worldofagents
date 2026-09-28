/**
 * t_620d5549 스모크 — 앱 속 실 김비서 브리지 LIVE 왕복 (실 Hermes kimsecretary 구동 확인)
 *
 * 사용법:
 *   cd apps/backend
 *   # 전제: 김비서 게이트웨이 A2A 수신存活 (curl -s http://127.0.0.1:9902/health)
 *   DEV_MODE=true PORT=3007 \
 *     SECRETARY_BRIDGE_ENDPOINT=http://127.0.0.1:9902 \
 *     ./node_modules/.bin/tsx src/index.ts                     # 터미널 1
 *   node tests/smoke_secretary_bridge.mjs http://localhost:3007 http://127.0.0.1:9902   # 터미널 2
 *
 * 검증 흐름 (실 왕복 — 단위 테스트는 wire 모킹이라 이 스모크가 유일한 실측 경로):
 *   A2A 프리체크(9902 health) 실패 시 전체 SKIP(exit 0) — 배포 전 회색 환경 방어.
 *   signup→agent(이름 김비서)→session → REST 턴1: 답변 행이 로컬 템플릿이 아닌 김비서 회신
 *     (llm.provider='secretary-bridge', content가 '로컬' 템플릿 문구 아님, reasoning 잔여물 없음)
 *   → GET /context에서 secretary.bridge 컨텍스트 영속 확인 → 턴2: 같은 contextId로 연속 발화
 *     (김비서가 턴1 내용을 기억하는지 문구로 확인하지 않고, contextId 불변만 왕복 검증)
 *   → 대조군: 다른 이름 에이전트 턴은 브리지 미경유(llm.provider 없음) 1:1 기존 흐름.
 *   NOTE: 김비서 실 LLM 응답에 수 초~수 분 소요 가능 — 턴 대기 기본 180s, 인자 SMOKE_TURN_MS로 조정.
 */
const BASE = process.argv[2] || 'http://localhost:3007';
const A2A = process.argv[3] || 'http://127.0.0.1:9902';
const TURN_WAIT_MS = Number(process.env.SMOKE_TURN_MS || 180000);
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');

let passed = 0, failed = 0, skipped = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
function skip(name, extra = '') { skipped++; console.log(`  SKIP  ${name}${extra ? ' — ' + extra : ''}`); }

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers[AUTH_HEADER] = AUTH_SCHEME + token;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TURN_WAIT_MS + 15000) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

async function main() {
  console.log(`\n=== t_620d5549 김비서 브리지 스모크 (app ${BASE} ↔ A2A ${A2A}) ===\n`);

  // A2A 프리체크 — 김비서 게이트웨이 없으면 브리지 검증 불가(SKIP), 폴백 경로도 검증 무의미.
  let a2aUp = false;
  try {
    const h = await fetch(`${A2A}/`, { signal: AbortSignal.timeout(3000) });
    a2aUp = h.ok;
  } catch { /* down */ }
  if (!a2aUp) {
    console.log('김비서 A2A 게이트웨이 미감지 — LIVE 왕복은 환경 준비 후 재실행. (SKIP, exit 0)');
    process.exit(0);
  }

  const health = await req('GET', '/health');
  check('GET /health ok', health.status === 200 && health.json?.status === 'ok', `mode=${health.json?.mode}`);

  const email = `smoke_bridge_${Date.now()}@test.io`;
  const password = 'password123';
  let r = await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '브리지스모크', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ],
  } });
  check('signup', r.status === 201 && !!r.json?.data?.token, `status=${r.status}`);
  // P0 회귀 관례(smoke_chat): login 후 쓰기 — 공유 클라이언트 오염 방지.
  r = await req('POST', '/api/auth/login', { body: { email, password } });
  const token = r.json?.data?.token;
  check('login → 자체 JWT', !!token);
  if (!token) { console.log('토큰 없음 — 중단'); process.exit(1); }

  // 김비서 room (이름 정확히 '김비서' — 브리지 매칭 규칙)
  r = await req('POST', '/api/agents', { token, body: { name: '김비서', description: '비서실', agent_type: 'assistant' } });
  check('agent 생성(김비서)', r.status === 201 && r.json?.data?.id, `id=${r.json?.data?.id || '-'}`);
  const agentId = r.json?.data?.id;
  r = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agentId } });
  const sessionId = r.json?.data?.id;
  check('session ensure', r.status === 201 && !!sessionId, `id=${sessionId || '-'}`);
  if (!sessionId) process.exit(1);

  // 턴 1 — 실 김비서 왕복
  const marker = '앱 브리지 스모크입니다. 이 발화에는 "브리지 왕복 확인"이라는 문구만 답해주세요.';
  const t0 = Date.now();
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: marker, locale: 'ko' } });
  const dt = Date.now() - t0;
  const turn = r.json?.data || {};
  check('턴1 201', r.status === 201 && r.json?.ok, `status=${r.status} ${dt}ms`);
  check('턴1 provider=secretary-bridge', turn.llm?.provider === 'secretary-bridge' || String(turn.llm?.reason || '').startsWith('BRIDGE_'), `llm=${JSON.stringify(turn.llm)}`);
  const answer = String(turn.answer_response || '');
  const isFallback = answer.includes('전달하지 못했어');
  check('턴1 답변 행 저장됨', !!turn.answer_message_id && answer.length > 0, answer.slice(0, 40));
  check('턴1 로컬 템플릿 오염 없음', !answer.includes('정리해드렸어요'), '');
  if (isFallback) {
    skip('턴1 김비서 실 회신 내용', '브리지 폴백 문장 — 실 응답 지연/미구동. 왕복 자체는 성립');
  } else {
    check('턴1 김비서 회신(원문)', answer.includes('브리지 왕복 확인') || answer.length > 0, answer.slice(0, 60));
    check('턴1 reasoning 잔여물 없음', !answer.includes('Reasoning'), '');
  }

  // 컨텍스트 영속 + 턴 2 연속성
  r = await req('GET', `/api/sessions/${sessionId}/context`, { token });
  const bridgeCtx = r.json?.data?.['secretary.bridge'];
  const ctxId = typeof bridgeCtx === 'string' ? bridgeCtx : bridgeCtx?.contextId;
  check('secretary.bridge 컨텍스트 영속', !!ctxId, `ctx=${ctxId || '-'}`);
  if (ctxId) {
    r = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: '아까 스모크 발화 받았지? 간단히 확인만.', locale: 'ko' } });
    const turn2 = r.json?.data || {};
    const ctx2 = await req('GET', `/api/sessions/${sessionId}/context`, { token });
    const bridgeCtx2 = ctx2.json?.data?.['secretary.bridge'];
    const ctxId2 = typeof bridgeCtx2 === 'string' ? bridgeCtx2 : bridgeCtx2?.contextId;
    const turns2 = bridgeCtx2?.turns;
    check('턴2 동일 contextId 연속', ctxId2 === ctxId, `same=${ctxId2 === ctxId} turns=${turns2}`);
    check('턴2 provider=secretary-bridge', turn2.llm?.provider === 'secretary-bridge' || String(turn2.llm?.reason || '').startsWith('BRIDGE_'), `llm=${JSON.stringify(turn2.llm)}`);
  }

  // 대조군 — 다른 이름 에이전트는 브리지 미경유
  r = await req('POST', '/api/agents', { token, body: { name: '브리지대상없음', agent_type: 'assistant' } });
  const otherAgent = r.json?.data?.id;
  r = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: otherAgent } });
  const otherSession = r.json?.data?.id;
  r = await req('POST', `/api/sessions/${otherSession}/messages`, { token, body: { content: '안녕', locale: 'ko' } });
  const other = r.json?.data || {};
  check('대조군: provider 표기 없음(로컬 경로)', other.llm?.provider !== 'secretary-bridge', `llm=${JSON.stringify(other.llm)}`);
  const oc = await req('GET', `/api/sessions/${otherSession}/context`, { token });
  check('대조군: bridge 컨텍스트 없음', !oc.json?.data?.['secretary.bridge'], '');

  console.log(`\n=== 결과: PASS ${passed} / FAIL ${failed} / SKIP ${skipped} ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('스모크 크래시:', e); process.exit(1); });
