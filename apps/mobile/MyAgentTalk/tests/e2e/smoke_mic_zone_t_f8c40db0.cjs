/**
 * t_f8c40db0 (대표님 9/30) — 마이크 인식 zones 회귀 스모크
 * 지시: "하단 부분을 전부 다 마이크 기능으로 하지 말고 가운데 지문인식처럼 동그랗게만 인식 영역을
 *       해주고 나머지는 스크롤 할 수 있도록"
 * 검증:
 *   ① 홀드 히트 = 중앙 지문형 패드(voice-stage-pad, ~96px)만 — 스트립(voice-stage)은 box-none 통과 박스.
 *   ② 스트립 안 원밖 영역(좌/우/패드 위) 위 호일(wheel) 스크롤 = 배후 리스트가 받음(수직 이동 실측).
 *      (수리 전: 스트립이 FlatList 형제 absolute 오버레이라 위 영역 스크롤 신호가 리스트에 도달 불가)
 *   ③ 원밖 포인트 롱드래그 = 링 미발동·audio.* 미전송(홀드 오인 금지).
 *   ④ 패드 중앙 홀드 = 링 발동(정상 경로 유지) + audio.start→end.
 * 실행: (정적서버) node tests/e2e/fr-serve.cjs dist-<본빌드> 8263
 *       APP_URL=http://localhost:8263 node tests/e2e/smoke_mic_zone_t_f8c40db0.cjs
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8263';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'mic-zone-t_f8c40db0');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const state = await installFixtures(page, { reader: true }); // 긴 히스토리(4행, 1화면 초과) — 스크롤 가능 상태
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
    await page.getByTestId('message-list').waitFor({ timeout: 8000 });

    const strip = await page.getByTestId('voice-stage').boundingBox();
    const pad = await page.getByTestId('voice-stage-pad').boundingBox();
    check('① 패드 렌더 — 지문형 원 ~96px', !!pad && Math.abs(pad.width - 96) <= 2, pad ? `${pad.width}x${pad.height}` : '없음');
    check('① 패드 = 스트립 중앙(30% 스트립 안)', !!pad
      && Math.abs((pad.x + pad.width / 2) - (strip.x + strip.width / 2)) <= 2
      && Math.abs((pad.y + pad.height / 2) - (strip.y + strip.height / 2)) <= 2);
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return { pad: !!(el && el.closest('[data-testid="voice-stage-pad"]')), stage: !!(el && el.closest('[data-testid="voice-stage"]')) };
    }, [strip.x + 30, strip.y + strip.height / 2]);
    check('① 원 밖 스트립 지점 = 스트립 히트 0(터치 통과)', !hit.stage && !hit.pad, JSON.stringify(hit));

    // ② 스트립 위(원 밖) wheel = 배후 리스트 수직 이동 실측 — 지시 '나머지는 스크롤' 핵심 회귀.
    const scrollerTop = () => page.evaluate(() => {
      const l = document.querySelector('[data-testid="message-list"]');
      return l ? Math.round(l.scrollTop) : -1;
    });
    const room = await page.evaluate(() => {
      const l = document.querySelector('[data-testid="message-list"]');
      return l ? l.scrollHeight - l.clientHeight : 0;
    });
    check('② 테스트 전제: 리스트 스크롤 가능(짧은 히스토리 아님)', room > 100, `room=${room}px`);
    await page.mouse.move(strip.x + 30, strip.y + strip.height / 2);
    const before = await scrollerTop();
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(500);
    const after = await scrollerTop();
    check('② 스트립 원 밖 wheel 스크롤 = 리스트 이동(홀드 존이 가로채지 않음)', before >= 0 && after < before, `before=${before} after=${after}`);
    await page.screenshot({ path: path.join(OUT, '02-scroll-through-strip.png') });

    // ③ 원 밖 포인트 롱드래그 = 링 미발동 + audio.* 미전송 (홀드 오인 금지 — 지시 '나머지는 스크롤'의 홀드 측)
    await page.mouse.move(strip.x + 30, strip.y + strip.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(strip.x + 30, strip.y + strip.height / 2 + i * 15); await page.waitForTimeout(30); }
    await page.waitForTimeout(350);
    check('③ 원 밖 롱드래그 = 링 미발동', (await page.getByTestId('voice-stage-ring').count()) === 0);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const types3 = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('③ 원 밖 드래그 후 audio.* 미전송(부정 홀드 0)', !types3.includes('audio.start'), types3.join(','));

    // ④ 패드 중앙 홀드 = 정상 링 발동 + start→end (기능 보존 회귀)
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    check('④ 패드 홀드 = 링 발동', (await page.getByTestId('voice-stage-ring').count()) === 1);
    await page.screenshot({ path: path.join(OUT, '04-pad-hold-ring.png') });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const types4 = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('④ 패드 홀드-릴리스 = audio.start→audio.end', types4.includes('audio.start') && types4.includes('audio.end'), types4.join(','));
    check('Z 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));
    await page.close();
  } finally {
    await browser.close();
    console.log(`\nRESULT mic-zone: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
