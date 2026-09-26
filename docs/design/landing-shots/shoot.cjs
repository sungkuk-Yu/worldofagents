// 랜딩 데모 스크린 3장 촬영 (t_b0579b67)
// demo-shots.html의 .frame-art(390x844)를 2x(780x1688) PNG로 찍어 public/myagenttalk/assets/에 바로 저장.
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'agenttalk-figma', 'node_modules', 'playwright-core'));

const SRC = path.join(__dirname, 'demo-shots.html');
const OUT = '/home/holysky87/worldofagents/public/myagenttalk/assets';
const IDS = ['shot-thread', 'shot-joystick', 'shot-dialog'];

(async () => {
  const exe = process.env.CHROME || '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1300, height: 964 }, deviceScaleFactor: 2 });
  await page.goto('file://' + SRC, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // 웹폰트( Pretendard/Geist) 로딩 대기
  const out = [];
  for (const id of IDS) {
    const loc = page.locator(`#${id}`);
    const box = await loc.boundingBox();
    if (!box) { out.push({ id, status: 'NO-BOX' }); continue; }
    const file = path.join(OUT, `${id}.png`);
    await loc.screenshot({ path: file });
    out.push({ id, box: `${Math.round(box.width)}x${Math.round(box.height)}`, file });
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
