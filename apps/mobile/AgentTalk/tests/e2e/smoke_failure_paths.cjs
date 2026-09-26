/**
 * 실패 경로 스모크 (Codex 리뷰 검증 기준) — t_50cc173a
 * A) 전송 중 백엔드 끊김(POST abort) → 오류 바 + 입력 원문 보존 + 재시도 성공 (데모 폴백 아님)
 * B) 전체 API 차단 → 오프라인 패널 및 설정을 통한 데모 명시 선택, 데모 진입 시에만 데모 동작
 * 실행: API/WS 모의 + 정적 :8081 기동 상태에서 node smoke_failure_paths.cjs
 */
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const fs = require('fs');
const path = require('path');

const APP = process.env.APP_URL || 'http://localhost:8081';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'failure-paths');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const exe = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  await installFixtures(page);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const stamp = Date.now();
  const email = `fail-smoke-${stamp}@agenttalk.dev`;
  const cred = `fail-pw-${stamp}`;
  const shot = (n) => path.join(OUT, `${n}.png`);

  console.log('\n=== 실패 경로 스모크 ===\n');

  // 로그인 → 채팅 진입
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  if (await page.getByTestId('login-hint').isVisible()) await page.getByTestId('login-hint').click();
  await page.waitForTimeout(600);
  if (await page.getByTestId('login-card').isVisible().catch(() => false)) {
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(cred);
    await page.getByTestId('login-submit').click();
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 15000 });
  }
  await page.getByTestId('new-chat-button').click();
  await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
  await page.waitForTimeout(800);

  // ── A) 전송 중 POST 차단 ──
  let blockSend = false;
  await page.route('**/api/sessions/*/messages', async (route) => {
    if (blockSend && route.request().method() === 'POST') {
      await route.abort('connectionfailed');
      return;
    }
    await route.fallback();
  });

  const probe = `실패경로 테스트 ${stamp}`;
  blockSend = true;
  await page.getByTestId('chat-input').fill(probe);
  await page.getByTestId('send-button').click();
  await page.waitForSelector('[data-testid="error-bar"]', { timeout: 8000 }).catch(() => {});
  const errVisible = await page.getByTestId('error-bar').isVisible().catch(() => false);
  check('전송 실패 시 오류 바 표시 (데모 폴백 아님)', errVisible);
  const demoBadge = await page.getByText('DEMO').first().isVisible().catch(() => false);
  check('실패해도 자동 데모 진입 없음', !demoBadge);

  // 입력 원문 보존
  const inputVal = await page.getByTestId('chat-input').inputValue().catch(() => '');
  check('실패 시 입력 원문 보존', inputVal === probe, `value="${inputVal.slice(0, 30)}"`);

  // 실패 메시지 카드 유지 (삭제 아님) + failed 표시
  const userCards = await page.getByTestId('message-user').count();
  check('실패한 메시지 카드 유지(삭제 아님)', userCards >= 1, `cards=${userCards}`);
  await page.screenshot({ path: shot('10-send-failed') });

  // 처리중 카드 해제 확인 (실패로 종료)
  await page.waitForTimeout(600);
  const typingGone = !(await page.getByTestId('typing-indicator').isVisible().catch(() => false));
  check('실패 후 처리중 카드 해제', typingGone);

  // 재시도 버튼 → 차단 해제 후 성공
  const retryVisible = await page.getByTestId('retry-send').isVisible().catch(() => false);
  check('재시도 버튼 표시', retryVisible);
  blockSend = false;
  if (retryVisible) {
    await page.getByTestId('retry-send').click();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="error-bar"]'),
      undefined, { timeout: 15000 }
    ).catch(() => {});
    await page.waitForTimeout(1200);
  }
  const errGone = !(await page.getByTestId('error-bar').isVisible().catch(() => false));
  check('재시도 후 전송 성공(오류 바 사라짐)', errGone);
  const agentAfterRetry = await page.getByTestId('message-agent').count();
  check('재시도로 에이전트 응답 수신', agentAfterRetry >= 1, `cards=${agentAfterRetry}`);
  await page.screenshot({ path: shot('11-retry-success') });
  await page.unroute('**/api/sessions/*/messages');

  // ── B) 전체 API 차단 → 오프라인 패널 ──
  const page2 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  await installFixtures(page2);
  await page2.goto(APP, { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(800);
  await page2.route('**/api/**', (route) => route.abort('connectionfailed'));
  await page2.route('**/ws**', (route) => route.abort('connectionfailed'));
  await page2.reload({ waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(2500);
  // 큰은 localStorage에 남아있지만 health/listSessions 실패 → 오프라인 패널
  const offline = await page2.getByTestId('offline-panel').isVisible().catch(() => false);
  check('API 차단 시 오프라인 패널 표시', offline);
  await page2.screenshot({ path: shot('12-offline-panel') });

  if (offline) {
    // 데모 명시 선택
    await page2.getByTestId('settings-button').click();
    await page2.getByTestId('demo-button').click();
    await page2.waitForSelector('[data-testid="chat-input"]', { timeout: 8000 }).catch(() => {});
    await page2.waitForTimeout(600);
    const demoOn = await page2.getByTestId('demo-badge').isVisible().catch(() => false);
    check('데모는 명시적 선택 시에만 진입', demoOn);
    await page2.getByTestId('chat-input').fill('데모 확인');
    await page2.getByTestId('send-button').click();
    await page2.waitForSelector('[data-testid="message-agent"]', { timeout: 8000 }).catch(() => {});
    const demoReply = await page2.getByTestId('message-agent').count();
    check('데모 모드 응답 동작', demoReply >= 1 && await page2.getByTestId('message-agent').first().innerText().then((text) => text.includes('데모 확인') && text.includes('직접 선택한 데모')));
    check('AI 생성 고지 표시', await page2.getByTestId('ai-generated-badge').first().isVisible());
    await page2.screenshot({ path: shot('13-demo-explicit') });
  }

  const appErrors = consoleErrors.filter(
    (t) => !t.includes('favicon') && !t.includes('ERR_CONNECTION_FAILED') && !t.includes('Failed to load resource')
  );
  check('콘솔 에러 0건', appErrors.length === 0, appErrors.slice(0, 2).join(' | ').slice(0, 160));

  await browser.close();
  console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===`);
  fs.writeFileSync(path.join(OUT, 'failure-result.json'), JSON.stringify({ passed, failed }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('SMOKE CRASH:', e); process.exit(2); });
