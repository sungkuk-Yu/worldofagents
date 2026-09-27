// t_6978cba4 (t_865ea744 정정) 검증+캡처 — 가입 화면 '(필수)' 라벨 원복 + 플로팅 라벨 겹침 확인
// 실행: python3 -m http.server 8123 --bind 127.0.0.1 -d dist-t6978cba4 (index.html에 window.process shim 필요)
//       node tests/e2e/capture_login_ui.cjs   (OUT_DIR 스크린샷 출력)
// 검증 항목:
//   ① 5개 필수 행 라벨에 '(필수)'/(Required) 노출 + 마케팅 행 '(선택)'/(optional) (t_6978cba4 원복)
//   ④ 전체 동의 라벨 = '전체 동의' / 'Agree to all' (t_cac6f531: '(선택 포함)' 문구 제거 — 전체동의가 마케팅까지 6종 일괄 토글)
//   ②b 이메일/비밀번호 플로팅 라벨이 입력값/플레이스홀더와 한 자리에 겹치지 않음
//      (라벨 승격 확인 + 텍스트 rect 교차 높이 <=8px — 대표님 슬브 실증 버그 회귀 방지)
//   ② 동의 행 minHeight>=44, 게이트 컨테이너 maxWidth<=400, 390px 뷰포트에서 스크린샷
//   ② 모드 전환(로그인↔가입) 후 스크롤 점프 없음 (필드 문서좌표 고정 측정)
// 포트 triple: 정적 서빙 8123 (백엔드 없이 API 401 mock 라우팅) — 실 백엔드 필요 시 API+CORS 3021 일치 확인 (t_865ea744 사고#1 재발방지)
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8123';
const OUT = process.env.OUT_DIR || '/home/holysky87/.hermes/profiles/frontdev/cache/scratch/login-ui-t6978cba4';
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

