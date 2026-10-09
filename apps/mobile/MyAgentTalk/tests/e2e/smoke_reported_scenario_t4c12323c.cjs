/**
 * t_4c12323c — 신고 시나리오 정식 승격 (probe_drag_mic4_1009.cjs → smoke)
 * 대표님 10/9 신고 "위로 화면을 올리려고 하는데 드래그 기능에 버그"의 원 재현 경로:
 *   패드 출발 위 스와이프(↑ = B계층 전이, 정상 계약) 후 경계(y500) 출발 위 스와이프 반복.
 * mic4 프루브의 오판: 'scrollTop > 50 = 점프(버그)' 단언이 B-레이어(max=206)를 버그로 잡았다.
 * 정식 판정(레이어 감지):
 *   - A-레이어(strip 있음)에서 경계 출발 드래그 = 리스트 이동(Δ>20)이어야 한다 (통과 계약).
 *   - B-레이어(strip 없음, 키보드)에서 max 오프셋 = 더 올릴 곳 없음 — 위치 유지가 정상.
 *   - 어느 레이어에서든 되돌림(↑ 드래그 후 말미로 스냅백)은 버그다: 드래그 종점과
 *     settling 후 종점의 차 >60px이고 종점이 max에 붙으면 FAIL (r4 클램프 딥과 구분:
 *     여기는 사용자 드래그 직후 — lastMarkAt 모멘텀 창이 이탈을 방어한다).
 * 실행: node tests/e2e/fr-serve.cjs dist-<본빌드> 8292
 *       APP_URL=http://localhost:8292 node tests/e2e/smoke_reported_scenario_t4c12323c.cjs
 */
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8292';
let passed = 0, failed = 0;
function check(n, c, x = '') { c ? (passed++, console.log(`  PASS  ${n}${x ? ' — ' + x : ''}`)) : (failed++, console.log(`  FAIL  ${n}${x ? ' — ' + x : ''}`)); }
const stOf = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="message-list"]');
  return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight, strip: !!document.querySelector('[data-testid="voice-stage"]') };
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const { installFixtures } = require('./run_c_fixtures.cjs');
  await installFixtures(page, { reader: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  async function swipe(x, y1, y2, steps = 14) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y1 }] });
    for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y1 + (y2 - y1) * i / steps }] }); await new Promise(r => setTimeout(r, 12)); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1600); // 관성 + settling (r4 합성 scroll-end 100ms + 리빌 성장 윈도우 커버)
  }

  // 신고 시나리오 ①: 패드 출발 ↑ 스와이프 (t_f8c40db0/B계약 = 키보드 전이). 패드 좌표는 런타임
  // 실측 — 인체공학 이력(t_8dbb1619 중심 55%)으로 하드코딩 (195,600)은 더 이상 패드 밖.
  const s0 = await stOf(page);
  const padC = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="voice-stage-pad"]');
    const b = p.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  });
  await swipe(padC.x, padC.y, padC.y - 350); // 패드 안 출발 = ↑ 제스처 → B 전이(정상)
  const s1 = await stOf(page);
  check('패드 출발 ↑ = B 계층 전이 (strip 없음)', s0.strip && !s1.strip, `pad=(${padC.x},${padC.y}) max ${s0.max.toFixed(0)}→${s1.max.toFixed(0)}`);

  // ② B-레이어에서 경계 출발 위 스와이프 = max 도달 상태 — 위치 유지(과도 이동/점프 없음).
  for (let k = 1; k <= 3; k++) {
    await swipe(195, 500, 250);
    const v = await stOf(page);
    check(`B-레이어 위 스와이프#${k} — 안정(되돌림/점프 없음)`, Math.abs(v.top - v.max) < 8, `top=${v.top.toFixed(0)} max=${v.max.toFixed(0)}`);
  }

  // ③ A 복귀(chat-voice-back) 후 경계 출발 위 스와이프 = 리스트 수신·이동 (통과 계약)
  await page.getByTestId('chat-voice-back').click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const el = document.querySelector('[data-testid="message-list"]'); el.scrollTop = el.scrollHeight; }); // 말미
  await page.waitForTimeout(1200);
  const a = await stOf(page);
  check('A 복귀 후 말미 정착', a.strip && Math.abs(a.top - a.max) <= 6, `top=${a.top.toFixed(0)}`);
  // 손가락 아래 = 히토리(scrollTop↓). 시작점: 패드 rect를 실측해 좌측 외곽(x=pad.left-40)에서 출발 —
  // B→A 복귀 후에는 viewportInset으로 리스트가 줄어들며 strip/패드가 위로 올라오므로(설계),
  // 고정 y 좌표는 패드 안에 떨어져 홀드(#311 정상 발동)가 된다. 외곽 출발 = 통과 계약 지점만 검증.
  const padL = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="voice-stage-pad"]');
    return p ? p.getBoundingClientRect().left : 147;
  });
  await swipe(Math.max(20, padL - 40), 470, 690);
  const b = await stOf(page);
  check('경계 인접(패드 좌외곽) 출발 아래(히토리) 스와이프 — 리스트 수신 Δ>20', b.strip && a.top - b.top > 20, `top ${a.top.toFixed(0)}→${b.top.toFixed(0)} (padLeft=${padL.toFixed(0)})`);
  // ④ 스냅백 회귀: 드래그 후 2s 더 — 말미 되돌림 금지 (t_4c12323c branch3 결함 재현 지점)
  await page.waitForTimeout(2000);
  const c = await stOf(page);
  check('되돌림 없음 (settling +2s 유지)', Math.abs(c.top - b.top) < 60 || c.top < c.max - 100, `top=${c.top.toFixed(0)} max=${c.max.toFixed(0)}`);
  check('페이지 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log(`\n== RESULT ${passed} PASS / ${failed} FAIL`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
