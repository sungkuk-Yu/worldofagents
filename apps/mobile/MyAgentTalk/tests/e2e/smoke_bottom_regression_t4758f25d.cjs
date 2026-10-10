/**
 * 하단 기하 회귀 스모크 — t_4758f25d (대표님 9/28 밤 슛 3결함 + 음성 스테이지 재스펙)
 *  ① 잘림: 웹 모바일 최하단 메시지 카드가 음성 strip에 가려지지 않는다 (패딩=strip 실높이 계약)
 *  ② 절단: 첫 진입 힌트 알약이 뷰포트 폭에서 좌우 잘림 없음 + 한 줄 개행
 *  ③ 겹침: PC 1440 입력바/첨부/전송 상호 겹침 0, 입력 상단 > 최하단 카드 하단 (스크롤 최하단 기준)
 *  ④ strip 점유: 첫 진입 모바일에서 strip이 뷰포트 45% 클램프(240~400)를 넘지 않는다.
 *     (t_08d671a8 대표님 10/4 인체공학 P0: 30%→45% 승격 — 이 게이트는 머지 페어 정합에서
 *      누락된 30% 잔존 하네스 드리프트였고 t_d123bece에서 계약값으로 봉합. 844→380=voiceStageHeight.)
 *  ⑤ 부재: 모바일 A 계층에 조이스틱 디스크/키보드 버튼 DOM 0 (#294-4 고정 콘솔 폐기)
 * 실행: node tests/e2e/fr-serve.cjs dist-<본빌드> 8159
 *       APP_URL=http://localhost:8159 node tests/e2e/smoke_bottom_regression_t4758f25d.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8159';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'bottom-regression');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function openChat(browser, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, { rich: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('message-list').waitFor({ timeout: 15000 });
  return { page, state, errors };
}

// 리스트를 끝까지 스크롤 후 지오메트리 한 덩어리 측정
async function bottomGeometry(page) {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="message-list"]');
    if (list) list.scrollTop = list.scrollHeight;
    return new Promise((resolve) => setTimeout(() => {
      const stripEl = document.querySelector('[data-testid="voice-stage"]');
      const inputEl = document.querySelector('[data-testid="chat-input"]');
      const barEl = document.querySelector('[data-testid="chat-input-bar"]') || (inputEl ? inputEl.closest('div[class]') : null);
      const cards = Array.from(document.querySelectorAll('[data-testid="message-agent"],[data-testid="message-user"]')).map((el) => el.getBoundingClientRect());
      const hint = document.querySelector('[data-testid="voice-stage-hint"]');
      const sendEl = document.querySelector('[data-testid="send-button"]');
      const attachEl = document.querySelector('[data-testid="attach-button"]');
      const micEl = document.querySelector('[data-testid="chat-voice-back"]');
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
      resolve({
        strip: rect(stripEl), inputBar: rect(barEl), send: rect(sendEl), attach: rect(attachEl), mic: rect(micEl),
        hint: hint ? { ...rect(hint), clipped: hint.scrollWidth > hint.clientWidth + 1 || hint.getBoundingClientRect().right > window.innerWidth + 1 || hint.getBoundingClientRect().left < -1 } : null,
        lastCardBottom: cards.length ? Math.round(Math.max(...cards.map((r) => r.bottom))) : null,
        lastCardTop: cards.length ? Math.round(Math.max(...cards.map((r) => r.bottom)) && cards[cards.length - 1].top) : null,
        vh: window.innerHeight, vw: window.innerWidth,
      });
    }, 450));
  });
}
const overlap = (a, b) => !!a && !!b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── 모바일 390: ① 잘림 + ② 절단 + ④ 점유 + ⑤ 부재 ──
    {
      const { page, errors } = await openChat(browser, { width: 390, height: 844 });
      await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
      const g = await bottomGeometry(page);
      assert.ok(g.strip, 'voice-stage 존재');
      // t_08d671a8 (대표님 10/4 인체공학 P0): 스트립 30%→45% 클램프 240~400 승격.
      // 구 게이트(≤30%+α)는 머지 페어 정합(unit 1b27861b/da4d9676·voice_console 72행)에서 누락된
      // 하네스 드리프트 — t_d123bece(김비서) 재현 실측 strip=380/844 = voiceStageHeight(844) 정확값.
      // 레이아웃 회귀 금지: 계약 산출식과 1:1 일치 단언(느슨한 상한이 아님 — clamp·비율 동시 봉인).
      const contractH = Math.round(Math.min(400, Math.max(240, g.vh * 0.45))); // = src/lib/voiceStage.ts voiceStageHeight
      check('④ strip 높이 = 45% 클램프(240~400) 계약 정확 일치 (t_08d671a8 승계 봉인 — 회귀 시 FAIL)', g.strip.h === contractH, `strip=${g.strip.h}/${g.vh} contract=${contractH}`);
      check('① 스크롤 최하단 = 마지막 카드 하단이 strip 상단 이상으로 노출(가림 0)', g.lastCardBottom !== null && g.lastCardBottom <= g.strip.top + 4, `card.bottom=${g.lastCardBottom} strip.top=${g.strip.top}`);
      check('② 힌트 알약 좌우 잘림 없음·한 줄', !!g.hint && !g.hint.clipped && g.hint.h < 60, g.hint ? JSON.stringify(g.hint) : 'no hint');
      check('⑤ 고정 콘솔 요소 DOM 0 (joystick-mic/keyboard-button)', (await page.getByTestId('joystick-mic').count()) === 0 && (await page.getByTestId('chat-keyboard-button').count()) === 0);
      check('① 대기 상태 strip 위 링/리본 DOM 0 (투명 strip)', (await page.getByTestId('voice-stage-ring').count()) === 0);
      check('모바일 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 120));
      await page.screenshot({ path: shot('01-mobile-390-idle') });
      // B 계층 개방 후 겹침 0 (입력바 vs 최하단 카드)
      const box = g.strip;
      await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2 - i * 20); await page.waitForTimeout(25); }
      await page.mouse.up();
      await page.getByTestId('chat-input').waitFor({ timeout: 8000 });
      const g2 = await bottomGeometry(page);
      check('B 개방: strip 미렌더(2중 UI 없음)', (await page.getByTestId('voice-stage').count()) === 0);
      check('③(모바일 B) 입력 상단 ≥ 리스트 하단 경계-여유', g2.inputBar !== null && g2.inputBar.top >= 0 && (g2.lastCardBottom === null || g2.lastCardBottom <= g2.inputBar.top + 4 || g2.inputBar.top > g2.vh - 200), `bar.top=${g2.inputBar && g2.inputBar.top} card.bottom=${g2.lastCardBottom}`);
      await page.screenshot({ path: shot('02-mobile-390-keyboard') });
      await page.close();
    }

    // ── PC 1440: ③ 겹침 제로 (본문 vs 입력바 vs 전송/첨부) ──
    {
      const { page, errors } = await openChat(browser, { width: 1440, height: 900 });
      await page.getByTestId('chat-input').waitFor({ timeout: 15000 });
      const g = await bottomGeometry(page);
      check('③ PC 스크롤 최하단: 마지막 카드 하단 < 입력 상단(겹침 0)', g.lastCardBottom !== null && g.inputBar !== null && g.lastCardBottom <= g.inputBar.top + 4, `card.bottom=${g.lastCardBottom} bar.top=${g.inputBar && g.inputBar.top}`);
      check('③ PC 전송 vs 첨부 버튼 겹침 0', !overlap(g.send, g.attach));
      check('③ PC 버튼들이 입력바 내부', !!g.send && !!g.inputBar && g.send.right <= g.inputBar.right + 4 && g.attach.x >= g.inputBar.x - 4,
        `send=${JSON.stringify(g.send)} attach=${JSON.stringify(g.attach)} bar=${JSON.stringify(g.inputBar)}`);
      check('PC = 음성 strip 미렌더 (#311 PC는 스테이지 없음 확인용: voice-stage 0)', (await page.getByTestId('voice-stage').count()) === 0);
      check('PC 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 120));
      await page.screenshot({ path: shot('03-pc-1440') });
      await page.close();
    }

    // ── 태블릿 경계 768: PC 게이트 경계선 where strip은 없고 입력바 상시 ──
    {
      const { page } = await openChat(browser, { width: 768, height: 1024 });
      await page.getByTestId('chat-input').waitFor({ timeout: 15000 });
      check('768 경계 = PC 입력바(스테이지 없음)', (await page.getByTestId('voice-stage').count()) === 0);
      await page.screenshot({ path: shot('04-tablet-768') });
      await page.close();
    }
  } finally {
    await browser.close();
    console.log(`\nRESULT bottom-regression: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
