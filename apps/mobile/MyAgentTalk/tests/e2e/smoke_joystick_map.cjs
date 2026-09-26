// 조이스틱 자유매핑 + 매핑 영속 + ConsentGate 섞기 레이아웃 — 브라우저 실증 캡처 (카드 t_ced38e19 요구 7 + 코멘트 #83)
// 실행: 정적서버(python3 -m http.server 8099 @ dist-web) → node tests/e2e/smoke_joystick_map.cjs
// 검증 계약:
//  A. 가입 ConsentGate — 마케팅이 필수 목록 중간에, [선택]/[필수] 문구·차등 스타일 없이 동일 행 스타일 (#83) + 가입 시 consents 기록
//  B. 설정→커스터마이징 — 3x3 슬롯/동작 풀 시트/프리셋 chips, 재할당 즉시 반영 + localStorage 미러 + 중앙 녹음 고정(요구 5)
//  C. 서버 영속 — PATCH /api/auth/me preferences.joystickMap + 기존 prefs 키 보존, 로컬 지우고 리로드 → 서버에서 복원(요구 2/4)
//  D. 한손 프리셋 = 좌우 미러(요구 2) · 콘솔 예외 0건
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8099';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'joystick-map');
fs.mkdirSync(OUT, { recursive: true });
const EXE = process.env.CHROME_PATH || '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const shot = (n) => path.join(OUT, `${n}.png`);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // ── A. 가입 동의 게이트 (비로그인 → signup 화면) ─────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const signupCalls = [];
      await page.route('**/health', (r) => r.fulfill({ json: { status: 'ok', timestamp: '', mode: 'dev' } }));
      await page.route('**/api/agents', (r) => r.fulfill({ status: 401, json: { ok: false, error: { code: 'AUTH', message: '' } } }));
      await page.route('**/api/auth/signup', async (r) => {
        signupCalls.push(r.request().postDataJSON());
        await r.fulfill({ json: { ok: true, data: { token: 'jwt-smoke', user: { id: 'u1', email: 'a@b.c' } } } });
      });
      await page.goto(APP);
      await page.getByTestId('login-hint').click(); // 401 → errors.auth → 로그인 진입 바
      await page.getByTestId('login-card').waitFor();
      await page.getByTestId('auth-mode-toggle').click(); // 가입 모드 = 동의 게이트
      const gate = page.getByTestId('consent-terms');
      await gate.waitFor();
      await page.waitForTimeout(250);
      await page.screenshot({ path: shot('10-consent-gate-mixed'), fullPage: true });

      // DOM 순서: 약관 → 개인정보 → 마케팅 → 음성 → 국외 → 14세 (마케팅이 한가운데 섞임)
      const ids = ['terms', 'privacy', 'marketing', 'voice', 'overseas', 'age14'];
      const order = await page.evaluate((list) => list
        .map((id) => document.querySelector(`[data-testid="${id}"]`))
        .filter(Boolean)
        .sort((a, b) => {
          const pos = (n) => { let y = 0; while (n) { y += n.offsetTop; n = n.offsetParent; } return y; };
          return pos(a) - pos(b);
        })
        .map((el) => el.getAttribute('data-testid')), ids.map((id) => `consent-${id}`));
      assert.deepEqual(order, ids.map((id) => `consent-${id}`), `마케팅이 필수들 사이에 섞임: ${order}`);

      // 구분 문구 제거 + 라벨 스타일 필수와 동일 (fontSize/color)
      const labelStyle = (id) => page.locator(`[data-testid="consent-${id}"]`).evaluate((el) => {
        const t = el.querySelector('span,div,p') || el;
        const s = getComputedStyle(t);
        return { size: s.fontSize, color: s.color };
      });
      const mk = await labelStyle('marketing');
      const req = await labelStyle('terms');
      assert.deepEqual(mk, req, `마케팅 라벨 스타일 = 필수 라벨 스타일 (${JSON.stringify(mk)} vs ${JSON.stringify(req)})`);
      const bodyText = await page.locator('[data-testid="consent-marketing"]').innerText();
      assert.ok(!/\[선택\]|\[필수\]|\[Optional\]|\[Required\]/.test(bodyText), `구분 문구 없음: ${bodyText}`);

      // opt-in 기본 off: 전체 동의 후 필수 행은 체크(✓)되지만 마케팅 행은 미체크 유지
      await page.getByTestId('consent-all-required').click();
      const checkedOf = (id) => page.locator(`[data-testid="consent-${id}"]`).evaluate((el) => el.textContent.includes('✓'));
      assert.equal(await checkedOf('terms'), true, '약관 체크됨');
      assert.equal(await checkedOf('marketing'), false, '일괄 동의 후에도 마케팅 기본 off (opt-in 불변)');
      await page.screenshot({ path: shot('11-consent-all-but-marketing-off'), fullPage: true });

      // 가입 제출 → 서버에 5종 consents 기록(동일 payload 계약 불변)
      await page.getByTestId('login-email').fill('joy-signup@myagenttalk.dev');
      await page.getByTestId('login-password').fill('pw-smoke-1!');
      await page.getByTestId('signup-submit').click();
      await page.waitForTimeout(600);
      assert.equal(signupCalls.length, 1, 'signup POST 1회');
      const consents = signupCalls[0].consents;
      const byType = Object.fromEntries(consents.map((c) => [c.type, c.consented]));
      assert.deepEqual(byType, { terms: true, privacy: true, voice_recording: true, overseas_transfer: true, marketing: false },
        `서버 consents 기록 — marketing만 false(opt-in): ${JSON.stringify(byType)}`);
      assert.equal(signupCalls[0].age_confirmed, true);
      assert.equal(errors.length, 0, `A 콘솔 예외 없음: ${errors.join(' | ')}`);
      await page.close();
    }

    // ── B/C/D. 커스터마이징 편집 + 서버 영속 + 복원 (fixtures 토큰 상태) ─────
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
      const state = await installFixtures(page, {});
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      // /api/auth/me 목 — 기존 preferences 키(theme) 보존 확인 + PATCH 저장
      const meStore = { preferences: { theme: 'dark' } };
      await page.route('**/api/auth/me', async (route) => {
        state.calls.push({ path: '/api/auth/me', method: route.request().method(), body: route.request().postDataJSON() });
        if (route.request().method() === 'PATCH') Object.assign(meStore.preferences, route.request().postDataJSON().preferences ?? {});
        await route.fulfill({ json: { ok: true, data: { id: 'u1', preferences: meStore.preferences } } });
      });

      await page.goto(APP);
      await page.getByTestId('settings-button').click();
      await page.getByTestId('joystick-customize-button').click();
      await page.getByTestId('joystick-grid').waitFor();
      await page.waitForTimeout(600); // 화면 전환 애니메이션 정지 후 캡처 (중간 프레임 방지)
      await page.screenshot({ path: shot('20-joystick-editor') });

      // 요구 5: 중앙은 녹음 고정 (편집 시트 열리지 않음)
      await page.getByTestId('joystick-slot-center').click();
      await page.waitForTimeout(250);
      assert.equal(await page.getByTestId('joystick-action-sheet').count(), 0, '중앙 탭해도 동작 시트 없음(고정)');

      // 슬롯 재할당: 왼쪽 위 → 즐겨찾기 — 즉시 반영 + localStorage 미러
      await page.getByTestId('joystick-slot-DIR_UPLEFT').click();
      await page.getByTestId('joystick-action-sheet').waitFor();
      await page.screenshot({ path: shot('21-action-sheet') });
      await page.getByTestId('joystick-action-favorites').click();
      await page.waitForTimeout(500);
      assert.ok((await page.getByTestId('joystick-slot-DIR_UPLEFT').innerText()).includes('즐겨찾기'), '재할당 즉시 반영');
      await page.screenshot({ path: shot('22-reassigned') });
      const mirrored = await page.evaluate(() => localStorage.getItem('at-prefs-v1'));
      assert.ok(mirrored && JSON.parse(mirrored).joystickMap.DIR_UPLEFT === 'favorites', 'localStorage 미러 저장');

      // 요구 2: 한손 프리셋 = 좌우 미러 (오른쪽에 예)
      await page.getByTestId('joystick-preset-onehand').click();
      await page.waitForTimeout(400);
      assert.ok((await page.getByTestId('joystick-slot-DIR_RIGHT').innerText()).includes('예'), '한손 프리셋: 오른쪽=예');
      await page.screenshot({ path: shot('23-onehand-preset') });

      // 서버 영속: (한손 전환도 PATCH) → 재편집 → DIR_UPLEFT=favorites 최종본
      await page.getByTestId('joystick-preset-default').click();
      await page.waitForTimeout(400);
      await page.getByTestId('joystick-slot-DIR_UPLEFT').click();
      await page.getByTestId('joystick-action-favorites').click();
      await page.waitForTimeout(900);
      const patches = state.calls.filter((c) => c.path === '/api/auth/me' && c.method === 'PATCH');
      assert.ok(patches.length >= 2, `PATCH /api/auth/me ×${patches.length} — 편집마다 저장`);
      const last = patches[patches.length - 1];
      assert.equal(last.body.preferences.joystickMap.DIR_UPLEFT, 'favorites', 'joystickMap 페이로드');
      assert.equal(last.body.preferences.theme, 'dark', '기타 preferences 키 보존 (read-modify-write)');
      assert.equal(meStore.preferences.joystickMap.DIR_UPLEFT, 'favorites', '서버 목에 영속');

      // 요구 2/4 복원: 로컬 미러 삭제 → 리로드 → 서버 preferences에서 하이드레이션
      await page.evaluate(() => localStorage.removeItem('at-prefs-v1'));
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      await page.getByTestId('settings-button').click();
      await page.getByTestId('joystick-customize-button').click();
      await page.getByTestId('joystick-grid').waitFor();
      // 하이드레이션(getMe)이 완료될 때까지 폴링 — 즉시 assert는 기본 프리셋과 경쟁함
      await page.getByTestId('joystick-slot-DIR_UPLEFT').filter({ hasText: '즐겨찾기' }).waitFor({ timeout: 8000 });
      await page.screenshot({ path: shot('24-restored-after-reload') });

      assert.equal(errors.length, 0, `B/C 콘솔 예외 없음: ${errors.join(' | ')}`);
      await page.close();
    }
    console.log('PASS joystick-map — consent mixing + mapping editor/persistence/restore, shots in ' + OUT);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FAIL', e.message); process.exitCode = 1; });
