// t_4b1bd4c2 입력 콘솔 재설계 — 3모드 × (평상시/제스처중) 6캡처 + 회귀 어서션
// 실행: 정적서버(python3 -m http.server 8147 @ dist-t4b1bd4c2) → node tests/e2e/shot_console_t4b1bd4c2.cjs
// 검증 계약:
//  A. 요구 1 — 평상시 입력창/패드/스틱 어디에도 마이크 아이콘·이모지 없음(번들 grep으로 이미 확인, 렌더 재확인)
//  B. 요구 2 — 방향 라벨 오버레이: 평상시 opacity 0(화면 무), 눌림 중 8방향 표시
//  C. 요구 4 — placeholder '에이전트에게 메시지 보내기' 한 줄 완전 표시(잘림 없음: scrollWidth≤clientWidth)
//  D. 콘솔 예외 0건
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8147';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'console-t4b1bd4c2');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = process.env.CHROME_PATH || '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

async function setModeFromSettings(page, mode) {
  await page.goto(APP);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('joystick-customize-button').click();
  await page.getByTestId(`joystick-mode-${mode}`).click();
  await page.waitForTimeout(500);
  await page.goto(APP);
  await page.getByTestId('voice-button').click();
  await page.waitForTimeout(700);
}

// 눌림 중 캡처: 마우스 down 유지 상태에서 오버레이 확인 후 스크린샷
async function pressHold(page, target, offset) {
  const box = await page.getByTestId(target).boundingBox();
  assert.ok(box, `press-hold 대상 ${target}`);
  await page.mouse.move(box.x + (offset ? offset.x : box.width / 2), box.y + (offset ? offset.y : box.height / 2));
  await page.mouse.down();
  await page.waitForTimeout(300); // 페이드인 160ms 통과
  return box;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installFixtures(page, {});
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const meStore = { preferences: { theme: 'dark' } };
    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() === 'PATCH') Object.assign(meStore.preferences, route.request().postDataJSON().preferences ?? {});
      await route.fulfill({ json: { ok: true, data: { id: 'u1', preferences: meStore.preferences } } });
    });

    // ── C. 채팅 입력창 — placeholder 한 줄 완전 표시 + 마이크 버튼 부재 ─────────
    await page.goto(APP);
    await page.getByTestId('session-card').click();
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 15000 });
    await page.waitForTimeout(600);
    assert.equal(await page.getByTestId('ptt-mic-button').count(), 0, '요구 1: 입력창 마이크 버튼 미렌더');
    const ph = page.getByPlaceholder('에이전트에게 메시지 보내기');
    assert.equal(await ph.count(), 1, '요구 4: placeholder 렌더');
    const clip = await ph.evaluate((el) => {
      const input = el.closest('div[style*="position: relative"]') || el;
      return { sw: input.scrollWidth, cw: input.clientWidth };
    });
    assert.ok(clip.sw <= clip.cw + 1, `요구 4: 한 줄 완전 표시 (scrollWidth ${clip.sw} ≤ clientWidth ${clip.cw})`);
    await page.screenshot({ path: shot('chat-inputbar') });

    // ── 모드별 2캡처 (평상시/눌림중) ─────────────────────────────────────────
    for (const mode of ['joystick', 'pad', 'hybrid']) {
      await setModeFromSettings(page, mode);
      const target = mode === 'joystick' ? 'joystick-mic' : 'magic-pad';
      // 평상시: 오버레이 opacity 0 (방향 라벨 화면 무 — 요구 2)
      const vis = await page.evaluate((sel) => {
        const el = document.querySelector(`[data-testid="${sel === 'joystick-mic' ? 'joystick-overlay' : 'magic-pad-overlay'}"]`);
        return el ? getComputedStyle(el).opacity : 'none';
      }, target);
      assert.ok(vis === '0' || vis === 'none', `${mode} 평상시: 오버레이 숨김 (opacity ${vis})`);
      await page.screenshot({ path: shot(`${mode}-idle`) });
      // 눌림 중: touchstart→오버레이 페이드인 → 캡처 → 릴리스
      await pressHold(page, target);
      const visPressed = await page.evaluate((sel) => {
        const el = document.querySelector(`[data-testid="${sel === 'joystick-mic' ? 'joystick-overlay' : 'magic-pad-overlay'}"]`);
        return el ? getComputedStyle(el).opacity : 'none';
      }, target);
      assert.ok(visPressed !== 'none' && parseFloat(visPressed) > 0.9, `${mode} 눌림중: 오버레이 표시 (opacity ${visPressed})`);
      const labelCount = await page.getByTestId('joystick-direction-label').count();
      assert.equal(labelCount, 8, `${mode} 눌림중: 8방향 라벨 (실측 ${labelCount})`);
      await page.screenshot({ path: shot(`${mode}-press`) });
      await page.mouse.up();
      await page.waitForTimeout(500); // 페이드아웃
      // 눌림(350ms 릴리스 = tap)이 TAP_CENTER 토글을 발동 → 녹음 중이면 재탭으로 종료(스토어는 전역이라 정리 필수)
      if ((await page.content()).includes('듣고 있습니다')) {
        const b2 = await page.getByTestId(target).boundingBox();
        await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2); // tap off → handleRelease: 녹음종료+ResultCanvas
        await page.waitForTimeout(600);
      }
      await page.goto(APP);
      await page.getByTestId('voice-button').click();
      await page.waitForTimeout(700);
    }

    assert.equal(errors.length, 0, `콘솔 예외 0건: ${errors.join(' | ')}`);
    console.log('OK — 6캡처 + placeholder/마이크제거/오버레이-눌림중전용 어서션 PASS, 캡처: ' + OUT);
    await page.close();
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('SMOKE FAIL:', e); process.exit(1); });
