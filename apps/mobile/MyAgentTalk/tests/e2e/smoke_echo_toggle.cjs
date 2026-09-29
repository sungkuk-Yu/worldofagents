// 복명복창 토글 '답변 전 되물음' — 브라우저 실증 (카드 t_43297d90 검수: 설정 토글 → reload 후 유지)
// 실행: expo export --output-dir dist-echo-smoke → node tests/e2e/fr-serve.cjs dist-echo-smoke 8231
//       → APP_URL=http://localhost:8231 node tests/e2e/smoke_echo_toggle.cjs
// 검증 계약:
//  A. 설정 화면에 settings-echo-toggle 존재 + 기본 ON(낙관 폴백) + ko 라벨 '답변 전 되물음' 렌더
//  B. 토글 OFF → PATCH preferences.echoMode='off' 즉시 발화 + 다른 키(theme) 보존
//  C. reload 후 OFF 유지 — 서버 hydrate 우선(read-back) + description이 '말하면 바로 답해요'로 전환
//  D. 재토글 ON → PATCH echoMode='on' + reload 유지
//  E. 콘솔 예외 0건
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8231';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'echo-toggle');
fs.mkdirSync(OUT, { recursive: true });
const EXE = process.env.CHROME_PATH || '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const shot = (n) => path.join(OUT, `${n}.png`);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    const state = await installFixtures(page, {});
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // 서버 preferences 목 — theme(기타 선호)와 joystickMap을 미리 심어 유실 0을 read-back 한다.
    const meStore = { preferences: { theme: 'dark', joystickMap: null } };
    const patches = [];
    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        patches.push(body.preferences ?? {});
        Object.assign(meStore.preferences, body.preferences ?? {});
      }
      await route.fulfill({ json: { ok: true, data: { id: 'u1', preferences: meStore.preferences } } });
    });

    // ── A. 기본 렌더: 토글 존재 + ON (미저장 계정은 ECHO_MODE_DEFAULT='on') ─────────
    await page.goto(APP);
    await page.getByTestId('settings-button').click();
    await page.getByTestId('settings-echo-toggle').waitFor();
    await page.getByText('답변 전 되물음', { exact: true }).first().waitFor();
    // RNW Switch = input[type=checkbox] — aria-checked 또는 checked 실측 (role에 따라 둘 중 하나 전달)
    const isOn = async () => page.getByTestId('settings-echo-toggle').evaluate((el) => {
      const input = el.tagName === 'INPUT' ? el : el.querySelector('input');
      const a = (input || el).getAttribute('aria-checked');
      return a !== null ? a : String(!!(input || el).checked);
    });
    assert.match(String(await isOn()), /true/, 'A: 기본 ON (미저장 → ECHO_MODE_DEFAULT)');
    assert.ok(!meStore.preferences.echoMode, 'A: 저장 이력 없음(서버측 echoMode 미생성)');
    await page.screenshot({ path: shot('10-settings-echo-default-on') });

    // ── B. 토글 OFF → 즉시 PATCH echoMode='off', 기존 키 보존 ────────────────────
    await page.getByTestId('settings-echo-toggle').click();
    await page.waitForTimeout(700);
    assert.equal(meStore.preferences.echoMode, 'off', 'B: 서버 PATCH 반영');
    assert.equal(meStore.preferences.theme, 'dark', 'B: 다른 preferences 키 보존');
    const last = patches[patches.length - 1] || {};
    assert.equal(last.echoMode, 'off', 'B: 패치 페이로드 echoMode=off');
    await page.getByText('말하면 바로 답해요', { exact: true }).first().waitFor(); // off 설명전환
    await page.screenshot({ path: shot('20-settings-echo-off') });

    // ── C. reload 후 OFF 유지 (서버 하이드레이션 우선) ───────────────────────────
    await page.goto(APP);
    await page.getByTestId('settings-button').click();
    await page.getByTestId('settings-echo-toggle').waitFor();
    await page.waitForTimeout(600); // hydrate(read-back) 대기
    assert.match(String(await isOn()), /false/, 'C: reload 후 OFF 유지 (서버 복원)');
    await page.getByText('말하면 바로 답해요', { exact: true }).first().waitFor();
    await page.screenshot({ path: shot('30-settings-echo-off-after-reload') });

    // ── D. 재토글 ON + reload 유지 ───────────────────────────────────────────────
    await page.getByTestId('settings-echo-toggle').click();
    await page.waitForTimeout(700);
    assert.equal(meStore.preferences.echoMode, 'on', 'D: ON 재저장');
    await page.goto(APP);
    await page.getByTestId('settings-button').click();
    await page.getByTestId('settings-echo-toggle').waitFor();
    await page.waitForTimeout(600);
    assert.match(String(await isOn()), /true/, 'D: reload 후 ON 유지');

    // ── E. 예외 0건 ──────────────────────────────────────────────────────────────
    assert.deepEqual(errors, [], 'E: 콘솔 페이지 예외 없음: ' + errors.join(' | '));
    console.log('echo-toggle smoke: 5/5 PASS (' + OUT + ')');
  } finally {
    await browser.close();
  }
})();