// ②b 플로팅 라벨 겹침 판정 — RN-paper outlined TextInput(웹)에서 testID는 input 자체에 붙고
// 필드 래퍼(absolute 라벨 포함)는 input.parentElement. 래퍼 기준 라벨 텍스트 rect와
// 입력값 텍스트 rect의 교차 높이를 잰다. 승격된 라벨은 아웃라인 notch 위(h=18, top < input top)에
// 안착하므로 정상 상태 교차 <=8px; 버그(라벨이 값과 한 자리 겹침)라면 교차 >8px.
const OVERLAP_PROBE = (spec) => {
  const out = [];
  for (const { testId, labelText, value } of spec) {
    const input = document.querySelector(`input[data-testid="${testId}"]`);
    const box = input ? input.parentElement : null;
    if (!box) { out.push({ testId, ok: false, why: 'field missing' }); continue; }
    const boxRect = box.getBoundingClientRect();
    const inpRect = input.getBoundingClientRect();
    const findTextRect = (pred) => {
      const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.textContent.trim();
        if (t && pred(t)) {
          const r = document.createRange(); r.selectNodeContents(n);
          const b = r.getBoundingClientRect();
          if (b.width > 1) return b;
        }
      }
      return null;
    };
    const lRect = findTextRect((t) => t === labelText);
    // 입력값은 <input>의 value 프로퍼티(텍스트 노드 아님) — 승격 라벨(lRect.top < input.top)과
    // 입력 텍스트가 렌더되는 content rect의 수직 교차만 잰다.
    const valueShown = !value || input.value.includes(value);
    let cross = -1;
    if (lRect) {
      const o = inpRect;
      cross = Math.max(0, Math.min(lRect.bottom, o.bottom) - Math.max(lRect.top, o.top));
    }
    out.push({
      testId,
      labelShown: !!lRect, valueShown,
      labelAboveInput: lRect ? lRect.top < inpRect.top : null, // 승격 = 라벨 상단이 입력 라인보다 위
      cross: Math.round(cross),
    });
  }
  return out;
};
async function overlapChecks(page, lang, tag) {
  const labels = lang === 'ko' ? { email: '이메일', pw: '비밀번호' } : { email: 'Email', pw: 'Password' };
  const typed = [
    { testId: 'login-email', labelText: labels.email, value: 'probe@example.com' },
    { testId: 'login-password', labelText: labels.pw, value: null }, // secure 입력은 DOM 값 마스킹 → 승격+미겹침만 판정
  ];
  for (const item of await page.evaluate(OVERLAP_PROBE, typed)) {
    check(`${lang}/${tag}: ${item.testId} 라벨 승격+입력값과 미겹침`, item.labelShown === true && item.labelAboveInput === true && (item.cross === -1 || item.cross <= 8), JSON.stringify(item));
  }
  const emailProbe = (await page.evaluate(OVERLAP_PROBE, [{ testId: 'login-email', labelText: labels.email, value: 'probe@example.com' }]))[0];
  check(`${lang}/${tag}: 이메일 입력값 렌더 확인(라벨과 분리)`, emailProbe.valueShown === true, JSON.stringify(emailProbe));
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

    // ②b 로그인 모드에서 입력 충전 후 라벨 겹침 확인 (대표님 슬브 실증 시나리오)
    await page.fill('input[data-testid="login-email"]', 'probe@example.com');
    await page.fill('input[data-testid="login-password"]', 'ProbePass1!');
    await page.waitForTimeout(400);
    await overlapChecks(page, lang, 'login390');
    await page.screenshot({ path: shot(`${lang}-login-filled-390`), fullPage: true });

    // 가입 모드로 전환 (동의 게이트 노출)
    await page.getByTestId('auth-mode-toggle').click();
    await page.waitForSelector('[data-testid="consent-all-required"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await overlapChecks(page, lang, 'signup390');

    // ①④ 라벨 검증 (t_6978cba4 원복): 5개 필수 행 '(필수)'/(Required), 마케팅 '(선택)'/(optional)
    // (링크 행 consent-link-* 은 체크박스 아님 → 제외; RN-web은 aria-checked 미노출 → ✓ 텍스트로 판정)
    const ROWS = '[data-testid^="consent-"]:not([data-testid^="consent-link"])';
    const texts = await page.evaluate((sel) => {
      const nodes = [...document.querySelectorAll(sel)];
      return nodes.map((el) => ({ id: el.getAttribute('data-testid'), text: el.textContent, aria: el.getAttribute('aria-label') }));
    }, ROWS);
    const reqPat = lang === 'ko' ? /\(필수\)|（필수）/ : /\(Required\)/i;
    for (const [row, name] of [['consent-terms', '약관'], ['consent-privacy', '개인정보'], ['consent-voice', '음성'], ['consent-overseas', '국외이전'], ['consent-age14', '14세']]) {
      const hit = texts.find((t) => t.id === row);
      check(`${lang}: ${name} 행 '(필수)' 명시`, !!hit && reqPat.test(hit.text) && reqPat.test(hit.aria || hit.text), JSON.stringify(hit && hit.text));
    }
    const allRow = texts.find((t) => t.id === 'consent-all-required');
    check(`${lang}: 전체 동의 라벨 '전체 동의' (선택 포함 문구 제거)`, lang === 'ko' ? allRow.text.trim() === '전체 동의' : /^agree to all$/i.test(allRow.text.trim()), JSON.stringify(allRow.text));
    const marketing = texts.find((t) => t.id === 'consent-marketing');
    check(`${lang}: 마케팅 '(선택)' 접미사`, lang === 'ko' ? marketing.text.includes('(선택)') : /\(optional\)/i.test(marketing.text));
    check(`${lang}: 마케팅 행에 '(필수)' 없음`, !reqPat.test(marketing.text));

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

    // ② 스크롤 안정성 (t_391be23c 개정): 카드 실측 기반 수직 중앙 → 모드 전환 시 필드가
    //    이동하는 것은 의도된 재중앙. 대신 (a) 같은 모드 좌표는 전환 반복에도 흔들림 없고,
    //    (b) 각 모드에서 이메일 필드가 스크롤 없이 뷰포트 안에 보여야 한다.
    const docY = () => page.evaluate(() => {
      const el = document.querySelector('[data-testid="login-email"]');
      const r = el.getBoundingClientRect();
      return { doc: Math.round(r.y + window.scrollY), inView: r.top > 0 && r.bottom < window.innerHeight };
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    const posBefore = await docY();
    check(`${lang}: 가입 모드 — 이메일 필드 스크롤 없이 노출`, posBefore.inView, JSON.stringify(posBefore));
    await page.getByTestId('auth-mode-toggle').click(); // → 로그인 (게이트 제거)
    await page.waitForTimeout(400);
    const posLogin = await docY();
    check(`${lang}: 로그인 모드 — 이메일 필드 스크롤 없이 노출`, posLogin.inView, JSON.stringify(posLogin));
    await page.getByTestId('auth-mode-toggle').click(); // → 가입 (게이트 재삽입)
    await page.waitForTimeout(400);
    const posAfter = await docY();
    check(`${lang}: 가입 모드 좌표 전환 반복 불변(드리프트 없음)`, posBefore.doc === posAfter.doc, JSON.stringify({ before: posBefore.doc, after: posAfter.doc }));

    // 전체동의 토글 = 6종 일괄 체크 (t_cac6f531) — 마케팅 포함, 개별 해제는 그 아래 행 탭으로 가능
    // (RN-web Pressable은 aria-checked 미노출 — ✓ 체크 아이콘 텍스트로 판정)
    await page.getByTestId('consent-all-required').click();
    await page.waitForTimeout(200);
    const afterAll = await page.evaluate(() => {
      const g = (id) => (document.querySelector(`[data-testid="${id}"]`).textContent.includes('✓') ? 'true' : 'false');
      return { terms: g('consent-terms'), marketing: g('consent-marketing'), age: g('consent-age14') };
    });
    check(`${lang}: 전체동의 → 6종 일괄 체크(마케팅 포함)`, afterAll.terms === 'true' && afterAll.age === 'true' && afterAll.marketing === 'true', JSON.stringify(afterAll));
    await page.getByTestId('consent-marketing').click();
    await page.waitForTimeout(200);
    const afterIndiv = await page.evaluate(() => {
      const g = (id) => (document.querySelector(`[data-testid="${id}"]`).textContent.includes('✓') ? 'true' : 'false');
      return { terms: g('consent-terms'), marketing: g('consent-marketing'), age: g('consent-age14') };
    });
    check(`${lang}: 마케팅 개별 해제 가능(필수 유지)`, afterIndiv.marketing === 'false' && afterIndiv.terms === 'true' && afterIndiv.age === 'true', JSON.stringify(afterIndiv));
    await page.getByTestId('consent-marketing').click(); // 복원 → 전체동의 블록 체크 상태로
    await page.waitForTimeout(200);
    const submitDisabled = await page.getByTestId('signup-submit').evaluate((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.className.includes('disabled'));
    check(`${lang}: 전체동의 후 가입 버튼 활성`, !submitDisabled);

    // 스크린샷: 게이트 포함 전체
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot(`${lang}-signup-gate-top-390`), fullPage: true });

    // 1440px 데스크톱 — 카드 400px 유지 + 라벨 겹침 재확인
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
    await dpage.fill('input[data-testid="login-email"]', 'probe@example.com');
    await dpage.fill('input[data-testid="login-password"]', 'ProbePass1!');
    await dpage.waitForTimeout(400);
    await overlapChecks(dpage, lang, 'login1440');
    const cardW = await dpage.evaluate(() => Math.round(document.querySelector('[data-testid="login-card"]').getBoundingClientRect().width));
    check(`${lang}: 데스크톱(1440) 카드 폭 <= 400`, cardW <= 402, String(cardW));
    await dpage.screenshot({ path: shot(`${lang}-login-filled-1440`), fullPage: false });

    check(`${lang}: 페이지 에러 없음`, pageErrors.length === 0, pageErrors.join('; ').slice(0, 160));
    await ctx.close(); await desk.close();
  }
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
