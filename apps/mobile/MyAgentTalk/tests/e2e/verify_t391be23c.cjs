// t_391be23c 검증 — 헤더 중앙 정렬 + 카드 수직 중앙 실측
// 실행: APP_URL=http://127.0.0.1:8131 node verify_t391be23c.cjs
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://127.0.0.1:8131';
const OUT = process.env.OUT_DIR || '/home/holysky87/.hermes/profiles/frontdev/cache/scratch/login-ui-t391be23c';
fs.mkdirSync(OUT, { recursive: true });
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const probe = () => {
    const find = (sel, text) => {
      const host = document.querySelector(sel);
      if (!host) return null;
      const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.textContent.trim();
        if (t && (text ? t === text : true)) {
          const r = n.parentElement.getBoundingClientRect();
          const cs = getComputedStyle(n.parentElement);
          return { x: Math.round(r.x), cx: Math.round(r.x + r.width / 2), w: Math.round(r.width),
            align: cs.textAlign, weight: cs.fontWeight, size: cs.fontSize };
        }
      }
      return null;
    };
    const card = document.querySelector('[data-testid="login-card"]').getBoundingClientRect();
    const logo = find('[data-testid="login-card"]', 'MAT');
    const sub = [...document.querySelectorAll('[data-testid="login-card"] *')]
      .filter((e) => e.childElementCount === 0 && /Sign in to your account|계정으로 로그인/.test(e.textContent));
    const subEl = sub.length ? sub[0].getBoundingClientRect() : null;
    const subCs = sub.length ? getComputedStyle(sub[0]) : null;
    return {
      card: { x: Math.round(card.x), cx: Math.round(card.x + card.width / 2), top: Math.round(card.top), bottom: Math.round(card.bottom), w: Math.round(card.width) },
      logo,
      sub: subEl ? { x: Math.round(subEl.x), cx: Math.round(subEl.x + subEl.width / 2), align: subCs.textAlign, weight: subCs.fontWeight, size: subCs.fontSize } : null,
      vw: window.innerWidth, vh: window.innerHeight, scrollH: document.documentElement.scrollHeight,
    };
  };

  for (const [lang, vp] of [['en', { width: 390, height: 844 }], ['ko', { width: 390, height: 844 }], ['en-desktop', { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: lang.startsWith('ko') ? 'ko-KR' : 'en-US' });
    const page = await ctx.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // 백엔드 없이: API 401 → DialogueList login-hint 배너 → 로그인 카드 경로 (capture_login_ui.cjs 동일)
    await page.route('**/api/**', (route) => route.fulfill({ status: 401, json: { ok: false, error: { code: 'UNAUTHORIZED', message: 'nope' } } }));
    await page.route('**/ws**', (route) => route.abort());
    await page.addInitScript((l) => localStorage.setItem('at-language', l), lang.startsWith('ko') ? 'ko' : 'en');
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="login-hint"]', { timeout: 20000 });
    await page.getByTestId('login-hint').click();
    await page.waitForSelector('[data-testid="login-card"]', { timeout: 10000 });
    await page.waitForTimeout(700);
    // ── 로그인 모드 (짧은 카드 → 수직 중앙 기대)
    let m = await page.evaluate(probe);
    const name = (s) => (s === 'en' || s === 'en-desktop') ? 'Sign in to your account or create a new one.' : '계정으로 로그인하거나 새 계정을 만드세요.';
    // MAT는 콘텐츠 폭 텍스트 + flex 래퍼 중앙 배치 → CSS textAlign이 아닌 기하 중심(±2px)으로 판정
    check(`${lang}/login: MAT 기하 중앙(카드 중심 일치)`, m.logo && Math.abs(m.logo.cx - m.card.cx) <= 2, JSON.stringify(m.logo));
    check(`${lang}/login: 서브텍스트 중앙 정렬`, m.sub && m.sub.align === 'center', JSON.stringify(m.sub));
    if (lang !== 'en-desktop') {
      check(`${lang}/login: MAT·서브텍스트 중심 = 카드 중심(±2px)`,
        Math.abs(m.logo.cx - m.card.cx) <= 2 && Math.abs(m.sub.cx - m.card.cx) <= 2,
        JSON.stringify({ logoCx: m.logo.cx, subCx: m.sub.cx, cardCx: m.card.cx }));
      const gapTop = m.card.top, gapBottom = m.vh - m.card.bottom;
      check(`${lang}/login: 카드 수직 중앙(상하 여백 ±24px)`, Math.abs(gapTop - gapBottom) <= 24 && gapTop > 40,
        JSON.stringify({ gapTop, gapBottom }));
      check(`${lang}/login: MAT weight 600(담백화)`, m.logo && m.logo.weight === '600', m.logo && m.logo.weight);
    } else {
      const gapTop = m.card.top, gapBottom = m.vh - m.card.bottom;
      check(`${lang}/login: 데스크톱 카드 수평 중앙+수직 중앙`, Math.abs(m.card.cx - m.vw / 2) <= 2 && Math.abs(gapTop - gapBottom) <= 24,
        JSON.stringify({ cardCx: m.card.cx, gapTop, gapBottom }));
    }
    await page.screenshot({ path: path.join(OUT, `${lang}-login-t391.png`) });
    // ── 가입 모드 (긴 카드 → 상단 sp8 고정 기대)
    await page.getByTestId('auth-mode-toggle').click();
    await page.waitForTimeout(500);
    m = await page.evaluate(probe);
    check(`${lang}/signup: MAT 기하 중앙`, m.logo && Math.abs(m.logo.cx - m.card.cx) <= 2, JSON.stringify(m.logo));
    check(`${lang}/signup: 서브텍스트 중앙 정렬`, m.sub && m.sub.align === 'center', JSON.stringify(m.sub));
    check(`${lang}/signup: 긴 카드 — 상단 여백 ≈32(sp8)이고 뷰포트 위로 시작`, m.card.top >= 24 && m.card.top <= 48, `top=${m.card.top}`);
    await page.screenshot({ path: path.join(OUT, `${lang}-signup-t391.png`), fullPage: m.card.bottom > m.vh });
    await page.close();
  }
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
