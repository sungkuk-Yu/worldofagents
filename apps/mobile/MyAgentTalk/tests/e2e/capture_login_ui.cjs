// t_865ea744 검증+캡처 — 가입 화면 재설계/동의 라벨/스크롤 점프 수정 (mock 아님, 정적 서빙)
// 실행: python3 -m http.server 8123 --bind 127.0.0.1 -d dist-login-ui (index.html에 window.process shim 필요)
//       node tests/e2e/capture_login_ui.cjs   (OUT_DIR 스크린샷 출력)
// 검증 항목:
//   ① 라벨에 '(필수)' 계열 접미사 잔재 0건 (ko/en, 접근성 라벨 포함)
//   ④ 전체 동의 라벨 = '전체 동의' / 'Agree to all' (괄호 안내 제거)
//      마케팅 행에만 옅은 '(선택)'/'(optional)' 접미사
//   ② 동의 행 minHeight>=44, 게이트 컨테이너 maxWidth<=400, 390px 뷰포트에서 스크린샷
//   ② 모드 전환(로그인↔가입) 후 스크롤 점프 없음 (scrollTop 변화 측정)
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8123';
const OUT = process.env.OUT_DIR || '/home/holysky87/.hermes/profiles/frontdev/cache/scratch/login-ui';
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  for (const lang of ['ko', 'en']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
    const page = await ctx.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    // 백엔드 없음: 세션 목록 API를 401로 처리 → DialogueList가 errors.auth + login-hint 배너 → Login 이동 경로 재현
    await page.route('**/api/**', (route) => route.fulfill({ status: 401, json: { ok: false, error: { code: 'UNAUTHORIZED', message: 'nope' } } }));
    await page.route('**/ws**', (route) => route.abort());
    await page.addInitScript((l) => localStorage.setItem('at-language', l), lang);
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="login-hint"]', { timeout: 20000 });
    await page.getByTestId('login-hint').click();
    await page.waitForSelector('[data-testid="login-card"]', { timeout: 10000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot(`${lang}-login-390`), fullPage: true });

    // 가입 모드로 전환 (동의 게이트 노출)
    await page.getByTestId('auth-mode-toggle').click();
    await page.waitForSelector('[data-testid="consent-all-required"]', { timeout: 10000 });
    await page.waitForTimeout(400);

    // ①④ 라벨 검증 —可見 텍스트 + 접근성 라벨 전체에서 '(필수)' 잔재 0
    // (링크 행 consent-link-* 은 체크박스 아님 → 제외; RN-web은 aria-checked 미노출 → ✓ 텍스트로 판정)
    const ROWS = '[data-testid^="consent-"]:not([data-testid^="consent-link"])';
    const texts = await page.evaluate((sel) => {
      const nodes = [...document.querySelectorAll(sel)];
      return nodes.map((el) => ({ id: el.getAttribute('data-testid'), text: el.textContent, aria: el.getAttribute('aria-label') }));
    }, ROWS);
    const all = texts.map((t) => `${t.text}|${t.aria ?? ''}`).join('\n');
    check(`${lang}: '(필수)' 잔재 0건`, !/\(필수\)|（필수）|\[필수\]|required\)/i.test(all.replace(/\(optional\)|\(선택\)/g, '')));
    const allRow = texts.find((t) => t.id === 'consent-all-required');
    check(`${lang}: 전체 동의 라벨 정리`, lang === 'ko' ? allRow.text.includes('전체 동의') && !allRow.text.includes('14세') : allRow.text.includes('Agree to all') && !/age|Age/.test(allRow.text), JSON.stringify(allRow.text));
    const marketing = texts.find((t) => t.id === 'consent-marketing');
    check(`${lang}: 마케팅 '(선택)' 접미사`, lang === 'ko' ? marketing.text.includes('(선택)') : /\(optional\)/i.test(marketing.text));
    const terms = texts.find((t) => t.id === 'consent-terms');
    check(`${lang}: 약관 행 접미사 없음`, !/\(선택\)|\(optional\)/i.test(terms.text));

    // ② 레이아웃: 동의 행 높이 >= 44, 게이트 컨테이너 maxWidth <= 400
    const metrics = await page.evaluate((sel) => {
      const rowH = [...document.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().height));
      let w = 0; let n = document.querySelector('[data-testid="consent-all-required"]');
      while (n && w === 0) { const mw = getComputedStyle(n.parentElement).maxWidth; n = n.parentElement; if (mw !== 'none') w = parseFloat(mw); }
      return { rowH, gateWidth: w, cardW: document.querySelector('[data-testid="login-card"]').getBoundingClientRect().width, docW: document.documentElement.scrollWidth };
    }, ROWS);
    check(`${lang}: 동의 행 높이 >= 44`, metrics.rowH.every((h) => h >= 44), JSON.stringify(metrics.rowH));
    check(`${lang}: 게이트 maxWidth <= 400`, metrics.gateWidth > 0 && metrics.gateWidth <= 400, String(metrics.gateWidth));
    check(`${lang}: 390px에서 가로 오버플로 없음`, metrics.docW <= 391, `scrollWidth=${metrics.docW}`);

    // ② 스크롤 점프: 게이트는 입력 스택 아래에 삽입되므로 문서 좌표 기준 입력 필드 위치가
    //    모드와 무관하게 고정이어야 한다(구 디자인은 flexGrow+center라 게이트 삽입 시 카드 전체가 재정렬·상단 튐).
    await page.evaluate(() => document.querySelector('[data-testid="login-email"]').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    const docY = () => page.evaluate(() => {
      const el = document.querySelector('[data-testid="login-email"]');
      return Math.round(el.getBoundingClientRect().y + window.scrollY);
    });
    const posBefore = await docY();
    await page.getByTestId('auth-mode-toggle').click(); // → 로그인 (게이트 제거)
    await page.waitForTimeout(400);
    const posLogin = await docY();
    await page.getByTestId('auth-mode-toggle').click(); // → 가입 (게이트 재삽입)
    await page.waitForTimeout(400);
    const posAfter = await docY();
    check(`${lang}: 모드 전환 무관 — 이메일 필드 문서좌표 고정(재정렬 점프 없음)`, posBefore === posLogin && posLogin === posAfter, JSON.stringify({ posBefore, posLogin, posAfter }));

    // 전체동의 토글 동작 보존 + 마케팅 opt-in 독립 확인
    // (RN-web Pressable은 aria-checked 미노출 — ✓ 체크 아이콘 텍스트로 판정)
    await page.getByTestId('consent-all-required').click();
    await page.waitForTimeout(200);
    const afterAll = await page.evaluate(() => {
      const g = (id) => (document.querySelector(`[data-testid="${id}"]`).textContent.includes('✓') ? 'true' : 'false');
      return { terms: g('consent-terms'), marketing: g('consent-marketing'), age: g('consent-age14') };
    });
    check(`${lang}: 전체동의 → 필수+14세 체크, 마케팅 미체크`, afterAll.terms === 'true' && afterAll.age === 'true' && afterAll.marketing === 'false', JSON.stringify(afterAll));
    const submitDisabled = await page.getByTestId('signup-submit').evaluate((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.className.includes('disabled'));
    check(`${lang}: 전체동의 후 가입 버튼 활성`, !submitDisabled);

    // 스크린샷: 게이트 포함 전체
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot(`${lang}-signup-gate-top-390`), fullPage: true });

    // 1440px 데스크톱 — 카드 400px 유지 확인
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
    const dpage = await desk.newPage();
    await dpage.emulateMedia({ reducedMotion: 'reduce' });
    await dpage.route('**/api/**', (route) => route.fulfill({ status: 401, json: { ok: false, error: { code: 'UNAUTHORIZED', message: 'nope' } } }));
    await dpage.route('**/ws**', (route) => route.abort());
    await dpage.addInitScript((l) => localStorage.setItem('at-language', l), lang);
    await dpage.goto(APP, { waitUntil: 'networkidle' });
    await dpage.waitForSelector('[data-testid="login-hint"]', { timeout: 20000 });
    await dpage.getByTestId('login-hint').click();
    await dpage.waitForSelector('[data-testid="login-card"]', { timeout: 10000 });
    await dpage.waitForTimeout(600);
    const cardW = await dpage.evaluate(() => Math.round(document.querySelector('[data-testid="login-card"]').getBoundingClientRect().width));
    check(`${lang}: 데스크톱(1440) 카드 폭 <= 400`, cardW <= 402, String(cardW));
    await dpage.screenshot({ path: shot(`${lang}-login-1440`), fullPage: false });

    check(`${lang}: 페이지 에러 없음`, pageErrors.length === 0, pageErrors.join('; ').slice(0, 160));
    await ctx.close(); await desk.close();
  }
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
