// t_cb8e978a ① 프로브 후속 (t_5058e15f 리뷰 r1 판관③ 의미론 확정본): WS를 인위 지연 → talk.ready=false 창에서
// voice-stage 홀드 + 키보드(V) 경로 → '연결 중' 인식 신호 확인.
// r1 확정: 홀드-'연결 중' 경로는 pendingStart(voice-stage-connecting 상태 신호)가 흡수 —
// errors.micNotReady 토스트(chat-voice-fallback)는 캡처 실패/권한 거부 경로 전용(2.5s 소거). 무반응 금지 계약 유지.
// 5 검사항 = 구 probe_cb8_notready.cjs(scratch, t_cb8 시절)와 1:1 대응:
//   진입1회 / 홀드-신호노출 / 문구연결중 / 소거(토스트성·위장전송 없음) / 키보드 홀드도 안내.
// 실행: APP_URL=http://localhost:8147 node tests/e2e/probe_cb8_notready.cjs   (racey 프록시 스택)
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8147';
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'racey-lag-t5058e15f');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, ok, note) => { console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${note ? ` — ${note}` : ''}`); ok ? passed++ : failed++; };
(async () => {
  const stamp = Date.now();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', permissions: ['microphone'] });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const Orig = window.WebSocket;
    const t0 = Date.now();
    window.WebSocket = function (url, protocols) {
      // WS를 20초 지연: 그 전에는 CONNECTING 스텁 — 앱의 socket.readyState OPEN 판정이 false에 머문다.
      if (Date.now() - t0 < 20000) {
        return { url, readyState: 0, send() {}, close() {}, onopen: null, onmessage: null, onerror: null, onclose: null };
      }
      return protocols === undefined ? new Orig(url) : new Orig(url, protocols);
    };
    window.WebSocket.prototype = Orig.prototype;
    window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1;
  });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await sleep(1000);
  await page.getByTestId('login-hint').click().catch(() => {});
  await sleep(600);
  await page.getByTestId('auth-mode-toggle').click();
  const email = `cb8-${stamp}@myagenttalk.dev`, cred = `cb8-${stamp}!A1`;
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(cred);
  await page.getByTestId('consent-all-required').click();
  await page.getByTestId('signup-submit').click();
  await page.getByTestId('new-chat-button').waitFor({ state: 'visible', timeout: 20000 });
  // ② 검증: signup 직후 첫 탭 1회로 진입 (busy 탭 큐잉 — lib/newChatTap 단일 구현).
  await page.getByTestId('new-chat-button').click();
  const entered = await Promise.race([
    page.getByTestId('voice-stage').waitFor({ timeout: 8000 }).then(() => true),
    page.getByTestId('chat-input').waitFor({ timeout: 8000 }).then(() => true),
  ]).catch(() => false);
  check('② 첫 탭 1회로 채팅 진입(재탭 불필요)', entered);
  // WS 지연 중 = talk.ready false. VoiceStage 렌더 확인 후 홀드.
  await page.getByTestId('voice-stage').waitFor({ timeout: 8000 });
  const box = await page.getByTestId('voice-stage').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await sleep(400);
  const conn = page.getByTestId('voice-stage-connecting');
  const shown = await conn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
  const text = shown ? await conn.textContent() : '';
  check('① ready 전 홀드 → 인식 가능 신호 (무반응 금지, pendingStart 흡수)', shown, `text="${text}"`);
  check('① 신호 문구 = 연결 중 (r1 판관③: 홀드-연결중 경로는 pendingStart)', /연결 중/.test(text || ''), text);
  await page.mouse.up();
  await sleep(400); // 릴리스 = 조용한 폐기 — 신호 소거, 전송 위장(✓)·폴백 토스트 없음
  const gone = (await conn.count()) === 0;
  const fb = (await page.getByTestId('chat-voice-fallback').count()) > 0;
  const done = (await page.getByTestId('voice-stage-done').count()) > 0;
  check('① 안내 소거(토스트성) + 폐기 조용(폴백·✓ 위장 없음)', gone && !fb && !done, `gone=${gone} fb=${fb} done=${done}`);
  // 키보드 경로: still WS 지연 중(20s) — V 홀드도 신호(리스너 게이트=canHold: 웹+화면 활성).
  await page.locator('[data-testid="chat-appbar"]').click({ position: { x: 200, y: 10 } }).catch(() => {});
  await page.keyboard.down('v');
  const kbConn = await conn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
  await page.keyboard.up('v');
  await sleep(300);
  const kbCleared = (await conn.count()) === 0;
  check('① 키보드(V) 홀드도 안내 + 릴리스 소거', kbConn && kbCleared, `shown=${kbConn} cleared=${kbCleared}`);
  await page.screenshot({ path: path.join(OUT, 'cb8-01-notready-guide.png') });
  console.log(`RESULT cb8-probe: ${passed} PASS / ${failed} FAIL`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
