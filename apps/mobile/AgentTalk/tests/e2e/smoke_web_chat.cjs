/**
 * 에이전트톡 웹 스모크 (t_50cc173a) — Chat MVP 프론트엔드
 * 흐름: 앱 실행 → 로그인(dev) → 대화목록 → 새 채팅 → 메시지 전송 → 응답 수신(처리중 표시 포함) → 새로고침 후 히스토리 유지
 * 실행:
 *   백엔드: DEV_MODE=true PORT=3000 tsx src/index.ts (apps/backend)
 *   정적서버: python3 -m http.server 8081 (apps/mobile/AgentTalk/dist-web)
 *   node smoke_web_chat.cjs
 */
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const APP = process.env.APP_URL || 'http://localhost:8081';
const OUT = process.env.OUT_DIR || '/home/holysky87/.hermes/profiles/frontdev/cache/scratch/smoke-shots';
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const exe = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const stamp = Date.now();
  const email = `web-smoke-${stamp}@agenttalk.dev`;
  const cred = `web-pw-${stamp}`;
  const shot = (n) => path.join(OUT, `${n}.png`);

  console.log('\n=== 에이전트톡 웹 스모크 (Chat MVP) ===\n');

  // 1) 앱 실행 → 대화 목록 (비로그인 → 미연결 상태)
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot('01-initial') });
  const headerVisible = await page.getByText('에이전트톡').first().isVisible().catch(() => false);
  check('앱 로드 — 헤더 표시', headerVisible);

  // 2) 로그인 화면 → dev 회원가입/로그인
  await page.getByTestId('login-hint').click().catch(async () => {
    // error bar가 없으면 (데모 배지 상태) 직접 내비게이션 불가 — 새 채팅 실패 경유
    await page.getByTestId('new-chat-button').click();
  });
  await page.waitForTimeout(800);
  const onLogin = await page.getByTestId('login-card').isVisible().catch(() => false);
  check('로그인 화면 진입', onLogin);
  await page.screenshot({ path: shot('02-login') });

  if (onLogin) {
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(cred);
    await page.getByTestId('login-submit').click();
    // 로그인 완료 → DialogueList로 reset (새 채팅 버튼이 보일 때까지)
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 15000 });
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: shot('03-session-list') });
  const listOk = await page.getByTestId('new-chat-button').isVisible().catch(() => false);
  check('로그인 후 대화 목록', listOk);
  const loginError = await page.getByTestId('login-error').isVisible().catch(() => false);
  check('로그인 오류 없음', !loginError);

  // 3) 새 채팅 → ChatScreen 진입
  await page.getByTestId('new-chat-button').click();
  await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot('04-chat-empty') });
  const chatOk = await page.getByTestId('chat-appbar').isVisible().catch(() => false);
  check('채팅 화면 진입', chatOk);
  const demoBadge = await page.getByText('DEMO').first().isVisible().catch(() => false);
  check('실연결 모드 (DEMO 배지 없음)', !demoBadge, demoBadge ? '데모 배지 보임' : '');

  // 4) 메시지 입력/전송 — 처리중 카드 포착 후 응답 대기
  // dev 백엔드는 템플릿 응답을 수십 ms 안에 반환 → 실제 LLM 지연 상황을 재현하기 위해
  // POST /messages 에 2.5초 지연 주입 (처리중 카드가 "예외 없이" 보이는지 결정적 검증)
  await page.route('**/api/sessions/*/messages', async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((r) => setTimeout(r, 2500));
    }
    await route.continue();
  });

  const probe = `스모크 테스트 ${stamp} — 오늘 할 일을 정리해줘`;
  await page.getByTestId('chat-input').fill(probe);
  await page.getByTestId('send-button').click();

  // 사용자 카드 즉시 표시 (낙관적 업데이트) + 처리중 카드 표시 (지연窗口 동안)
  await page.waitForSelector('[data-testid="typing-indicator"]', { timeout: 5000 }).catch(() => {});
  const sawTyping = await page.getByTestId('typing-indicator').isVisible().catch(() => false);
  check('전송 후 처리중 카드 표시', sawTyping);
  if (sawTyping) {
    // 자연어 quip 표시 확인
    const quipText = await page.getByTestId('typing-indicator').innerText().catch(() => '');
    check('처리중 카드에 자연어 안내 문구', quipText.includes('생각') || quipText.includes('찾') || quipText.length > 0, quipText.replace(/\n/g, ' ').slice(0, 40));
    await page.screenshot({ path: shot('05-typing') });
  }
  const userCardVisible = await page.getByTestId('message-user').first().isVisible().catch(() => false);
  check('내 메시지 카드 즉시 표시', userCardVisible);

  // 에이전트 응답 대기 (지연 2.5초 + 파이프라인 — 최대 30초)
  await page.waitForSelector('[data-testid="message-agent"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const agentCount = await page.getByTestId('message-agent').count();
  check('에이전트 응답 카드 수신', agentCount >= 1, `count=${agentCount}`);
  await page.screenshot({ path: shot('06-agent-reply') });

  // 처리 종료 후 typing 카드 사라짐 확인
  const typingGone = !(await page.getByTestId('typing-indicator').isVisible().catch(() => false));
  check('응답 완료 후 처리중 카드 해제', typingGone);

  // 응답 본문에 데모 문구가 없어야 함 (실연결 증거)
  const replyText = await page.getByTestId('message-agent').first().innerText().catch(() => '');
  check('실응답 내용 (데모 문구 아님)', replyText.length > 0 && !replyText.includes('연결되지 않아'), replyText.slice(0, 40));

  // 5) 두 번째 메시지 + 히스토리 페이지네이션 준비 상태
  const probe2 = `두 번째 스모크 ${stamp}`;
  await page.getByTestId('chat-input').fill(probe2);
  await page.getByTestId('send-button').click();
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="message-agent"]').length >= n,
    agentCount + 1,
    { timeout: 30000 }
  ).catch(() => {});
  await page.waitForTimeout(500);
  const agentCount2 = await page.getByTestId('message-agent').count();
  check('두 번째 턴 응답 수신', agentCount2 > agentCount, `${agentCount} → ${agentCount2}`);
  await page.screenshot({ path: shot('07-two-turns'), fullPage: false });

  // 6) 새로고침 → 대화목록에서 세션 카드 재진입 → 히스토리 유지
  // (SPA reload는 초기 라우트(DialogueList)로 돌아가므로, 실사용자 흐름대로 카드 탭으로 재진입)
  await page.unroute('**/api/sessions/*/messages');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // 목록에 실세션 카드가 있어야 함 (목업 카드와 구분: session-card testID)
  const sessionCards = await page.getByTestId('session-card').count();
  check('새로고침 후 목록에 실세션 카드', sessionCards >= 1, `cards=${sessionCards}`);
  await page.screenshot({ path: shot('08a-list-after-reload') });
  if (sessionCards >= 1) {
    await page.getByTestId('session-card').first().click();
    await page.waitForSelector('[data-testid="message-user"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  const usersAfter = await page.getByTestId('message-user').count();
  const agentsAfter = await page.getByTestId('message-agent').count();
  check('재진입 후 히스토리 유지', usersAfter >= 2 && agentsAfter >= agentCount2, `user=${usersAfter} agent=${agentsAfter} (기대 agent≥${agentCount2})`);
  await page.screenshot({ path: shot('08b-history-restored') });

  // 7) 콘솔/페이지 에러 0건
  const appErrors = consoleErrors.filter((t) => !t.includes('favicon') && !t.includes('Download the React DevTools'));
  check('콘솔 에러 0건', appErrors.length === 0, appErrors.slice(0, 3).join(' | ').slice(0, 200));
  check('페이지 예외 0건', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ').slice(0, 200));

  await browser.close();
  console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===`);
  console.log(`스크린샷: ${OUT}`);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ passed, failed, consoleErrors: appErrors, pageErrors }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('SMOKE CRASH:', e); process.exit(2); });
