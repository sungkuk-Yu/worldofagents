/**
 * 예/아니요 칩 + 조이스틱 홀드-arm e2e 스모크 — t_043539ff
 * 대표님 9/28 코멘트: ① 공감 카드 하단 예/아니요 칩(노출 후 3초 한시), ② 조이스틱 끝방향 0.8s 홀드 = 예/아니요.
 * 검증:
 *   ① 발화 후 empathy(복창) 카드 하단 칩 노출, 3초 후 자동 소멸
 *   ② 칩 탭 = '예' 텍스트 POST 1회 (백엔드 확인 발화 게이트 계약 텍스트)
 *   ③ 칩 탭 후 이전 칩 잔존 없음 (낙관 user 행 = 답변 시작 소멸)
 *   ④ 조이스틱 ← 900ms 홀드 → 아밍 배너(joystick-ack-armed) → 릴리스 = audio.cancel + '예' POST (녹음 폐기·텍스트 발화)
 *   ⑤ 얕은 좌 스와이프(<0.8s) = 텍스트 발화 없음 — 기존 매핑 경로(전송) 보존
 *   ⑥ 히스토리 재현(stale empathy 행) = 칩 없음
 *   ⑦ PC 1440 = 칩 정상(카드 귀속), 조이스틱/홀드 없음(음성 콘솔 미렌더)
 * 실행: node tests/e2e/fr-serve.cjs dist-t043539ff 8113 &
 *       APP_URL=http://localhost:8113 node tests/e2e/smoke_ack_chips.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8113';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'ack-chips');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function openMobileChat(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, { ack: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('chat-voice-console').waitFor({ timeout: 15000 });
  return { page, state, errors, ctx };
}
const sends = (state) => state.calls.filter((c) => c.path.endsWith('/messages') && c.method === 'POST').map((c) => c.body && c.body.content);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── ⑥ 히스토리 재현 = 칩 없음 (진입 직후 stale empathy 행만 존재) ──
    const { page, state, errors } = await openMobileChat(browser);
    check('⑥ 진입 시점 stale 공감 행에 칩 없음', (await page.getByTestId('ack-chips').count()) === 0);

    // ── ① 발화 → 칩 노출 → 3초 소멸 ──
    await page.getByTestId('chat-keyboard-button').click();
    await page.getByTestId('chat-input').waitFor({ timeout: 8000 });
    await page.getByTestId('chat-input').fill('내일 출장 일정 잡아줘');
    await page.getByTestId('send-button').click();
    const chipVisible = await page.getByTestId('ack-chips').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
    check('① 복창 카드 하단 예/아니요 칩 노출', chipVisible);
    check('① 칩 구성: 예+아니요 2개', (await page.getByTestId('ack-chip-yes').count()) === 1 && (await page.getByTestId('ack-chip-no').count()) === 1);
    await page.screenshot({ path: shot('01-chip-visible') });
    const goneAfter3s = await page.getByTestId('ack-chips').waitFor({ state: 'detached', timeout: 6000 }).then(() => true).catch(() => false);
    check('① 3초 후 칩 자동 소멸', goneAfter3s);

    // ── ②③ 칩 탭 = '예' 전송 1회 + 이전 칩 잔존 없음 ──
    await page.getByTestId('chat-input').fill('회의실을 잡을까');
    await page.getByTestId('send-button').click();
    await page.getByTestId('ack-chips').waitFor({ timeout: 6000 });
    await page.screenshot({ path: shot('02-before-tap') });
    const before = sends(state).length;
    await page.getByTestId('ack-chip-yes').click();
    await page.waitForTimeout(400);
    const after = sends(state);
    check('② 칩 탭 = POST 발화 1회', after.length === before + 1, JSON.stringify(after.slice(before)));
    check('② payload = 정확히 "예" (게이트 계약 텍스트)', after[after.length - 1] === '예');
    // 낙관 '예' user 행 등장 = 답변 시작 → 구 칩 즉시 소멸 (다음 턴 신규 칩과 구분: 이전 empathy id 대상 아님)
    await page.waitForTimeout(200);
    const domIds = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="ack-chips"]')).length);
    check('③ 탭 후 이전 칩 잔존 없음(≤1 = 다음 턴 신규만)', domIds <= 1, `chips=${domIds}`);

    // ── ④ 조이스틱 ← 홀드 900ms → arm → 릴리스 = '예' 텍스트 발화 (음성 폐기) ──
    await page.getByTestId('chat-voice-back').click();
    await page.getByTestId('chat-voice-console').waitFor({ timeout: 5000 });
    const box = await page.getByTestId('joystick-mic').boundingBox();
    assert.ok(box, 'joystick-mic 박스');
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const before4 = sends(state).length;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(cx - 14 * i, cy); await page.waitForTimeout(30); }
    await page.waitForTimeout(950); // 0.8s arm 유지
    const armed = await page.getByTestId('joystick-ack-armed').isVisible().catch(() => false);
    check('④ ← 0.8s 홀드 = 아밍 배너("예 — 놓으면 전송")', armed);
    await page.screenshot({ path: shot('04-joystick-armed') });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after4 = sends(state);
    const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('④ 릴리스 = "예" 텍스트 POST 1회', after4.length === before4 + 1 && after4[after4.length - 1] === '예', JSON.stringify(after4.slice(before4)));
    check('④ 음성 발화는 폐기(audio.start→cancel, end 없음)', types.includes('audio.start') && types.includes('audio.cancel') && !types.slice(types.lastIndexOf('audio.start')).includes('audio.end'), types.slice(-8).join(','));
    const bannerGone = (await page.getByTestId('joystick-ack-armed').count()) === 0;
    check('④ 릴리스 후 아밍 배너 소멸', bannerGone);

    // ── ⑤ 얕은 좌 스와이프(<0.8s) = 홀드-arm 미발동, 텍스트 발화 없음 ──
    const before5 = sends(state).length;
    const typesBefore = state.frames.length;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(cx - 14 * i, cy); await page.waitForTimeout(30); }
    await page.waitForTimeout(200); // arm 임계 미달
    await page.mouse.up();
    await page.waitForTimeout(400);
    check('⑤ 얕은 스와이프(<0.8s) = 텍스트 발화 없음(홀드-arm 미발동)', sends(state).length === before5);
    const newFrames = state.frames.slice(typesBefore).filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑤ 얕은 스와이프 = 기존 audio 경로(end) 유지', newFrames.includes('audio.end') && !newFrames.includes('audio.cancel'), newFrames.join(','));
    check('런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));
    await page.close();

    // ── ⑦ PC 1440 = 칩 정상·조이스틱 없음 ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const state = await installFixtures(page, { ack: true });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').click();
      await page.getByTestId('chat-input').waitFor({ timeout: 15000 });
      check('⑦ PC = 음성 콘솔/조이스틱 없음', (await page.getByTestId('chat-voice-console').count()) === 0 && (await page.getByTestId('joystick-mic').count()) === 0);
      await page.getByTestId('chat-input').fill('PC 발화');
      await page.getByTestId('send-button').click();
      const pcChip = await page.getByTestId('ack-chips').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
      check('⑦ PC 칩 노출(카드 귀속 — 디바이스 무관)', pcChip);
      await page.screenshot({ path: shot('07-pc-chip') });
      await page.close();
    }
  } finally {
    await browser.close();
    console.log(`\nRESULT ack-chips: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
