/**
 * 법률 컴플라이언스 UI 스모크 — t_eb7f13e9
 * 실 API 연동: DEV_MODE 백엔드(:3020) + dist-legal 정적서버(:8099) 대상 (mock 아님).
 * 실행:
 *   백엔드: DEV_MODE=true PORT=3020 CORS_ORIGIN=http://localhost:8099 tsx src/index.ts
 *   정적서버: python3 -m http.server 8099 --bind 127.0.0.1 -d dist-legal (+window.process shim)
 *   APP_URL=http://localhost:8099 node tests/e2e/smoke_legal.cjs
 * 검증 (카드 항목 ↔ 대응):
 *   ① 가입 동의 게이트 — 필수 미동의 시 가입 버튼 비활성 + 서버 400 CONSENT_REQUIRED 방어
 *   ② AI 고지 — 채팅 상시 배너(ai-disclosure) + 카드 AI 생성 배지, ko/en 양쪽
 *   ③④ 정책 문서 — 게이트 링크→이용약관(DRAFT 배너 유지), 설정→개인정보처리방침, ko/en 칩 전환
 *   ⑤ 회원탈퇴 — 설정→다이얼로그→미확인 시 버튼 비활성→확인 후 DELETE /api/me→재가입 실패로 파기 검증
 *   스크린샷: artifacts/legal/{ko,en}-*.png
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8099';
const API = process.env.API_URL || 'http://localhost:3020';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'legal');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
async function openLogin(page, locale) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="login-hint"], [data-testid="new-chat-button"]', { timeout: 20000 });
  await page.getByTestId('login-hint').click();
  await page.getByTestId('auth-mode-toggle').click();
  await page.waitForSelector('[data-testid="consent-all-required"]', { timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const stamp = Date.now();
  try {
    // ════════ KO ════════
    const koCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const ko = await koCtx.newPage();
    const koErrors = [];
    ko.on('pageerror', (e) => koErrors.push(String(e)));

    // ── ① 동의 게이트: 미동의 차단 ──
    await openLogin(ko, 'ko');
    await ko.getByTestId('login-email').fill(`legal-${stamp}@myagenttalk.dev`);
    await ko.getByTestId('login-password').fill(`pw-${stamp}`);
    const submit = ko.getByTestId('signup-submit');
    check('KO: 필수 미동의 시 가입 버튼 비활성', await submit.evaluate((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.className.includes('disabled')));
    await ko.screenshot({ path: shot('ko-01-consent-gate'), fullPage: true });

    // 서버측 방어: 게이트를 우회해도 400 CONSENT_REQUIRED (API 직접 호출).
    // DEV_MODE는 consents 필드 '생략' 시 dev-auto 통과시키므로, 명시적 빈 배열로 검증한다.
    const bypass = await fetch(`${API}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `bypass-${stamp}@myagenttalk.dev`, password: `pw-${stamp}`, consents: [], age_confirmed: false }) });
    const bypassBody = await bypass.json().catch(() => ({}));
    check('KO: API 우회 가입 시도 → 400 CONSENT_REQUIRED', bypass.status === 400 && (bypassBody?.error?.code === 'CONSENT_REQUIRED' || bypassBody?.code === 'CONSENT_REQUIRED'), `status=${bypass.status}`);

    // ── ④ 정책 문서: 게이트 링크 → 이용약관 (DRAFT 배너 유지) ──
    await ko.getByTestId('consent-link-terms').click();
    await ko.waitForSelector('[data-testid="legal-draft-banner"]', { timeout: 10000 });
    const termsKo = await ko.locator('[data-testid="legal-doc-scroll"]').innerText();
    check('KO: 이용약관 본문 렌더(원문 첫머리)', termsKo.includes('이용약관'));
    check('KO: DRAFT 초안 고지 유지', termsKo.includes('초안') || termsKo.includes('DRAFT'));
    check('KO: [대표님 확정 필요] 플레이스홀더 보존', termsKo.includes('대표님 확정 필요'));
    await ko.screenshot({ path: shot('ko-02-terms-draft'), fullPage: true });
    // 로케일 칩 → en 본문
    await ko.getByTestId('legal-lang-en').click();
    await ko.waitForTimeout(300);
    const termsEn = await ko.locator('[data-testid="legal-doc-scroll"]').innerText();
    check('KO화면: 언어 칩으로 영문 본문 전환', termsEn.includes('Terms of Service') && !termsEn.startsWith('#'));
    // kind 토글 → 개인정보처리방침
    await ko.getByTestId('legal-kind-privacy').click();
    await ko.waitForTimeout(300);
    check('설정 없음 게이트 경로: 처리방침 kind 전환', (await ko.locator('[data-testid="legal-doc-scroll"]').innerText()).includes('Privacy Policy'));
    // 웹 SPA는 브라우저 history와 연동되지 않아 page.goBack() 불가 — 헤더 ✕(testID)로 복귀.
    await ko.getByTestId('legal-back').click();
    await ko.waitForSelector('[data-testid="consent-all-required"]', { timeout: 10000 });

    // ── 가입 완료: 전체 동의 (마케팅은 오프 유지 — opt-in) ──
    await ko.getByTestId('consent-all-required').click();
    const marketingChecked = await ko.locator('[data-testid="consent-marketing"]').evaluate((el) => el.textContent.includes('✓'));
    check('KO: 전체 동의 후에도 마케팅 opt-in(미체크) 유지', !marketingChecked);
    await ko.getByTestId('signup-submit').click();
    await ko.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });

    // ── ② AI 고지: 채팅 상시 배너 ──
    await ko.getByTestId('new-chat-button').click();
    await ko.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    const disclosure = ko.getByTestId('ai-disclosure');
    check('KO: 채팅 상단 AI 고지 배너 노출', (await disclosure.count()) === 1 && (await disclosure.innerText()).includes('AI'));
    await ko.getByTestId('chat-input').fill(`법률 스모크 ${stamp}`);
    await ko.getByTestId('send-button').click();
    await ko.waitForSelector('[data-testid="message-agent"]', { timeout: 40000 });
    await ko.waitForTimeout(800);
    check('KO: 응답 카드 AI 생성 배지', (await ko.getByTestId('ai-generated-badge').count()) >= 1);
    check('KO: 배너는 메시지 적재 후에도 유지(상시 고지)', (await disclosure.count()) === 1);
    await ko.screenshot({ path: shot('ko-03-chat-disclosure'), fullPage: true });

    // ── ⑤ 회원탈퇴: 다이얼로그 → 확인 게이트 → 파기 ──
    await ko.goto(`${APP}`, { waitUntil: 'networkidle' });
    await ko.waitForSelector('[data-testid="settings-button"]', { timeout: 20000 });
    await ko.getByTestId('settings-button').click();
    await ko.waitForSelector('[data-testid="settings-legal-terms"]', { timeout: 10000 });
    await ko.getByTestId('settings-withdraw-button').click();
    await ko.waitForSelector('[data-testid="withdraw-dialog"]', { timeout: 5000 });
    const confirmBtn = ko.getByTestId('withdraw-confirm');
    check('KO: 탈퇴 확인 버튼 — ack 전 비활성', await confirmBtn.evaluate((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.className.includes('disabled')));
    await ko.screenshot({ path: shot('ko-04-withdraw-dialog'), fullPage: true });
    await ko.getByTestId('withdraw-ack').click();
    await confirmBtn.click();
    // 성공 시 WithdrawDialog가 토큰 폐기 + Login 루트로 reset (login-card 노출)
    await ko.waitForSelector('[data-testid="login-card"], [data-testid="login-hint"]', { timeout: 30000 });
    // 파기 read-back: 로그인 화면이 바로 뜨고(리셋) 재로그인 시도는 실패해야 한다 (계정 삭제됨)
    await ko.waitForSelector('[data-testid="login-card"]', { timeout: 30000 });
    await ko.getByTestId('login-email').fill(`legal-${stamp}@myagenttalk.dev`);
    await ko.getByTestId('login-password').fill(`pw-${stamp}`);
    await ko.getByTestId('login-submit').click();
    await ko.waitForSelector('[data-testid="login-error"]', { timeout: 15000 });
    check('KO: 탈퇴 후 재로그인 거부 (데이터 파기)', true);
    await ko.screenshot({ path: shot('ko-05-after-withdraw'), fullPage: true });

    // ════════ EN ════════
    const enCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
    const en = await enCtx.newPage();
    const enErrors = [];
    en.on('pageerror', (e) => enErrors.push(String(e)));

    await openLogin(en, 'en');
    await en.getByTestId('login-email').fill(`legal-en-${stamp}@myagenttalk.dev`);
    await en.getByTestId('login-password').fill(`pw-${stamp}`);
    const enSubmit = en.getByTestId('signup-submit');
    check('EN: 필수 미동의 시 가입 버튼 비활성', await enSubmit.evaluate((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.className.includes('disabled')));
    await en.screenshot({ path: shot('en-01-consent-gate'), fullPage: true });

    await en.getByTestId('consent-link-privacy').click();
    await en.waitForSelector('[data-testid="legal-draft-banner"]', { timeout: 10000 });
    const privacyEn = await en.locator('[data-testid="legal-doc-scroll"]').innerText();
    check('EN: 개인정보처리방침 영문 본문 + DRAFT 고지', privacyEn.includes('Privacy Policy') && privacyEn.includes('DRAFT'));
    await en.screenshot({ path: shot('en-02-privacy-draft'), fullPage: true });
    await en.getByTestId('legal-back').click();
    await en.waitForSelector('[data-testid="consent-all-required"]', { timeout: 10000 });

    await en.getByTestId('consent-all-required').click();
    await en.getByTestId('signup-submit').click();
    await en.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
    await en.getByTestId('new-chat-button').click();
    await en.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    const enDisclosure = en.getByTestId('ai-disclosure');
    check('EN: 채팅 상단 AI 고지 배너 노출', (await enDisclosure.count()) === 1 && (await enDisclosure.innerText()).toLowerCase().includes('ai'));
    await en.screenshot({ path: shot('en-03-chat-disclosure'), fullPage: true });

    // 탈퇴 (EN) — 설정 라우트까지 이동 후 스모크 종료 (실 파기는 KO 플로우에서 검증됨)
    await en.goto(APP, { waitUntil: 'networkidle' });
    await en.getByTestId('settings-button').click();
    await en.waitForSelector('[data-testid="settings-withdraw-button"]', { timeout: 10000 });
    await en.getByTestId('settings-withdraw-button').click();
    await en.waitForSelector('[data-testid="withdraw-dialog"]', { timeout: 5000 });
    check('EN: 탈퇴 다이얼로그 영문 카피', (await en.locator('[data-testid="withdraw-dialog"]').innerText()).includes('Delete account'));
    await en.screenshot({ path: shot('en-04-withdraw-dialog'), fullPage: true });
    await en.getByTestId('withdraw-cancel').click();
    await en.waitForTimeout(400);
    check('EN: 취소 시 세션 유지 (다이얼로그 닫힘)', (await en.getByTestId('withdraw-dialog').count()) === 0);

    const jsErrors = [...koErrors, ...enErrors].filter((e) => !/favicon|ResizeObserver/.test(e));
    check('런타임 JS 오류 없음', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
  } catch (e) {
    failed++;
    console.error('  FATAL', e && e.stack ? e.stack : String(e));
  } finally {
    await browser.close();
  }
  console.log(`\n=== 법률 UI 스모크: ${passed} PASS / ${failed} FAIL ===`);
  process.exit(failed ? 1 : 0);
})();
