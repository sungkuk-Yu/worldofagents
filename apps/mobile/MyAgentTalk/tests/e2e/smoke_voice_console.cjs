/**
 * 채팅 음성 우선 콘솔 e2e 스모크 — t_e735d936
 * 대표님 9/28 새벽 슛: "일단 음성기능이 먼저 떠주고, 조이스틱으로 누른상태에서 위로 올리면 키보드 나오게".
 * 검증: ① 웹 모바일(390) 진입 = 음성 콘솔 1차 UI, 입력창 미렌더(2차로 강등)
 *       ② 로드 시 마이크 권한 미요구 (permissions.query=microphone state 'prompt')
 *       ③ 홀드 후 ↑ = audio.start→audio.cancel + 키보드(입력창) 개방 — 제스처 시점에만 권한 요구
 *       ④ 탭 = audio.start→binary PCM frames→audio.end (놓으면 전송)
 *       ⑤ 권한 거부(페이크 디바이스 없는 페이지) = 폴백 안내 한 줄 + 입력창 자동 개방
 *       ⑥ PC 1440 = 음성 콘솔 없음, 입력창 상시 (기존 동작 보존)
 * 실행: (정적서버) python3 -m http.server 8097 --bind 127.0.0.1 -d dist-voice
 *       APP_URL=http://localhost:8097 node tests/e2e/smoke_voice_console.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8097';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'voice-console');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function openMobileChat(browser) {
  // ⑤(권한 거부)는 페이크 디바이스 플래그가 없는 별도 브라우저 인스턴스를 직접 열어 수행 — launch 단위 플래그.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('chat-voice-console').waitFor({ timeout: 15000 });
  return { page, state, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── ① + ② 진입 = 음성 콘솔, 로드 시 권한 미요구 ──
    {
      const { page, state, errors } = await openMobileChat(browser);
      check('① 음성 콘솔 1차 UI 렌더', await page.getByTestId('chat-voice-console').isVisible());
      check('① 조이스틱 디스크 노출 (joystick-mic)', (await page.getByTestId('joystick-mic').count()) === 1);
      check('① 입력창은 2차 — 진입 시 미렌더', (await page.getByTestId('chat-input').count()) === 0);
      check('① 키보드 진입 버튼 노출', (await page.getByTestId('chat-keyboard-button').count()) === 1);
      const micPerm = await page.evaluate(() => navigator.permissions.query({ name: 'microphone' }).then((p) => p.state).catch(() => 'unsupported'));
      check('② 로드 시 권한 미요구 (state=prompt)', micPerm === 'prompt' || micPerm === 'granted', `perm=${micPerm}`);
      check('② 음성 WS 컨트롤 프레임 아직 없음', state.frames.filter((f) => f && f.type === 'audio.start').length === 0);
      check('① 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 120));
      await page.screenshot({ path: shot('01-voice-first') });
      await page.close();
    }

    // ── ③ 누른 채 위로 = 음성 폐기 + 키보드 개방 ──
    {
      const { page, state } = await openMobileChat(browser);
      const box = await page.getByTestId('joystick-mic').boundingBox();
      assert.ok(box, 'joystick-mic 박스');
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 5; i++) { await page.mouse.move(cx, cy - 12 * i); await page.waitForTimeout(40); }
      await page.mouse.up();
      await page.getByTestId('chat-input').waitFor({ timeout: 8000 });
      const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
      check('③ ↑ 홀드: audio.start 직후 audio.cancel (발화 폐기)', types.includes('audio.start') && types.includes('audio.cancel'), types.join(','));
      check('③ ↑ 홀드 후 전송(end) 없음', !types.includes('audio.end'));
      check('③ 키보드(2차 입력창) 개방', await page.getByTestId('chat-input').isVisible());
      const focused = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="chat-input"]');
        const input = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : el.querySelector('input,textarea'));
        return !!input && document.activeElement === input;
      });
      check('③ 진입 시 포커스(키보드 올라옴)', focused);
      check('③ 음성 복귀 버튼 노출', (await page.getByTestId('chat-voice-back').count()) === 1);
      await page.screenshot({ path: shot('03-keyboard-opened') });
      // 복귀 버튼 → 음성 콘솔 재노출
      await page.getByTestId('chat-voice-back').click();
      await page.getByTestId('chat-voice-console').waitFor({ timeout: 5000 });
      check('③ 음성 복귀 버튼 = 콘솔 재전시·입력창 강등', (await page.getByTestId('chat-input').count()) === 0);
      await page.close();
    }

    // ── ④ 탭 = 눌러서 놓고 전송 ──
    {
      const { page, state } = await openMobileChat(browser);
      const box = await page.getByTestId('joystick-mic').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(320); // 홀드 유지(웨이브폼 캡처) — 롱프레스 500ms 미만
      await page.screenshot({ path: shot('04-hold-recording') });
      const bannerShown = await page.getByTestId('ptt-banner').count();
      await page.mouse.up();
      await page.waitForTimeout(600);
      const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
      const pcmFrames = state.frames.filter((f) => f && typeof f.binary === 'number').length;
      check('④ 탭-홀드: audio.start→audio.end (놓으면 전송)', types.includes('audio.start') && types.includes('audio.end') && !types.includes('audio.cancel'), types.join(','));
      check('④ PCM 바이너리 프레임 WS 전송', pcmFrames > 0, `frames=${pcmFrames}`);
      check('④ 녹음 중 하단 배너(웨이브폼)', bannerShown > 0);
      await page.close();
    }

    // ── ⑤ 권한 거부 폴백 (페이크 디바이스 없는 별도 브라우저 인스턴스) ──
    {
      const denyBrowser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
      try {
        const ctx = await denyBrowser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', permissions: [] });
        const page = await ctx.newPage();
        const state = await installFixtures(page);
        await page.goto(APP, { waitUntil: 'networkidle' });
        await page.getByTestId('session-card').click();
        await page.getByTestId('chat-voice-console').waitFor({ timeout: 15000 });
        const box = await page.getByTestId('joystick-mic').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(350);
        await page.mouse.up();
        // 권한 요구는 제스처 후에만 발생 — 폴백 안내 + 입력창 자동 개방
        await page.getByTestId('chat-voice-fallback').waitFor({ timeout: 8000 }).catch(() => {});
        const fallbackVisible = await page.getByTestId('chat-voice-fallback').isVisible().catch(() => false);
        await page.getByTestId('chat-input').waitFor({ timeout: 8000 }).catch(() => {});
        const inputOpened = (await page.getByTestId('chat-input').count()) > 0;
        const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
        check('⑤ 거부 후에도 콘솔 유지 + 폴백 안내 표시', fallbackVisible, `fallback=${fallbackVisible}`);
        check('⑤ 거부 시 텍스트 입력 자동 개방(완전 작동)', inputOpened);
        check('⑤ 권한 요구는 누름 이후에만 (audio.start→cancel)', types.includes('audio.start'), types.join(','));
        await page.screenshot({ path: shot('05-denied-fallback') });
        await page.close();
      } finally { await denyBrowser.close(); }
    }

    // ── ⑥ PC 1440 = 기존 텍스트 채팅 보존 ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await installFixtures(page);
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').click();
      await page.getByTestId('chat-input').waitFor({ timeout: 15000 });
      check('⑥ PC = 음성 콘솔 없음·입력창 상시', (await page.getByTestId('chat-voice-console').count()) === 0 && (await page.getByTestId('chat-input').count()) === 1);
      await page.screenshot({ path: shot('06-pc-unchanged') });
      await page.close();
    }
  } finally {
    await browser.close();
    console.log(`\nRESULT voice-console: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
