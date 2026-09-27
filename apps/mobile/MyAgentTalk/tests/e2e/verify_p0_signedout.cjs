/**
 * t_c0fb3b22 검증 — 미로그인 오판(P0) 수정 3장 캡처
 * ① 비로그인 첫 화면: 온보딩 CTA 활성 + 'can't reach' 미노출 + Offline 배지 없음
 * ② 로그인 후 목록 정상(온보딩/오프라인 배너 소멸)
 * ③ 백엔드 실제 stop 후 새로고침: 그 때만 'can't reach' 노출
 * 실행: bash가 백엔드(:3100)·정적서버(:8097, dist-p0fix)를 띄운 뒤 백그라운드 PID를 env로 전달.
 *       이 스크립트가 ③에서 백엔드 프로세스를 kill 한다.
 */
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const APP = process.env.APP_URL || 'http://localhost:8097';
const API = process.env.API_URL || 'http://localhost:3100';
const BACKEND_PID = Number(process.env.BACKEND_PID || 0);
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts/p0-signedout');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

(async () => {
  const exe = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
  const browser = await chromium.launch({ executablePath: exe });
  const stamp = Date.now();

  // ── ① 비로그인 첫 화면 ──
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="onboarding-panel"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'chk1-signed-out.png') });
  const bodyText1 = await page.textContent('body');
  check('① 온보딩 패널 표시', await page.getByTestId('onboarding-panel').isVisible());
  check("① 'can't reach'/'서버에 연결' 미노출", !/can.t reach|서버에 연결할 수 없/.test(bodyText1));
  check('① Offline 배지 미노출', !/오프라인/.test(bodyText1));
  check('① 상단 sign-in 배너 노출', await page.getByTestId('login-hint').isVisible());
  const ctaDisabled = await page.getByTestId('new-chat-button').isDisabled().catch(() => true);
  check('① Start a chat CTA 활성', !ctaDisabled);
  check('① 로그인/가입 버튼 노출', await page.getByTestId('signin-button').isVisible());

  // CTAタップ → 로그인 화면 이동 확인 후, 그 로그인 화면에서 ② 가입 진행
  await page.getByTestId('new-chat-button').click();
  await page.waitForSelector('[data-testid="login-card"]', { timeout: 15000 });
  check('① CTA 탭 시 로그인 화면 이동', true);

  // ── ② 회원가입/로그인 후 목록 정상 ──
  const email = `p0fix-${stamp}@myagenttalk.dev`;
  await page.getByTestId('auth-mode-toggle').click();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(`p0-${stamp}`);
  const allAgree = page.getByTestId('consent-all-required');
  if (await allAgree.isVisible().catch(() => false)) await allAgree.click();
  else {
    const boxes = page.locator('[role="checkbox"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).click().catch(() => {});
  }
  await page.getByTestId('signup-submit').click();
  await page.waitForSelector('[data-testid="session-list"], [data-testid="login-error"]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'chk2-logged-in.png') });
  check('② 로그인 후 온보딩 패널 소멸', !(await page.getByTestId('onboarding-panel').isVisible().catch(() => false)));
  check('② 목록(세션 리스트) 렌더', await page.getByTestId('session-list').isVisible().catch(() => false));
  const bodyText2 = await page.textContent('body');
  check('② 오프라인/온보딩 문구 없음', !/can.t reach|서버에 연결할 수 없|오프라인|로그인 / .test(bodyText2), '로그인 배너도 소멸해야 정상');

  // ── ③ 백엔드 실제 stop → 새로고침 시에만 'can't reach' ──
  if (!BACKEND_PID) throw new Error('BACKEND_PID 미전달 — ③ 검증 불가');
  process.kill(BACKEND_PID, 'SIGTERM');
  for (let i = 0; i < 30; i++) {
    try { process.kill(BACKEND_PID, 0); await new Promise((r) => setTimeout(r, 200)); } catch { break; }
  }
  console.log('  INFO  백엔드 종료 확인');
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, 'chk3-backend-down.png') });
  const bodyText3 = await page.textContent('body');
  check('③ 백엔드 stop 시 오프라인 패널', await page.getByTestId('offline-panel').isVisible().catch(() => false));
  check("③ '서버에 연결할 수 없어요' 노출", /서버에 연결할 수 없/.test(bodyText3));
  check('③ Offline 배지 노출', /오프라인/.test(bodyText3));
  check('③ 재시도 버튼 노출', await page.getByTestId('retry-button').isVisible().catch(() => false));

  await browser.close();
  console.log(`\n결과: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('스크립트 오류:', e); process.exit(2); });
