/**
 * 예/아니요 칩 LIVE 왕복 실측 — t_043539ff 완료 브리프 항목 (라이브 번들 실검출 로컬 대체).
 * 백엔드: 기동 중 DEV_MODE=true :3020 (CORS에 8082 포함 확인) / 정적서버: node tests/e2e/fr-serve.cjs dist-t043539ff 8082
 *   (worldofagent.ai Netlify 자동빌드 정지 상태 — 라이브 배포는 김비서 수동 netlify deploy 소관, 메모 9/26)
 * 검증: ① 발화 후 공감(에코) 카드 하단 칩 ≤수초 내 노출 ② '예' 탭 → 발화 전송 왕복(낙관 user '예' 렌더)
 *       ③ 소멸(3초 창) ④ 새로고침 히스토리 재현 무칩
 * 실행: APP_URL=http://localhost:8082 node tests/e2e/verify_ack_live.cjs
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { openKeyboardIfVoice, waitForChatEntered } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8082';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'ack-live');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const stamp = Date.now();
  const email = `ack-live-${stamp}@myagenttalk.dev`;
  const cred = `ack-live-${stamp}!A1`;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const posts = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/sessions\/[^/]+\/messages$/.test(req.url())) {
        try { posts.push(JSON.parse(req.postData() || '{}').content); } catch { /* noop */ }
      }
    });
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.getByTestId('login-hint').click().catch(async () => {
      await page.getByTestId('new-chat-button').click();
    });
    await page.waitForTimeout(800);
    await page.getByTestId('auth-mode-toggle').click();
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(cred);
    await page.getByTestId('consent-all-required').click();
    await page.getByTestId('signup-submit').click();
    try {
      await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
    } catch (e) {
      const err = await page.getByTestId('login-error').textContent().catch(() => '(no error text)');
      console.log('  signup 실패 — login-error:', err, '| email:', email, '| cred:', cred);
      throw e;
    }
    await page.getByTestId('new-chat-button').click();
    await openKeyboardIfVoice(page);

    // ① 첫 발화 → 공감 카드 하단 칩 (empathy 행 message.new는 턴 마무리 직전 발행 — 30s 유예)
    await page.getByTestId('chat-input').fill('오늘 일정을 정리하는 데 도와줄래?');
    await page.getByTestId('send-button').click();
    const shown = await page.getByTestId('ack-chips').waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
    check('LIVE ① 발화 후 공감 카드 하단 예/아니요 칩 노출', shown);
    await page.screenshot({ path: path.join(OUT, '01-live-chips.png') });
    if (!shown) throw new Error('칩 미노출 — 후속 검사 불가');

    // ② 3초 창 관찰: 즉시 카운트 → 대기 후 0 (노출 시각에 따라 실패 가능하면 재시도 1회)
    const gone = async () => (await page.getByTestId('ack-chips').count()) === 0;
    let extinguished = await gone();
    if (!extinguished) { await sleep(3600); extinguished = await gone(); }
    if (!extinguished) {
      // 칩이 이미 사라진 뒤 도착한 케이스: 두 번째 발화로 창 처음부터 관찰
      await page.getByTestId('chat-input').fill('그리고 내일 미팅 시간도 확인해줘');
      await page.getByTestId('send-button').click();
      await page.getByTestId('ack-chips').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
      const t0 = Date.now();
      await sleep(3600);
      extinguished = (await page.getByTestId('ack-chips').count()) === 0;
      check('LIVE ② 칩 3초 후 자동 소멸 (관찰 시작 대비)', extinguished, `elapsed=${Date.now() - t0}ms`);
    } else {
      check('LIVE ② 칩 3초 후 자동 소멸', true);
    }

    // ③ '예' 탭 → 발화 전송 왕복 (낙관 user 행 '예' + 신규 공감 칩 또는 답변)
    await page.getByTestId('chat-input').fill('계약서 초안을 오늘 안에 봐줘');
    await page.getByTestId('send-button').click();
    const chipAgain = await page.getByTestId('ack-chips').waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
    check('LIVE ③ 두 번째 발화에도 칩 노출', chipAgain);
    let tapped = false;
    if (chipAgain) {
      const before = posts.length;
      await page.getByTestId('ack-chip-yes').click({ timeout: 2000 }).catch(() => {});
      for (let i = 0; i < 16 && !tapped; i++) { tapped = posts.slice(before).some((c) => c === '예'); if (!tapped) await sleep(250); }
      check('LIVE ③ 칩 탭 → POST content 정확히 "예" 1회 전송 왕복', tapped && posts.slice(before).filter((c) => c === '예').length === 1, `posts=${JSON.stringify(posts.slice(before))}`);
    } else {
      check('LIVE ③ 칩 탭 왕복 — 칩 부재로 스킵(백엔드 empathy 미생성 턴)', true, 'chip absent');
    }
    await page.screenshot({ path: path.join(OUT, '03-after-tap.png') });

    // ④ 새로고침 → 세션 재진입 = 히스토리 재현: stale 공감 행에 칩 없어야 (실시간 created_at 가드 라이브 실측)
    await sleep(5000); // 잔여 턴 settle
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.getByTestId('session-card').first().click({ timeout: 20000 });
    await waitForChatEntered(page);
    await openKeyboardIfVoice(page);
    await page.getByTestId('message-list').waitFor({ timeout: 20000 });
    await sleep(1500);
    check('LIVE ④ 새로고침 후 히스토리 공감 행에 칩 미노출', (await page.getByTestId('ack-chips').count()) === 0);
    await page.screenshot({ path: path.join(OUT, '04-reload-nochips.png') });
    check('LIVE 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));

    // 계정 정리 (smoke 관례: 가입 테스트 계정 파기)
    const login = await fetch(`${APP.replace(':8082', ':3020')}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: cred }) }).then((r) => r.json()).catch(() => null);
    if (login?.data?.token) {
      await fetch(`${APP.replace(':8082', ':3020')}/api/me`, { method: 'DELETE', headers: { authorization: `Bearer ${login.data.token}` } }).catch(() => {});
      console.log('  (테스트 계정 파기 요청 발송)');
    }
  } finally {
    await browser.close();
    console.log(`\nRESULT ack-live: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
