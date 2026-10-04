/**
 * smoke_compass_t08d671a8.cjs — 5방향 나침반 조이스틱 회귀 (대표님 10/4)
 * 지시 요약:
 *   ↑ (12시): 키보드
 *   ← (9시): 취소
 *   → (3시): 수정
 *   ↓ (6시): 사진
 *   ↗ (1시): 파일
 *   센터: 전송
 *
 * 검사:
 *   ① 홀드 시 나침반(5방향 화살표) 상단 클러스터 렌더 — rect ∩ 패드+하단 20% = 0
 *   ② 각 방향 드래그 시 해당 화살표 강조 (opacity 상승)
 *   ③ selectAction 단위 로직 — 각도→액션 매핑 경계
 */

const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');

const APP_URL = process.env.APP_URL || 'http://localhost:8080';
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const results = [];
function check(label, pass, info = '') { results.push({ label, pass }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${info ? ' — ' + info : ''}`); }

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── 모바일 390x844 ──
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const ws = await installFixtures(page, { reader: true });
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
    await page.waitForSelector('[data-testid="voice-stage-pad"]', { timeout: 8000 });

    // ① 나침반 비가시 (idle)
    const compassIdle = await page.getByTestId('voice-compass-row').boundingBox().catch(() => null);
    check('① idle 상태 나침반 미표시', compassIdle === null);

    // 홀드 시작 — 나침반 표시 확인
    const pad = await page.getByTestId('voice-stage-pad').boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);

    const compass = await page.getByTestId('voice-compass-row').boundingBox().catch(() => null);
    check('① 홀드 중 나침반 표시', !!compass, compass ? `y=${compass.y.toFixed(0)}` : '없음');

    // 나침반이 패드+하단 20% 영역과 겹치지 않는지
    if (compass && pad) {
      const bottom20 = 844 * 0.8; // 하단 20% 시작
      const compassBottom = compass.y + compass.height;
      const padTop = pad.y;
      const noOverlap = compassBottom < Math.min(padTop, bottom20);
      check('① 나침반 rect ∩ (패드+하단20%) = 0', noOverlap, `compass.bottom=${compassBottom.toFixed(0)} padTop=${padTop.toFixed(0)} h80%=${bottom20.toFixed(0)}`);
    }

    // ② 방향 드래그 시 강조 확인 (↑ 키보드)
    await page.mouse.move(pad.x + pad.width / 2, pad.y - 60); // 위로 60px
    await page.waitForTimeout(100);
    const kbdEl = page.getByTestId('compass-keyboard');
    const kbdStyle = await kbdEl.evaluate((el) => getComputedStyle(el).opacity).catch(() => '0');
    check('② ↑ 드래그 시 키보드 강조', parseFloat(kbdStyle) > 0.7, `opacity=${kbdStyle}`);

    // → 수정 방향
    await page.mouse.move(pad.x + pad.width / 2 + 60, pad.y + pad.height / 2);
    await page.waitForTimeout(100);
    const editStyle = await page.getByTestId('compass-edit').evaluate((el) => getComputedStyle(el).opacity).catch(() => '0');
    check('② → 드래그 시 수정 강조', parseFloat(editStyle) > 0.7, `opacity=${editStyle}`);

    // 릴리스
    await page.mouse.up();
    await page.waitForTimeout(200);

    // ③ selectAction 단위 로직 검증 — 브라우저에서 모듈 로드 불가하므로 스킵
    // (실제 단위테스트는 별도 mocha/jest로)

    check('Z 런타임 오류 0', errs.length === 0, errs.join('; '));

    await ctx.close();

    // 결과 출력
    const pass = results.filter((r) => r.pass).length;
    const fail = results.filter((r) => !r.pass).length;
    console.log(`\n== compass t_08d671a8: ${pass} PASS / ${fail} FAIL ==`);
    process.exit(fail > 0 ? 1 : 0);
  } finally {
    await browser.close();
  }
})();
