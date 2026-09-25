// 프레임별 PNG 캡처 + 아이콘 심볼 SVG 추출 (Figma import용)
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FRAMES_DIR = path.join(ROOT, 'frames');
fs.mkdirSync(path.join(FRAMES_DIR, 'icons'), { recursive: true });

(async () => {
  const exe = process.env.CHROME || '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1900, height: 1200 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(ROOT, 'agenttalk-design-system.html'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const frames = await page.$$eval('figure.frame', els => els.map(e => ({ id: e.id, name: (e.querySelector('.frame-label b')?.textContent || e.id).trim() })));
  console.log('Frames found:', frames.length);

  const results = [];
  for (const f of frames) {
    const loc = page.locator(`#${f.id} .frame-art`);
    const file = path.join(FRAMES_DIR, `${f.id}.png`);
    const box = await loc.boundingBox();
    if (!box) { results.push({ id: f.id, status: 'NO-BOX' }); continue; }
    await loc.screenshot({ path: file });
    const st = fs.statSync(file);
    results.push({ id: f.id, name: f.name, w: Math.round(box.width), h: Math.round(box.height), kb: Math.round(st.size / 1024) });
  }

  // 아이콘 심볼 → 개별 SVG (벡터, Figma 드래그 임포트 가능)
  const symbols = await page.$$eval('svg[style*="display:none"] symbol', syms =>
    syms.map(s => ({ id: s.id, inner: s.innerHTML, vb: s.getAttribute('viewBox') }))
  );
  let icons = 0;
  for (const s of symbols) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${s.vb || '0 0 24 24'}" width="24" height="24" fill="none" stroke="currentColor">${s.inner}</svg>`;
    fs.writeFileSync(path.join(FRAMES_DIR, 'icons', `${s.id}.svg`), svg);
    icons++;
  }

  await browser.close();
  console.log(JSON.stringify({ results, icons }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });