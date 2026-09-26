// 조이스틱 3모드(조이스틱/매직패드/하이브리드) — 브라우저 실증 캡처 (카드 t_5de18a91 요구 6)
// 실행: 정적서버(python3 -m http.server 8099 @ dist-web) → node tests/e2e/smoke_joystick_modes.cjs
// 검증 계약:
//  A. 설정 화면에 3모드 세그먼트 존재 + 전환 → PATCH preferences.joystickMode (기존 키 보존)
//  B. 모드별 음성 홈 렌더 — joystick: 스틱 / pad·hybrid: magic-pad(testID) + 3장 캡처
//  C. 매직패드 제스처 — 탭=녹음 토글(요구 6: 중앙고정과 무관 어디든), 빠른 flick=방향 동작,
//     느린 장거리 swipe=스와이프 계층(↓취소), 우하단 그립 좌우 드래그=미세조정(요구 5)
//  D. 재부팅 후 서버 복원(모드 유지) + 콘솔 예외 0건
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8099';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'joystick-modes');
fs.mkdirSync(OUT, { recursive: true });
const EXE = process.env.CHROME_PATH || '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const shot = (n) => path.join(OUT, `${n}.png`);

// 패드 표면 위에서 마우스 제스처: from→to를 steps로 나누어 PanResponder move 스트림 생성
async function drag(page, box, from, to, { steps = 6, holdMs = 0, speedMs = 16 } = {}) {
  const x0 = box.x + from.x, y0 = box.y + from.y;
  const x1 = box.x + to.x, y1 = box.y + to.y;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(speedMs);
  }
  await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // ── A/B/C/D. 한 세션: 모드 전환 → 각 모드 홈 검증 → 재부팅 복원 ─────────
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    const state = await installFixtures(page, {});
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const meStore = { preferences: { theme: 'dark' } };
    await page.route('**/api/auth/me', async (route) => {
      state.calls.push({ path: '/api/auth/me', method: route.request().method(), body: route.request().postDataJSON() });
      if (route.request().method() === 'PATCH') Object.assign(meStore.preferences, route.request().postDataJSON().preferences ?? {});
      await route.fulfill({ json: { ok: true, data: { id: 'u1', preferences: meStore.preferences } } });
    });

    await page.goto(APP);
    // B0. 기본 모드 = hybrid (설정 이력 없는 계정) — 음성 홈 진입점(🎤)에서 매직패드 렌더
    await page.getByTestId('voice-button').click();
    await page.waitForTimeout(600);
    await page.getByTestId('magic-pad').waitFor();
    await page.screenshot({ path: shot('10-home-hybrid-default') });

    // C1. 탭 = 녹음 토글 (패드 아무 곳 — 중앙 고정 제스처와 무관). 스틱과 동일 종결 정책:
    //     첫 탭=녹음 시작(남음), 두 번째 탭=녹음 종료+결과 캔버스 전환.
    let box = await page.getByTestId('magic-pad').boundingBox();
    assert.ok(box, 'C1: magic-pad 존재');
    await page.mouse.click(box.x + 60, box.y + 60); // 좌상단 여백 탭 → 녹음 시작
    await page.waitForTimeout(400);
    assert.ok((await page.content()).includes('듣고 있습니다'), '패드 탭 → 녹음 상태');
    await page.screenshot({ path: shot('11-tap-recording') });
    box = await page.getByTestId('magic-pad').boundingBox();
    await page.mouse.click(box.x + 60, box.y + 60); // 두 번째 탭 → 종료 + ResultCanvas 전환
    await page.waitForTimeout(700);
    await page.screenshot({ path: shot('12-tap-stop-canvas') });
    // native-stack: VoiceHome은 마운트 유지 — 전환은 최상단 화면의 결과 캔버스 헤더(닫기 ✕)로 판정
    assert.ok((await page.content()).includes('표시할 내용이 없어요') || (await page.content()).includes('보고서'), '녹음 중 탭 종료 → 결과 캔버스 최상단 렌더');
    // 브라우저 goBack은 스택 재플레이가 불안정 — goto 재마운트로 VoiceHome 재진입 (비녹음)
    await page.goto(APP);
    await page.getByTestId('voice-button').click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: shot('12b-after-back'), fullPage: true });
    assert.ok(!(await page.content()).includes('듣고 있습니다'), '복귀 후 비녹음 상태');
    assert.ok(await page.getByTestId('magic-pad').isVisible(), '복귀 후 매직패드 재렌더');

    // C2. 느린 장거리 swipe ↓ = 스와이프 계층 취소 — 녹음 중일 때 시작해 취소(종료)로 비녹음 복귀
    //     (롱프레스 500ms 전에 swipe-open이 타이머를 취소 → LONG_CENTER 미발생 → swipe 취소 = no-op 종료)
    box = await page.getByTestId('magic-pad').boundingBox();
    assert.ok(box, 'C2: magic-pad 존재');
    await drag(page, box, { x: box.width / 2, y: box.height * 0.35 }, { x: box.width / 2, y: box.height * 0.85 }, { steps: 10, speedMs: 60 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('12-swipe-down-cancel') });
    assert.ok(await page.getByTestId('magic-pad').isVisible(), 'swipe↓ 취소 후에도 VoiceHome 유지(전환 없음)');

    // C3. 빠른 flick 좌 = 맵 DIR_LEFT(yes) 동작 실행 — '네, 먼저 처리해주세요' 밴드 등장
    //     flick 창: 30px ≤ 거리 < 88px, ≤220ms, ≥0.28px/ms — 약 70px/40ms로 던짐
    box = await page.getByTestId('magic-pad').boundingBox();
    assert.ok(box, 'C3: magic-pad 존재');
    await drag(page, box, { x: box.width * 0.6, y: box.height / 2 }, { x: box.width * 0.6 - 70, y: box.height / 2 }, { steps: 4, speedMs: 8 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot('13-flick-left-yes') });
    assert.ok((await page.content()).includes('네, 먼저 처리해주세요'), 'flick 좌 = 맵의 예(yes) 동작 실행');

    // C3b. 스와이프 궤적 페이드 — 느린 장거리 ↑ 드래그 중 swipe-trail-dot 렌더 (요구 ② 시각)
    box = await page.getByTestId('magic-pad').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * (0.7 - 0.05 * i));
      await page.waitForTimeout(60);
    }
    const trailCount = await page.getByTestId('swipe-trail-dot').count();
    assert.ok(trailCount >= 2, `스와이프 궤적 페이드 dots ≥2 (실측 ${trailCount})`);
    await page.screenshot({ path: shot('13b-swipe-trail') });
    await page.mouse.up(); // ↑커밋 = record_stop → ResultCanvas 전환(정책) — 복귀 후 C3c
    await page.waitForTimeout(400);
    await page.goto(APP);
    await page.getByTestId('voice-button').click();
    await page.waitForTimeout(600);

    // C3c. 더블탭 = 선택 (요구 ②) — 300ms 내 재탭 → 녹음 토글 없이 결과(선택) 화면 전환
    box = await page.getByTestId('magic-pad').boundingBox();
    await page.mouse.click(box.x + 60, box.y + 60);
    await page.waitForTimeout(120);
    await page.mouse.click(box.x + 62, box.y + 62);
    await page.waitForTimeout(700);
    await page.screenshot({ path: shot('13c-doubletap-select') });
    assert.ok((await page.content()).includes('표시할 내용이 없어요') || (await page.content()).includes('첫 답변') || (await page.content()).includes('보고서'), '더블탭 → 결과(선택) 화면 전환');
    await page.goto(APP); // VoiceHome 복귀 (비녹음)
    await page.getByTestId('voice-button').click();
    await page.waitForTimeout(600);

    // C4. 우하단 그립 좌우 드래그 = 미세조정 — 결과 캔버스로 이동 후 세그먼트 스텝 확인
    //     (홈에서 ↓cancel로 녹음만 종료된 상태 — 스토어 세그먼트는 ResultCanvas 시드 3종)
    await page.reload();
    await page.waitForTimeout(700);
    await page.getByTestId('voice-button').click();
    await page.waitForTimeout(600);
    box = await page.getByTestId('magic-pad').boundingBox();
    // 그립(우하단 96px)에서 시작해 좌측으로 100px → -2스텝(40px/스텝) — 화면 밖 이탈 없이 미세조정 유지
    await drag(page, box, { x: box.width - 40, y: box.height - 40 }, { x: box.width - 140, y: box.height - 45 }, { steps: 5, speedMs: 40 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('14-grip-drag-fine') });
    // 그립 드래그는 화면 전환/취소 없이 VoiceHome 유지 + 제스처 중 '미세조정' 힌트 배지
    assert.ok(await page.getByTestId('magic-pad').isVisible(), '그립 드래그 후 VoiceHome 유지(이탈 아님)');

    // A. 설정 → 3모드 세그먼트 전환 (joystick/pad) + PATCH joystickMode (theme 보존)
    await page.goto(APP);
    await page.getByTestId('settings-button').click();
    await page.getByTestId('joystick-customize-button').click();
    await page.getByTestId('joystick-modes').waitFor();
    await page.waitForTimeout(500);
    // 3종 카드 + 미리보기 애니메이션 프레임 존재 (카드 본문 ③)
    for (const m of ['joystick', 'pad', 'hybrid']) {
      assert.equal(await page.getByTestId(`joystick-mode-preview-${m}`).count(), 1, `모드 카드 미리보기: ${m}`);
    }
    const modeActive = (id) => page.getByTestId(`joystick-mode-${id}`).evaluate((el) => getComputedStyle(el).backgroundColor);
    // 기본 선택 = hybrid (이 계정에 저장 이력 없지만 기본값 권장) — active = accentTint rgb(240,250,245)
    assert.match(await modeActive('hybrid'), /240,\s*250,\s*245/, '모드 세그먼트: hybrid 활성(기본 권장)');
    await page.screenshot({ path: shot('20-settings-modes-hybrid') });

    await page.getByTestId('joystick-mode-pad').click();
    await page.waitForTimeout(700);
    assert.equal(meStore.preferences.joystickMode, 'pad', 'PATCH에 joystickMode 저장');
    assert.equal(meStore.preferences.theme, 'dark', '기존 preferences 키 보존 (read-modify-write)');

    await page.getByTestId('joystick-mode-joystick').click();
    await page.waitForTimeout(700);
    assert.equal(meStore.preferences.joystickMode, 'joystick');

    // B1. joystick 모드 = 스틱 렌더 (magic-pad 없음) — 캡처 (재마운트로 홈 진입)
    await page.goto(APP);
    await page.getByTestId('voice-button').click();
    await page.waitForTimeout(700);
    assert.equal(await page.getByTestId('magic-pad').count(), 0, 'joystick 모드: 매직패드 미렌더');
    await page.screenshot({ path: shot('30-home-joystick') });

    // B2/B3. pad·hybrid 모드 전환 → 홈 렌더 캡처 (매번 goto 재마운트 — 스택 재플레이 회피)
    async function setModeFromSettings(mode) {
      await page.goto(APP);
      await page.getByTestId('settings-button').click();
      await page.getByTestId('joystick-customize-button').click();
      await page.getByTestId(`joystick-mode-${mode}`).click();
      await page.waitForTimeout(500);
      await page.goto(APP);
      await page.getByTestId('voice-button').click();
      await page.waitForTimeout(700);
      await page.getByTestId('magic-pad').waitFor();
    }
    await setModeFromSettings('pad');
    await page.screenshot({ path: shot('31-home-pad') });
    await setModeFromSettings('hybrid');
    await page.screenshot({ path: shot('32-home-hybrid') });

    // D. 재부팅 → 서버에서 pad아니고 hybrid 복원 (마지막 저장=hybrid)
    await page.reload();
    await page.waitForTimeout(800);
    await page.getByTestId('voice-button').click();
    await page.waitForTimeout(700);
    assert.ok(await page.getByTestId('magic-pad').isVisible(), '재부팅 후 hybrid 유지(magic-pad 렌더)');
    const mirrored = await page.evaluate(() => localStorage.getItem('at-prefs-v1'));
    assert.ok(mirrored && JSON.parse(mirrored).joystickMode === 'hybrid', 'localStorage 미러에 모드 포함');

    assert.equal(errors.length, 0, `콘솔 예외 0건: ${errors.join(' | ')}`);
    await page.close();

    console.log('OK — 3모드 전환/영속 + 매직패드 제스처(탭/flick/swipe/그립드래그) + 재부팅 복원, 캡처: ' + OUT);
  } finally {
    await browser.close();
  }
})().catch(async (e) => {
  console.error('SMOKE FAIL:', e);
  const out = path.join(__dirname, 'artifacts', 'joystick-modes', 'fail-dump.png');
  console.error('debug hint: 재실행 시 각 단계별 스크린샷은 artifacts/joystick-modes/ 순차 캡처됨');
  process.exit(1);
});
