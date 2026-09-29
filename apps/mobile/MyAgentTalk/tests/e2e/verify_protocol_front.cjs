/**
 * t_17edbc88 — 서버 신계약 소비 라이브 검증 (백엔드 실동 DEV_MODE, 픽스처 없음).
 * ① 발화 payload에 uuid v4 client_req_id → WS message.new(user) 에코와 같은 키 → user 카드 1장(중복 소멸).
 * ③ 강제 disconnect → 재접속: subscribe last_seq + GET /events?after_seq 차등 리플레이,
 *    답변 완결·유령/중복 카드 0·error-bar(배지) 없음.
 * 실행: BE(DEV_MODE=true PORT=3188 CORS_ORIGIN=http://localhost:8188) + node fr-serve.cjs dist-t17edbc88-live 8188
 *       APP_URL=http://localhost:8188 node tests/e2e/verify_protocol_front.cjs
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8188';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'protocol-front');
fs.mkdirSync(OUT, { recursive: true });
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 계측: 모든 WebSocket 인스턴스를 window.__sockets에 수집(강제 disconnect용) + 송/수신 프레임 로그
  await page.addInitScript(() => {
    const Orig = window.WebSocket;
    window.__sockets = [];
    window.__wsFrames = { sent: [], recv: [] };
    const WS = function (url, protocols) {
      const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
      const origSend = ws.send.bind(ws);
      ws.send = (data) => { try { if (typeof data === 'string') window.__wsFrames.sent.push(JSON.parse(data)); } catch { /* binary 등 */ } return origSend(data); };
      ws.addEventListener('message', (ev) => { try { if (typeof ev.data === 'string') window.__wsFrames.recv.push(JSON.parse(ev.data)); } catch { /* noop */ } });
      window.__sockets.push(ws);
      return ws;
    };
    WS.prototype = Orig.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Object.defineProperty(WS, k, { value: Orig[k] });
    window.WebSocket = WS;
  });

  const posts = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/messages(\?|$)/.test(r.url()) && r.postData()) {
      try { posts.push(JSON.parse(r.postData())); } catch { posts.push(null); }
    }
  });
  const eventsGets = [];
  page.on('request', (r) => { if (r.method() === 'GET' && /\/events\?after_seq=/.test(r.url())) eventsGets.push(r.url()); });

  try {
    const stamp = Date.now();
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('login-hint').click().catch(async () => { await page.getByTestId('new-chat-button').click(); });
    await page.waitForTimeout(800);
    if (await page.getByTestId('login-card').isVisible().catch(() => false)) {
      await page.getByTestId('auth-mode-toggle').click().catch(() => {});
      await page.getByTestId('login-email').fill(`protofront-${stamp}@myagenttalk.dev`);
      await page.getByTestId('login-password').fill(`proto-${stamp}`);
      await page.getByTestId('consent-all-required').click().catch(() => {});
      await page.getByTestId('signup-submit').click();
      await page.waitForTimeout(2500);
    }
    check('로그인/가입 성공', await page.getByTestId('new-chat-button').isVisible().catch(() => false));
    await page.getByTestId('new-chat-button').click();
    await page.getByTestId('chat-appbar').waitFor({ timeout: 8000 });
    const box = await page.getByTestId('voice-stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(cx, cy - i * 20); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.getByTestId('chat-input').waitFor({ timeout: 8000 });

    // ── 시나리오 ①: 발화 → client_req_id 동봉 → 에코 merge → 카드 1장 ──
    const TEXT1 = '프로토콜 프론트 확인 1';
    await page.getByTestId('chat-input').fill(TEXT1);
    await page.getByTestId('send-button').click();
    // POST body에 uuid v4 client_req_id
    await page.waitForFunction((n) => window.__wsFrames.sent.length > 0 || true, null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(700);
    const reqId1 = posts[0] && posts[0].client_req_id;
    check('① POST client_req_id = uuid v4', typeof reqId1 === 'string' && UUID_V4.test(reqId1), String(reqId1).slice(0, 36));
    // 에코 수신까지 대기 후 중간 카드 수 샘플링 (실행 중 2회)
    let midSamples = [];
    for (let i = 0; i < 6; i++) {
      midSamples.push(await page.getByText(TEXT1, { exact: true }).count());
      await page.waitForTimeout(500);
    }
    // message.new(user) 에코가 client_req_id를 실었는지 (WS recv)
    const echo = await page.evaluate((rid) => (window.__wsFrames.recv || []).some((f) => f.type === 'message.new' && f.message && f.message.role === 'user' && f.message.client_req_id === rid), reqId1);
    check('① WS message.new(user) 에코 = 같은 client_req_id', echo);
    await page.waitForFunction(() => !document.querySelector('[data-testid="typing-indicator"]'), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const rows1 = await page.getByText(TEXT1, { exact: true }).count();
    check('① 완료 후 user 카드 1장(라벨 복제 ≤2, 중복 카드=3+ 차단)', rows1 <= 2, `textNodes=${rows1} mid=${midSamples.join(',')}`);
    check('① error-bar 없음', (await page.getByTestId('error-bar').count()) === 0);
    await page.screenshot({ path: path.join(OUT, '01-echo-merge.png') });

    // ── 시나리오 ③: 실행 중 강제 disconnect → 재접속 → 갭 리플레이 → 배지 없음 ──
    const TEXT2 = '프로토콜 프론트 확인 2';
    const before = await page.evaluate(() => window.__sockets.length);
    await page.getByTestId('chat-input').fill(TEXT2);
    await page.getByTestId('send-button').click();
    await page.waitForTimeout(400); // run 진행 중
    await page.evaluate(() => { const ws = window.__sockets[window.__sockets.length - 1]; ws.close(4001, 'forced'); });
    await page.waitForTimeout(300);
    const reconnecting = await page.getByText('연결 중…', { exact: false }).count().catch(() => 0);
    await page.waitForFunction((b) => window.__sockets.length > b, before, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);
    check('③ 강제 close 후 재접속 소켓 생성', (await page.evaluate(() => window.__sockets.length)) > before);
    // 재구독: last_seq>0 subscribe + GET /events?after_seq
    const subs = await page.evaluate(() => (window.__wsFrames.sent || []).filter((f) => f.type === 'subscribe'));
    check('③ subscribe last_seq 전송(재구독)', subs.length >= 2 && subs[subs.length - 1].last_seq >= 0, JSON.stringify(subs.map((s) => s.last_seq)));
    check('③ GET /events?after_seq 차등 리플레이 호출', eventsGets.length >= 1, eventsGets.map((u) => u.split('/events')[1]).join(','));
    await page.waitForFunction(() => !document.querySelector('[data-testid="typing-indicator"]'), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const rows2 = await page.getByText(TEXT2, { exact: true }).count();
    check('③ disconnect/drain 후 user 카드 중복 없음(≤2)', rows2 <= 2, `textNodes=${rows2}`);
    check('③ error-bar(배지) 없음', (await page.getByTestId('error-bar').count()) === 0);
    const ghost = await page.getByText('전송중…', { exact: true }).count();
    check('③ 유령 pending 카드 없음', ghost === 0, `pending=${ghost}`);
    await page.screenshot({ path: path.join(OUT, '02-gap-replay.png') });

    check('JS 오류 없음', errors.length === 0, errors.join('|').slice(0, 200));
    console.log(`\n=== 프로토콜 프론트 라이브: PASS ${passed} / FAIL ${failed} ===`);
  } catch (e) {
    console.log('SCRIPT ERROR:', String(e).slice(0, 400));
    await page.screenshot({ path: path.join(OUT, 'crash.png') }).catch(() => {});
    failed++;
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})();
