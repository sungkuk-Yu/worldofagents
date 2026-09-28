/**
 * 하단 영역 기하 실측 프로브 — t_4758f25d
 * 대표님 슛(PC 1440 겹침) + 후속 슛(모바일 390 콘솔이 히스토리 압도) 판독 근거 수집.
 * 출력: 각 요소의 viewport 기준 rect, 요소 간 교집합(겹침) 쌍, 마지막 메시지 하단 vs 입력 상단 간격.
 * 실행: APP_URL=http://localhost:8158 node tests/e2e/probe_bottom_overlap_t4758f25d.cjs
 */
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8158';
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

async function probe(browser, w, h, label, shotName) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await installFixtures(page, { rich: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.waitForTimeout(1200);
  const data = await page.evaluate(() => {
    const rectOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), top: Math.round(r.top), right: Math.round(r.right) };
    };
    const sels = {
      'message-list': '[data-testid="message-list"]',
      'queue-strip': '[data-testid="queue-strip"]',
      'resume-banner': '[data-testid="resume-banner"]',
      'last-msg-card': '[data-testid="message-agent"]',
      'chat-input': '[data-testid="chat-input"]',
      'voice-stage': '[data-testid="voice-stage"]',
      'voice-stage-hint': '[data-testid="voice-stage-hint"]',
      'joystick-mic': '[data-testid="joystick-mic"]',
      'keyboard-button': '[data-testid="chat-keyboard-button"]',
      'send-button': '[data-testid="send-button"]',
      'attach-button': '[data-testid="attach-button"]',
      'ptt-banner': '[data-testid="ptt-banner"]',
    };
    const rects = {};
    for (const [k, sel] of Object.entries(sels)) rects[k] = rectOf(sel);
    // 모든 메시지 카드 중 view에서 가장 낮은 bottom (실제 testID = message-agent/message-user)
    const cards = [...document.querySelectorAll('[data-testid="message-agent"],[data-testid="message-user"]')].map((el) => el.getBoundingClientRect());
    const maxCardBottom = cards.length ? Math.round(Math.max(...cards.map((r) => r.bottom))) : null;
    const vh = window.innerHeight;
    return { rects, cardCount: cards.length, maxCardBottom, vh, vw: window.innerWidth };
  });
  // 키보드 개방 상태도 측정 (입력창이 히스토리를 덮는지 — 겹침 판별)
  let kb = null;
  const kbBtn = page.getByTestId('chat-keyboard-button');
  if (await kbBtn.count()) {
    await kbBtn.click();
    await page.waitForTimeout(600);
  }
  if (await page.getByTestId('chat-input').count()) {
    kb = await page.evaluate(() => {
      const rectOf = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom) };
      };
      const cards = [...document.querySelectorAll('[data-testid="message-agent"],[data-testid="message-user"]')].map((el) => el.getBoundingClientRect());
      return {
        input: rectOf('[data-testid="chat-input"]'),
        inputBar: (() => { const el = document.querySelector('[data-testid="chat-input"]'); const bar = el && el.closest('div[style]'); return null; })(),
        lastCardBottom: cards.length ? Math.round(cards[cards.length - 1].bottom) : null,
        send: rectOf('[data-testid="send-button"]'),
        attach: rectOf('[data-testid="attach-button"]'),
      };
    });
  }
  await page.screenshot({ path: `tests/e2e/artifacts/bottom-overlap/${shotName}.png`, fullPage: false });
  console.log(`\n=== ${label} (${w}x${h}) ===`);
  console.log(JSON.stringify({ ...data, keyboardOpen: kb }, null, 1));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    await probe(browser, 1440, 900, 'PC 3패널', 'pc-1440');
    await probe(browser, 1280, 800, 'PC 2패널', 'pc-1280');
    await probe(browser, 390, 844, '모바일', 'mobile-390');
  } finally {
    await browser.close();
  }
})();
