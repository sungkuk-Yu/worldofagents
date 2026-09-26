// reveal 가시성 진단: force-prefers-reduced-motion 적용 여부 + pricing 섹션 opacity 확인
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'agenttalk-figma', 'node_modules', 'playwright-core'));

(async () => {
  const exe = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
  const browser = await chromium.launch({ executablePath: exe, args: ['--force-prefers-reduced-motion'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  await page.goto('file:///home/holysky87/worldofagents/public/myagenttalk/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = document.querySelector('#pricing h2');
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { reducedMotion: rm, pricingOpacity: cs.opacity, pricingTop: Math.round(rect.top + scrollY), docHeight: document.body.scrollHeight };
  });
  console.log(JSON.stringify(info));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
