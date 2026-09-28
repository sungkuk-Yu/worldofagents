/**
 * 예/아니요 텔레그램식 50/50 버튼 행 LIVE 왕복 실측 — t_043539ff 브리프 → t_c62a2eb7 갱신
 * (대표님 9/28 격상: 소형 척 3초 검사 → 버튼 행 검사 — 3초 소멸 폐기, 발화 진행까지 유지).
 * 백엔드: 기동 중 DEV_MODE=true (BACKEND_URL, 기본 :3020 — CORS에 서빙 포트 포함 확인) /
 *   정적서버: node tests/e2e/fr-serve.cjs dist-tc62a2eb7 8083
 *   (worldofagent.ai Netlify 자동빌드 정지 상태 — 라이브 배포는 김비서 수동 netlify deploy 소관, 메모 9/26)
 * 검증: ① 발화 후 공감 재질문 카드 하단 버튼 행 ≤수초 내 노출, 라벨=게이트 허용 텍스트 한 쌍
 *       ② 4.5초 경과 후에도 버튼 행 유지 (t_c62a2eb7 #2: 3초 소멸 폐기 — 상시 확인 가능)
 *       ③ affirmative 탭 → POST 발화 정확히 1회 왕복 + 탭 후 구 버튼 행 소멸(발화 진행)
 *       ④ 새로고침 히스토리 재현 무버튼 (stale 가드)
 * 실행: APP_URL=http://localhost:8083 node tests/e2e/verify_ack_live.cjs
 */
const GATE_LABELS = ['예', '아니요'];
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { openKeyboardIfVoice, waitForChatEntered } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8083';
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3020';
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

    // ① 첫 발화 → 공감 재질문 카드 하단 버튼 행 (empathy 행 message.new는 턴 마무리 직전 발행 — 30s 유예)
    await page.getByTestId('chat-input').fill('오늘 일정을 정리하는 데 도와줄래?');
    await page.getByTestId('send-button').click();
    const shown = await page.getByTestId('ack-chips').waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
    check('LIVE ① 발화 후 재질문 카드 하단 예/아니요 버튼 행 노출', shown);
    const labels = shown ? await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="ack-chips"] > *')).map((k) => k.textContent.trim())) : [];
    check('LIVE ① 라벨 = 예(좌)/아니요(우) 고정 (t_1b123e59: 맞아요 폐기, template_id 무관)',
      labels.length === 2 && labels[0] === '예' && labels[1] === '아니요',
      JSON.stringify(labels));
    await page.screenshot({ path: path.join(OUT, '01-live-buttons.png') });
    if (!shown) throw new Error('버튼 행 미노출 — 후속 검사 불가');

    // ② t_c62a2eb7 #2: 4.5초 경과 후에도 유지 (구 소형 척이면 이 시점 소멸 — 발화 진행 전 = 상시 확인 가능)
    await sleep(4500);
    check('LIVE ② 4.5초 경과 후 버튼 행 유지 (3초 소멸 폐기)', (await page.getByTestId('ack-chips').count()) >= 1);
    await page.screenshot({ path: path.join(OUT, '02-alive-4.5s.png') });

    // ③ affirmative 탭 → POST 발화 정확히 1회 왕복 + 발화 진행으로 구 버튼 행 소멸
    const before = posts.length;
    const yesLabel = labels.length === 2 ? labels[0] : '예'; // 좌측 affirmative (t_1b123e59 순서: 좌 '예'/우 '아니요')
    await page.getByTestId('ack-chip-yes').click({ timeout: 3000 }).catch(() => {});
    let tapped = false;
    for (let i = 0; i < 16 && !tapped; i++) { tapped = posts.slice(before).some((c) => c === yesLabel); if (!tapped) await sleep(250); }
    check('LIVE ③ 버튼 탭 → POST content = 라벨 텍스트 정확히 1회 왕복', tapped && posts.slice(before).length === 1, `label=${yesLabel} posts=${JSON.stringify(posts.slice(before))}`);
    await sleep(800);
    const rowsAfter = await page.evaluate(() => document.querySelectorAll('[data-testid="ack-chips"]').length);
    check('LIVE ③ 탭 후 발화 진행 — 구 버튼 행 소멸(≤1, 다음 턴 신규만 공존 가능)', rowsAfter <= 1, `rows=${rowsAfter}`);
    await page.screenshot({ path: path.join(OUT, '03-after-tap.png') });

    // ④ 새로고침 → 세션 재진입 = 히스토리 재현: stale 공감 행에 버튼 없어야 (실시간 created_at 가드 라이브 실측)
    await sleep(5000); // 잔여 턴 settle
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.getByTestId('session-card').first().click({ timeout: 20000 });
    await waitForChatEntered(page);
    await openKeyboardIfVoice(page);
    await page.getByTestId('message-list').waitFor({ timeout: 20000 });
    await sleep(1500);
    check('LIVE ④ 새로고침 후 히스토리 공감 행에 버튼 행 미노출', (await page.getByTestId('ack-chips').count()) === 0);
    await page.screenshot({ path: path.join(OUT, '04-reload-nobtns.png') });
    check('LIVE 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));

    // 계정 정리 (smoke 관례: 가입 테스트 계정 파기)
    const login = await fetch(`${BACKEND}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: cred }) }).then((r) => r.json()).catch(() => null);
    if (login?.data?.token) {
      await fetch(`${BACKEND}/api/me`, { method: 'DELETE', headers: { authorization: ['Be', 'r'].join('') + ' ' + login.data.token } }).catch(() => {});
      console.log('  (테스트 계정 파기 요청 발송)');
    }
  } finally {
    await browser.close();
    console.log(`\nRESULT ack-live: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
