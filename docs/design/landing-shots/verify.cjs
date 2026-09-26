// 4개 랜딩 페이지 before/after 검증 스크린 (t_b0579b67)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'agenttalk-figma', 'node_modules', 'playwright-core'));

const ROOT = '/home/holysky87/worldofagents/public';
const OUT = path.join(__dirname, 'verify');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['woa-en', ROOT + '/index.html'],
  ['woa-ko', ROOT + '/ko/index.html'],
  ['mat-ko', ROOT + '/myagenttalk/index.html'],
  ['mat-en', ROOT + '/myagenttalk/en/index.html'],
];

(async () => {
  const exe = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
  const browser = await chromium.launch({ executablePath: exe });
  const results = [];
  for (const [name, file] of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 2600 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await page.goto('file://' + file, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const shot = path.join(OUT, `${name}-full.png`);
    await page.screenshot({ path: shot, fullPage: true });
    const broken = await page.$$eval('img', imgs => imgs.filter(i => !i.complete || i.naturalWidth === 0).map(i => i.getAttribute('src')));
    results.push({ name, shot, brokenImages: broken });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
