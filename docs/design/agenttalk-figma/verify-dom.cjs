// DOM 메트릭 검증 — 프레임 정확도, 가로 오버플로우, 깨진 아이콘/이미지, JS 에러
const { chromium } = require('playwright-core');
const path = require('path');

const ROOT = '/home/holysky87/worldofagents/docs/design/agenttalk-figma';
const exe = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

(async () => {
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1900, height: 1200 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERROR: ' + m.text()); });
  await page.goto('file://' + path.join(ROOT, 'agenttalk-design-system.html'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const metrics = await page.evaluate(() => {
    const out = { frames: [], issues: [] };
    // 1) 프레임 바운딩 정확도
    document.querySelectorAll('figure.frame').forEach(el => {
      const art = el.querySelector('.frame-art');
      if (!art) return;
      const r = art.getBoundingClientRect();
      const label = { w: parseInt(art.style.width) || 0, h: parseInt(art.style.height) || 0 };
      // wide/tablet/desktop은 style width 없이 클래스 기반 → CSS 계산값 사용
      const expected = art.classList.contains('wide') ? null : { w: 390, h: 844 };
      out.frames.push({
        id: el.id,
        label: (el.querySelector('.frame-label b')?.textContent || el.id).trim(),
        w: Math.round(r.width), h: Math.round(r.height),
        expected: expected ? `${expected.w}×${expected.h}` : 'auto(wide)',
        missing: !art.querySelector('.frame-art-inner') && !art.children.length ? 'EMPTY-ART' : null
      });
      if (expected && (Math.abs(r.width - expected.w) > 2 || Math.abs(r.height - expected.h) > 2)) {
        out.issues.push(`SIZE-MISMATCH ${el.id}: ${Math.round(r.width)}×${Math.round(r.height)} != ${expected.w}×${expected.h}`);
      }
    });
    // 2) 가로 오버플로우 (전역)
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    if (docW > winW + 2) out.issues.push(`H-OVERFLOW: doc ${docW} > viewport ${winW}`);
    // 개별 프레임 아트 내부 가로 오버플로우
    document.querySelectorAll('.frame-art').forEach(art => {
      const artR = art.getBoundingClientRect();
      const kids = Array.from(art.children);
      kids.forEach(k => {
        const kr = k.getBoundingClientRect();
        if (kr.right > artR.right + 2) out.issues.push(`ART-H-OVERFLOW ${art.closest('figure').id}: ${k.className} right=${Math.round(kr.right)} > art right=${Math.round(artR.right)}`);
      });
    });
    // 3) 깨진 이미지 / SVG use
    let brokenImg = 0;
    document.querySelectorAll('img').forEach(img => { if (img.complete && img.naturalWidth === 0) brokenImg++; });
    if (brokenImg) out.issues.push(`BROKEN-IMG: ${brokenImg}`);
    const brokenUse = Array.from(document.querySelectorAll('use')).filter(u => !u.href.baseVal).length;
    if (brokenUse) out.issues.push(`BROKEN-USE(href empty): ${brokenUse}`);
    // 4) 토큰 색상 렌더 sanity
    const bg = getComputedStyle(document.querySelector('.frame-art')).backgroundColor;
    const csv = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    out.cssBgVar = csv; out.frameBg = bg;
    out.frameCount = document.querySelectorAll('figure.frame').length;
    out.iconSymbolCount = document.querySelectorAll('svg symbol').length;
    return out;
  });
  await browser.close();

  console.log(JSON.stringify({ ...metrics, jsErrors: errors }, null, 2));
  const isBad = errors.length || metrics.issues.length;
  process.exit(isBad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });