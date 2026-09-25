/**
 * 에이전트톡 백엔드 스모크 테스트 (DEV_MODE 대상)
 *
 * 사용법:
 *   cd apps/backend
 *   PORT=3000 STANDALONE=true ./node_modules/.bin/tsx src/index.ts   # 터미널 1
 *   node tests/smoke_dev.mjs http://localhost:3000                    # 터미널 2
 *
 * 검증 흐름: signup → me → agent 생성 → session ensure → 텍스트 턴(뉴런 파이프라인)
 * → 뉴런 이력 → 작업 목록 → 스킬 랭킹 → WebSocket connected.
 */
const BASE = process.argv[2] || 'http://localhost:3000';
const WS_BASE = BASE.replace(/^http/, 'ws');

let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`\n=== 에이전트톡 백엔드 스모크 (@ ${BASE}) ===\n`);
  const email = `smoke_${Date.now()}@test.io`;

  // 1. 회원가입
  let r = await req('POST', '/api/auth/signup', {
    body: { email, password: 'password123', display_name: '스모크테스터', timezone: 'Asia/Seoul', language: 'ko' },
  });
  check('POST /api/auth/signup → 201 + token', r.status === 201 && r.json?.ok && !!r.json?.data?.token, `status=${r.status}`);
  const token = r.json?.data?.token;
  const userId = r.json?.data?.user?.id;

  // 2. 내 프로필
  r = await req('GET', '/api/me', { token });
  check('GET /api/me → ok, userId 매칭', r.json?.ok && r.json?.data?.id === userId);

  // 3. 에이전트 생성 (기본 페르소나 자동 생성)
  r = await req('POST', '/api/agents', { token, body: { name: '스모크 상담사', agent_type: 'shadow', description: '스모크 테스트 에이전트' } });
  check('POST /api/agents → 201 + active_persona', r.status === 201 && r.json?.ok && !!r.json?.data?.active_persona, `agent=${r.json?.data?.id?.slice(0, 8)}`);
  const agentId = r.json?.data?.id;

  // 4. 에이전트 목록
  r = await req('GET', '/api/agents', { token });
  check('GET /api/agents → 목록에 방금 생성한 에이전트', r.json?.ok && (r.json?.data || []).some((a) => a.id === agentId));

  // 5. 세션 ensure
  r = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agentId } });
  check('POST /api/sessions/ensure → 세션 생성', r.status === 201 && r.json?.ok && !!r.json?.data?.id);
  const sessionId = r.json?.data?.id;

  // 6. 세션 상세 (빈 메시지)
  r = await req('GET', `/api/sessions/${sessionId}`, { token });
  check('GET /api/sessions/:id → messages 배열', r.json?.ok && Array.isArray(r.json?.data?.messages));

  // 7. 텍스트 턴 (뉴런 파이프라인 실행 — dev 모드)
  r = await req('POST', `/api/sessions/${sessionId}/messages`, {
    token,
    body: { content: '안녕하세요, 오늘 날씨가 좋네요. 내일 일정 좀 정리해줘' },
  });
  check('POST /:id/messages → 201 + empathy_response', r.status === 201 && r.json?.ok && typeof r.json?.data?.empathy_response === 'string' && r.json?.data?.empathy_response.length > 0, `dialogue=${r.json?.data?.dialogue_type}, engine=${r.json?.data?.engine}`);
  check('  └ activation_plan에 empathy 포함', (r.json?.data?.activation_plan?.activate || []).includes('empathy'));

  // 8. 뉴런 연결 이력
  r = await req('GET', `/api/sessions/${sessionId}/neurons/history`, { token });
  check('GET /:id/neurons/history → 이벤트 기록', r.json?.ok && Array.isArray(r.json?.data) && r.json?.data.length > 0, `${r.json?.data?.length} events`);

  // 9. 작업 목록 (설계 §3.6 — 세션 스코프; 초기엔 빈 배열)
  r = await req('GET', `/api/sessions/${sessionId}/tasks`, { token });
  check('GET /sessions/:id/tasks → 200 + 배열', r.status === 200 && r.json?.ok && Array.isArray(r.json?.data), `status=${r.status}`);

  // 10. 스킬 랭킹 (seed 3종)
  r = await req('GET', '/api/skills?sort=ranking', { token });
  check('GET /api/skills?sort=ranking → 데이터 존재', r.json?.ok && (r.json?.data || []).length >= 3, `${(r.json?.data || []).length} skills`);
  check('  └ composite_score 정렬(내림차순)', (r.json?.data || []).every((s, i, arr) => i === 0 || arr[i - 1].composite_score >= s.composite_score));

  // 11. WebSocket connected (dev 모드 anon 허용)
  try {
    const ws = new WebSocket(`${WS_BASE}/ws?session_id=${sessionId}&token=dev-test`);
    const connected = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'connected') {
            clearTimeout(timer);
            ws.close();
            resolve(msg);
          }
        } catch {
          /* ignore non-JSON */
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
    });
    check('WS /ws → connected 이벤트', !!connected && connected.type === 'connected', `session=${connected?.session_id === sessionId}`);
  } catch (err) {
    check('WS /ws → connected 이벤트', false, String(err));
  }

  console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err);
  process.exit(1);
});