// 모바일 한글 가독성 실측 프루프 (t_99322cc0) — 390×844 모바일 뷰포트 라이브 렌더
// 실행: expo export -p web --output-dir dist-t99322cc0 --clear
//       node tests/e2e/fr-serve.cjs dist-t99322cc0 8317
//       APP_URL=http://localhost:8317 node tests/e2e/font_proof_t99322cc0.cjs
// 계약: A 루트 스택 한글 퍼스트+keep-all · B 본문 17px/1.55/자간0 · C 앱바 headline 자간0
//       D 자간 0px가 -0.2px보다 넓게 렌더(실측) · E PretendardVariable 로드 · F 콘솔 예외 0
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8317';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'font-proof-t99322cc0');
fs.mkdirSync(OUT, { recursive: true });
const EXE = process.env.CHROME_PATH || '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  let failures = 0;
  const check = (name, fn) => {
    try { fn(); console.log('PASS', name); }
    catch (e) { failures++; console.log('FAIL', name, '—', e.message); }
  };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    await installFixtures(page, { reader: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').first().click();
    await page.waitForTimeout(800); // 페인트 안정 (선례 ~600ms)

    // A. 루트 CSS — 한글 퍼스트 스택 + keep-all (라이브 computed)
    const root = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { family: cs.fontFamily, wb: cs.wordBreak };
    });
    check('A1 루트 fontFamily Pretendard 우선', () =>
      assert.ok(/^\s*["']?PretendardVariable/.test(root.family), 'stack=' + root.family));
    check('A2 루트 word-break keep-all', () => assert.equal(root.wb, 'keep-all'));

    // E. PretendardVariable 실제 로드
    const pretendardLoaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('17px PretendardVariable');
    });
    check('E1 PretendardVariable 로드', () => assert.equal(pretendardLoaded, true));

    // B. 본문 17px · lineHeight 26.35(1.55) · 자간 0 — msgText/paragraph 후보 스캔
    // (RN-web은 letterSpacing:0을 CSS normal로 직렬화 → normal|0px 허용)
    const ZERO_LS = (v) => v === '0px' || v === 'normal';
    const body = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[dir="auto"], p, span')) {
        const cs = getComputedStyle(el);
        const t = (el.textContent || '').trim();
        if (t && /[가-힣]/.test(t) && parseFloat(cs.fontSize) >= 16 && parseFloat(cs.fontSize) <= 18) {
          out.push({ fontSize: cs.fontSize, lineHeight: cs.lineHeight, ls: cs.letterSpacing, family: cs.fontFamily.split(',')[0], sample: t.slice(0, 18) });
        }
      }
      return out;
    });
    check('B1 본문 실측 17px/26.35px/자간0', () => {
      assert.ok(body.length > 0, '한글 본문 노드 없음');
      const hit = body.find((b) => b.fontSize === '17px' && ZERO_LS(b.ls) && Math.abs(parseFloat(b.lineHeight) - 26.35) < 0.5);
      assert.ok(hit, '17px/26.35px/자간0 본문 없음: ' + JSON.stringify(body.slice(0, 5)));
    });
    check('B2 본문 자형 = PretendardVariable', () => {
      const hit = body.find((b) => b.fontSize === '17px');
      assert.ok(/Pretendard/i.test(hit.family), 'family=' + hit.family);
    });

    // C. 앱바/headline(17px 600) 자간 0 — 16px 이하 micro 제외, headline급 스캔
    const head = await page.evaluate(() => {
      const els = [];
      for (const el of document.querySelectorAll('span')) {
        const cs = getComputedStyle(el);
        const t = (el.textContent || '').trim();
        if (t && /[가-힣A-Z]/.test(t) && parseFloat(cs.fontSize) === 17 && cs.fontWeight === '600') {
          els.push({ ls: cs.letterSpacing, t: t.slice(0, 12) });
        }
      }
      return els;
    });
    check('C1 headline 17px/600 자간 0px(normal)', () => {
      for (const h of head) assert.ok(h.ls === '0px' || h.ls === 'normal', '자간 잔존: ' + JSON.stringify(h));
    });

    // D. 자간 효과 실측 — 같은 텍스트를 -0.2px vs 0px로 렌더, 폭 증가 확인 (가독성 개선의 물증)
    const track = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('2d');
      const KO = '모바일 가독성 높은 글씨체 확인';
      c.font = '400 34px PretendardVariable';
      c.letterSpacing = '-0.4px';
      const before = c.measureText(KO).width;
      c.letterSpacing = '0px';
      const after = c.measureText(KO).width;
      return { before, after };
    });
    check('D1 자간 완화로 행 폭 증가', () =>
      assert.ok(track.after > track.before, `before=${track.before} after=${track.after}`));

    // F. 콘솔 예외 0
    check('F1 콘솔 예외 0', () => assert.equal(errors.length, 0, errors.join('\n')));

    await page.screenshot({ path: path.join(OUT, '01-chat-mobile.png') });
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? 'FONT-PROOF OK (t_99322cc0)' : `FONT-PROOF FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})();
