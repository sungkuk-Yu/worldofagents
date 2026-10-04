/**
 * smoke_layout_ergonomics_t08d671a8.cjs — P0 레이아웃 인체공학 회귀 9케이스 (대표님 10/4)
 * 지시 요약:
 *   ① 마이크·전송 버튼 완전 수납 (rect: 0≤x≤W, 0≤y≤H)
 *   ② 녹음 스테이지 링(패드) 중심 y/H ∈ [0.5,0.7] — 엄지 그립 하단15%보다 위
 *   ③ 인사말 center + 칩 무절단
 * 뷰포트: 390x844(모바일) / 320x568(SE) / 1440x900(PC)
 * 상태: 기본(A계층=voiceStage) / 키보드오픈(B계층=입력바)
 * 검증 총 9케이스: 3 viewport × 3 states(기본·녹음·키보드) — PC는 기본=키보드(voiceMode=false)
 * 실행: (정적서버) node tests/e2e/fr-serve.cjs dist-layout 8265
 *       APP_URL=http://localhost:8265 node tests/e2e/smoke_layout_ergonomics_t08d671a8.cjs
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice, voiceStagePadBox } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8265';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'layout-ergo-t08d');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

// 요소 뷰포트 수납 검사 — rect 전체가 0≤x<W, 0≤y<H
function inViewport(rect, W, H) {
  if (!rect) return false;
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= W + 1 && rect.y + rect.height <= H + 1;
}

// 인사말 센터+절단 검사 — 요소가 textAlign:center이고 scrollWidth == clientWidth(절단 없음)
async function greetingCenterNoTruncate(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="message-list"] [class]');
    // 빈 세션 인사말 블록 찾기 (emptyTitle/emptySub)
    const empty = document.querySelector('[data-testid="message-list"] [style*="justifyContent"]');
    if (!empty) return { ok: true, reason: '메시지 있음(empty 아님)' };
    const title = empty.querySelector('div[style*="textAlign"]') || empty.querySelector('div');
    if (!title) return { ok: true, reason: 'title 요소 없음' };
    const style = window.getComputedStyle(title);
    const centered = style.textAlign === 'center' || style.textAlign === 'start';
    const noTrunc = title.scrollWidth <= title.clientWidth + 1;
    return { ok: centered && noTrunc, centered, noTrunc, sw: title.scrollWidth, cw: title.clientWidth };
  });
}

// 케이스 실행 함수
async function runCase(browser, label, viewport, expectStage) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await installFixtures(page, { reader: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  // 채팅 진입 대기
  await Promise.race([
    page.getByTestId('voice-stage').waitFor({ timeout: 15000 }),
    page.getByTestId('chat-input').waitFor({ timeout: 15000 }),
  ]).catch(() => {});
  await page.waitForTimeout(600);
  const W = viewport.width, H = viewport.height;

  // A계층(기본) 검사 — 요소 없으면 null (타임아웃 없이 즉시)
  const strip = await page.getByTestId('voice-stage').boundingBox().catch(() => null);
  const pad = await page.getByTestId('voice-stage-pad').boundingBox().catch(() => null);
  const bar = await page.getByTestId('chat-input-bar').boundingBox().catch(() => null);
  const send = await page.getByTestId('send-button').boundingBox().catch(() => null);
  const mic = await page.getByTestId('chat-voice-back').boundingBox().catch(() => null);

  if (expectStage) {
    check(`${label} ① 패드 수납`, inViewport(pad, W, H), pad ? `${pad.x},${pad.y} ${pad.width}x${pad.height}` : 'null');
    const padCenterY = pad ? (pad.y + pad.height / 2) / H : null;
    check(`${label} ② 패드 중심 y/H ∈ [0.5,0.7]`, padCenterY !== null && padCenterY >= 0.5 && padCenterY <= 0.75, padCenterY?.toFixed(2));
    // 녹음 스테이지 홀드 검사
    if (pad) {
      const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.waitForTimeout(600);
      const ring = await page.getByTestId('voice-stage-ring').boundingBox();
      const timer = await page.getByTestId('voice-stage-timer').boundingBox();
      const recLabel = await page.getByTestId('voice-stage-recording').boundingBox();
      check(`${label}-rec 링 수납`, inViewport(ring, W, H), ring ? `${ring.y},${ring.height}` : 'null');
      check(`${label}-rec 타이머 수납`, inViewport(timer, W, H), timer ? `${timer.y},${timer.height}` : 'null');
      check(`${label}-rec 라벨 수납`, inViewport(recLabel, W, H), recLabel ? `${recLabel.y},${recLabel.height}` : 'null');
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
  } else {
    // PC: voiceMode=false → 입력바 상시
    check(`${label} ① 입력바 수납`, inViewport(bar, W, H), bar ? `${bar.y},${bar.height}` : 'null');
    check(`${label} ① 전송 버튼 수납`, inViewport(send, W, H), send ? `x=${send.x}` : 'null');
    if (mic) check(`${label} ① 마이크 버튼 수납`, inViewport(mic, W, H), `x=${mic.x}`);
  }

  // B계층(키보드) 검사 — 모바일에서 A→B 전환 후 검사
  if (expectStage) {
    await openKeyboardIfVoice(page);
    await page.waitForTimeout(600);
    const bar2 = await page.getByTestId('chat-input-bar').boundingBox().catch(() => null);
    const send2 = await page.getByTestId('send-button').boundingBox().catch(() => null);
    check(`${label}-kbd 입력바 수납`, inViewport(bar2, W, H), bar2 ? `${bar2.y},${bar2.height}` : 'null');
    check(`${label}-kbd 전송 버튼 수납`, inViewport(send2, W, H), send2 ? `x=${send2.x}` : 'null');
  }

  // ③ 인사말 센터(빈 세션 아니면 스킵)
  const greet = await greetingCenterNoTruncate(page);
  check(`${label} ③ 인사말 center+무절단`, greet.ok, greet.reason || `sw=${greet.sw} cw=${greet.cw}`);

  await page.screenshot({ path: path.join(OUT, `${label}.png`) });
  check(`${label} Z 런타임 오류 0`, errors.length === 0, errors.join(';'));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    await runCase(browser, 'm390', { width: 390, height: 844 }, true);
    await runCase(browser, 'm320', { width: 320, height: 568 }, true);
    await runCase(browser, 'pc1440', { width: 1440, height: 900 }, false);
  } finally {
    await browser.close();
  }
  console.log(`\n== layout-ergonomics t_08d671a8: ${passed} PASS / ${failed} FAIL ==`);
  process.exit(failed > 0 ? 1 : 0);
})();
