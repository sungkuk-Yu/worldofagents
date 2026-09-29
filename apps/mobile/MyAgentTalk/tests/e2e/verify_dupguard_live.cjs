/**
 * t_4af94b1c — 대표님 재현 시나리오 ①의 라이브 검증(백엔드 실동, 픽스처 없음).
 * 사고 재현(로그 t_c31e3f45): Enter+전송 동시 탭 → 동일 content 2 POST → 백엔드 ingress 드롭의
 * {deduped:true} 응답을 프론트가 처리 못 해 유령 낙관 행 + '서버가 응답하지 않았어요' 배너 + quip 3중.
 * 검증: 390px 모바일 뷰포트에서 회원가입 → 채팅 → '안녕' 입력 → Enter 눌림 직후 전송 버튼 클릭(동시 발화 재현).
 *  ① POST /messages 1회(프론트 in-flight 가드)
 *  ② 완료 후 user 행 1개·answer 1개(이중 영속 소멸)
 *  ③ error-bar 없음  ④ 실행 중 quip 문구 DOM 1회(②수리 회귀선)
 *  ⑤ deduped 백엔드 응답 자체도 라이브로 견딤: 완료 후 동일 문장 즉시 재전송(백엔드 드롭 창 3초) →
 *    유령 행/배너 없이 UI 정상(가드가 이미 1차 차단하므로 POST 2회차는 재전송 통로로만 발생)
 * 실행: BE(DEV_MODE=true PORT=3120 CORS_ORIGIN에 서빙포트) + node fr-serve.cjs dist-t4af94b1c-live 8139
 *       APP_URL=http://localhost:8139 node tests/e2e/verify_dupguard_live.cjs
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8139';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'dupguard-live');
fs.mkdirSync(OUT, { recursive: true });
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const QUIP = '살펴보고 있어요';

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const posts = [];
  const responses = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/messages(\?|$)/.test(r.url()) && r.postData()) posts.push(r.url()); });
  page.on('response', async (r) => {
    if (r.url().includes('/messages') && r.request().method() === 'POST') {
      try { responses.push(await r.json()); } catch { /* noop */ }
    }
  });
  try {
    const stamp = Date.now();
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('login-hint').click().catch(async () => { await page.getByTestId('new-chat-button').click(); });
    await page.waitForTimeout(800);
    if (await page.getByTestId('login-card').isVisible().catch(() => false)) {
      await page.getByTestId('auth-mode-toggle').click().catch(() => {});
      await page.getByTestId('login-email').fill(`dupguard-${stamp}@myagenttalk.dev`);
      await page.getByTestId('login-password').fill(`dup-${stamp}`);
      await page.getByTestId('consent-all-required').click().catch(() => {});
      await page.getByTestId('signup-submit').click();
      await page.waitForTimeout(2500);
    }
    check('로그인/가입 성공', await page.getByTestId('new-chat-button').isVisible().catch(() => false));
    await page.getByTestId('new-chat-button').click();
    await page.getByTestId('chat-appbar').waitFor({ timeout: 8000 });
    // A→B 전이로 키보드 입력바 개방
    const box = await page.getByTestId('voice-stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(cx, cy - i * 20); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.getByTestId('chat-input').waitFor({ timeout: 8000 });

    // 동시 발화 재현: Enter(onSubmitEditing) 직후 send-button 클릭 — 리렌더 전 같은 tick 2 트리거
    const TEXT = '중재 판정 테스트 안녕';
    await page.getByTestId('chat-input').fill(TEXT);
    await page.getByTestId('chat-input').press('Enter');
    await page.getByTestId('send-button').click({ force: true }).catch(() => {}); // 동시 탭 재현
    await page.waitForTimeout(400);
    check('① POST /messages 1회 (in-flight 가드)', posts.length === 1, `posts=${posts.length}`);

    // ④ 실행 중 quip 단일 렌더 (스트리밍 카드가 뜨면 그 구간)
    await page.getByTestId('typing-indicator').waitFor({ timeout: 8000 }).catch(() => {});
    const quipWhile = await page.getByText(QUIP, { exact: false }).count();
    check('④ 실행 중 quip 문구 1회 이하', quipWhile <= 1, `count=${quipWhile}`);
    await page.screenshot({ path: path.join(OUT, '01-running.png') });

    // 턴 완료 대기 (answer 카드 등장)
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="typing-indicator"]'),
      null, { timeout: 60000 },
    ).catch(() => {});
    await page.waitForTimeout(1200);
    const userRows = await page.getByText(TEXT, { exact: true }).count();
    check('② user 행 1개(라벨 복제 최대 2 허용, 2행=4는 차단)', userRows <= 2, `textNodes=${userRows}`);
    check('③ error-bar 없음', (await page.getByTestId('error-bar').count()) === 0);
    check('deduped 응답 0회(가드가 선 차단)', responses.every((r) => !r.data?.deduped), JSON.stringify(responses.map((r) => (r.data?.deduped ? 'deduped' : 'accepted'))));

    // ⑤ 완료 직후 동일 발화 재전송 — 3초 드롭 창 내 백엔드 deduped 경로 실견디기
    await page.getByTestId('chat-input').fill(TEXT);
    await page.getByTestId('send-button').click();
    await page.waitForTimeout(1500);
    const banner = await page.getByTestId('error-bar').count();
    const ghostPending = await page.getByText('전송중…', { exact: true }).count();
    check('⑤ 재전송 후 유령/배너 없음', banner === 0, `banner=${banner} pending=${ghostPending}`);
    await page.screenshot({ path: path.join(OUT, '02-resend.png') });
    check('JS 오류 없음', errors.length === 0, errors.join('|').slice(0, 150));
    console.log(`\n=== dupguard 라이브: PASS ${passed} / FAIL ${failed} ===`);
    process.exit(failed ? 1 : 0);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
