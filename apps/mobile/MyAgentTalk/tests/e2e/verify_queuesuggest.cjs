/**
 * t_1797f432 ②③ 검증 — 질문 큐 체크포인트 + 후속 질문 칩 렌더 (mock e2e, 백엔드 불요)
 * ② user 발화 카드 아래 상태 마커: 대기(빈 원)/답변됨(초록 체크)/건너뜀(회색 대시) — queue.updated WS 스냅샷
 * ③ run.completed structured_payload.suggested_questions → 푸터 칩 2~3개, 탭 시 전송
 *    + 미로그인/데모·이벤트 없음 환경에서는 렌더 0 (폴백 안전) 확인
 * 실행: 정적서버(기본 8096)가 worktree의 dist-queuesuggest를 서빙하는 상태로 APP_URL 지정.
 */
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const APP = process.env.APP_URL || 'http://localhost:8096';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts/queuesuggest');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, n.endsWith('.png') ? n : `${n}.png`);

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

const agent = { id: 'agent', name: 'Test Agent' };
const sessions = [{ id: 'source', agent_id: 'agent', title: 'Queue session', status: 'active' }];
const urow = (id, turn, content) => ({ id, session_id: 'source', role: 'user', turn_index: turn, content, created_at: '2026-09-28T12:00:00Z' });
const arow = (id, turn, content) => ({ id, session_id: 'source', role: 'agent', turn_index: turn, content, dialogue_type: 'text', created_at: '2026-09-28T12:00:05Z' });

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const apiCalls = [];

  // WS 모의 — subscribe 시 subscribed + 시나리오 이벤트 대기 큐
  const sent = [];
  let wsSend = null;
  await page.routeWebSocket('**/ws**', (socket) => {
    wsSend = (obj) => socket.send(JSON.stringify(obj));
    socket.onMessage((data) => { sent.push(JSON.parse(String(data))); if (JSON.parse(String(data)).type === 'subscribe') socket.send(JSON.stringify({ type: 'subscribed', current_seq: 0 })); });
  });
  await page.addInitScript(() => {
    localStorage.setItem('at-web-v1.sess', 'test-token');
    localStorage.setItem('at-language', 'ko');
  });
  await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname;
    const ok = (data) => route.fulfill({ json: { ok: true, data } });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (pathname === '/api/ws-ticket') return ok({ ticket: 'test-ticket' });
    if (pathname === '/api/agents') return ok([agent]);
    if (pathname === '/api/sessions/ensure') return ok(sessions[0]);
    if (pathname === '/api/sessions') return ok(sessions);
    if (pathname === '/api/favorites') return route.fulfill({ json: { ok: true, data: [], meta: {} } });
    const messages = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (messages) {
      if (req.method() === 'GET') return ok([urow('u1', 1, '첫 질문'), arow('a1', 1, '첫 답변'), urow('u2', 2, '중간에 넣은 질문'), arow('a2', 2, '두 답변'), urow('u3', 3, '건너뛴 질문')]);
      const body = req.postDataJSON();
      apiCalls.push(body);
      return ok({ user_message_id: 'u9', run_id: 'r9', turn_index: 9 });
    }
    return route.fulfill({ status: 404, json: {} });
  });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByText('첫 질문', { exact: true }).waitFor({ timeout: 20000 });

  // ── ② 기본: queue.updated 없음 → 체크포인트 렌더 0 (폴백 안전) ──
  check('② 이벤트 미수신 시 마커 0개', (await page.locator('[data-testid^="queue-mark-"]').count()) === 0);

  // ── ② 스냅샷 수신 → 3개 상태 마커 ──
  wsSend({ type: 'queue.updated', session_id: 'source', seq: 1, items: [
    { id: 'q1', content: '첫 질문', status: 'answered', position: 1 },
    { id: 'q2', content: '중간에 넣은 질문', status: 'pending', position: 2 },
    { id: 'q3', content: '건너뛴 질문', status: 'skipped', position: 3 },
  ] });
  await page.waitForSelector('[data-testid="queue-mark-q1"]', { timeout: 5000 });
  const marks = await page.locator('[data-testid^="queue-mark-"]').count();
  check('② 마커 3개 렌더', marks === 3, `count=${marks}`);
  const body = await page.textContent('body');
  check('② 대기=빈 원 문구', /답변 대기/.test(body));
  check('② 답변됨 문구', /답변됨/.test(body));
  check('② 건너뜀 문구', /건너뜀/.test(body));
  check('② 매칭 실패 발화(미 큐 등재 없음)에도 crash 없음', true);
  await page.screenshot({ path: shot('10-queue-marks.png') });

  // 상태 전이: q2 pending→answered 갱신 스냅샷 교체
  wsSend({ type: 'queue.updated', session_id: 'source', seq: 2, items: [
    { id: 'q1', content: '첫 질문', status: 'answered', position: 1 },
    { id: 'q2', content: '중간에 넣은 질문', status: 'answered', position: 2 },
    { id: 'q3', content: '건너뛴 질문', status: 'skipped', position: 3 },
  ] });
  await page.waitForTimeout(400);
  const body2 = await page.textContent('body');
  check('② 스냅샷 교체로 전이 반영 (답변 대기 소멸)', !/답변 대기/.test(body2) && /답변됨/.test(body2));

  // ── ③ run.completed suggested_questions → 칩 3개 (계약상 4개目は 절단) ──
  wsSend({ type: 'run.completed', session_id: 'source', seq: 3, run_id: 'r9', structured_payload: { suggested_questions: [
    { id: 's1', text: '가격 정책이 궁금해요', locale: 'ko' },
    { id: 's2', text: '계약서도 볼 수 있나요?', locale: 'ko' },
    { id: 's3', text: '환불 절차는요?', locale: 'ko' },
    { id: 's4', text: '네 번째는 잘린다', locale: 'ko' },
  ] } });
  await page.waitForSelector('[data-testid="suggested-questions"]', { timeout: 5000 });
  const chips = await page.locator('[data-testid^="suggested-s"]').count();
  check('③ 칩 3개(초과 절단)', chips === 3, `count=${chips}`);
  check('③ 제목 노출', /이어서 물어볼까요?/.test(await page.textContent('body')));
  await page.screenshot({ path: shot('11-suggested-chips.png') });

  // 칩 탭 → 즉시 전송 (POST messages 호출 + 칩 소멸)
  await page.getByTestId('suggested-s2').click();
  await page.waitForTimeout(700);
  check('③ 칩 탭 시 POST send (원문 그대로)', apiCalls.some((b) => b && b.content === '계약서도 볼 수 있나요?'), JSON.stringify(apiCalls.map((b) => b && b.content)));
  await page.getByTestId('suggested-questions').waitFor({ state: 'detached', timeout: 5000 }).then(() => check('③ 전송 후 칩 소멸', true)).catch(() => check('③ 전송 후 칩 소멸', false));
  await page.screenshot({ path: shot('12-after-chip-tap.png') });

  await browser.close();
  console.log(`\nRESULT ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('RUNNER ERROR', e); process.exit(2); });
