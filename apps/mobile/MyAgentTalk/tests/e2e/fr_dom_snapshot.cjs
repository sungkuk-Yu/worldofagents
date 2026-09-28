// fr_dom_snapshot.cjs — ChatScreen DOM 불변성 스냅샷 (t_70cbbd6b 리팩토링 전/후 비교)
// 사용: node tests/e2e/fr_dom_snapshot.cjs <out.json> [viewportW] [viewportH]
// 대상: run_c_fixtures 인터셉트 데모 세션 (백엔드 불필요) — testID 목록 + 클래스 시그니처 + 텍스트 수집
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8099';
const OUT = process.argv[2] || path.join(__dirname, 'artifacts', 'fr-dom', 'snapshot.json');
const VW = Number(process.argv[3] || 390);
const VH = Number(process.argv[4] || 844);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, locale: 'ko-KR', reducedMotion: 'reduce' });
  installFixtures(page, { rich: true, chief: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').first().click();
  await page.getByTestId('message-list').waitFor({ timeout: 8000 });
  await page.waitForTimeout(600);
  const dump = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid')).sort();
    const cards = Array.from(document.querySelectorAll('[data-testid^="card"]')).map((el) => ({
      id: el.getAttribute('data-testid'),
      cls: el.getAttribute('class'),
      text: (el.textContent || '').slice(0, 80),
      rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; })(),
    }));
    const appbar = document.querySelector('[data-testid="chat-appbar"]');
    return {
      ids,
      cards,
      appbarCls: appbar && appbar.getAttribute('class'),
      appbarText: appbar && (appbar.textContent || '').slice(0, 120),
      bodyText: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 2000),
    };
  });
  fs.writeFileSync(OUT, JSON.stringify(dump, null, 1));
  console.log('wrote', OUT, 'testids=', dump.ids.length, 'cards=', dump.cards.length);
  await browser.close();
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
