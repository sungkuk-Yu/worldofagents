// i18n 검증 스크린샷 — VoiceHome/ResultCanvas(번들 라우트 변형)/NeuronDashboard, ko/en
// 제품 코드 수정 없음: 서빙본 JS의 initialRouteName만 sed로 변형, 언어는 localStorage.
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/tests/e2e/run_c_fixtures.cjs');
const OUT = process.env.OUT_DIR || '/home/holysky87/.hermes/profiles/frontdev/cache/scratch/i18n-shots/proof';
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const VOICE = 'http://localhost:8112';   // shots-voice (initialRouteName=VoiceHome)
const CANVAS = 'http://localhost:8093';  // shots-canvas (initialRouteName=ResultCanvas)
const MAIN = 'http://localhost:8097';    // dist-i18n-api (DialogueList → Settings → Neuron)
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const errors = [];
  for (const lang of ['ko', 'en']) {
    const open = async (base, waits) => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
      await page.emulateMedia({ reducedMotion: 'reduce' }); // #52 규칙 7: 동작 줄이기 — 스크린 정착
      page.on('pageerror', (e) => errors.push(`${lang} ${base}: ${e}`));
      await installFixtures(page, { wave: true });
      await page.addInitScript((l) => localStorage.setItem('at-language', l), lang);
      await page.goto(base + '/');
      for (const w of waits) await page.getByText(w, { exact: false }).first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(1200); // 슬라이드 애니메이션 정착 (#52 web keyframes 폴백)
      return page;
    };
    const L = {
      ko: { tap: '탭하여 말하기', canvas: '매출표', neuron: '연결 이벤트', nav: '뉴런' },
      en: { tap: 'Tap to talk', canvas: 'Sales sheet', neuron: 'Connection events', nav: 'euron' },
    }[lang];
    let page = await open(VOICE, [L.tap]);
    await page.screenshot({ path: shot(`${lang}-voicehome`) });
    await page.close();
    page = await open(CANVAS, [L.canvas]);
    await page.screenshot({ path: shot(`${lang}-canvas`) });
    await page.close();
    page = await open(MAIN, []);
    await page.getByTestId('settings-button').click();
    await page.getByText(lang === 'ko' ? '언어' : 'Language').first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: shot(`${lang}-settings`) });
    await page.getByText(lang === 'ko' ? '뉴런 대시보드' : 'Neuron dashboard').first().click();
    await page.getByText(L.neuron).first().waitFor({ timeout: 15000 });
    await page.screenshot({ path: shot(`${lang}-neuron`) });
    await page.close();
  }
  await browser.close();
  console.log(errors.length ? 'RUNTIME ERRORS:\n' + errors.join('\n') : 'OK — 런타임 예외 없음');
})();
