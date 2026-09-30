// 고유명사 보호 사전 '고유명사 보호' UI — 브라우저 실증 (카드 t_64914144 요구 2·3)
// 실행: expo export --output-dir dist-protected-smoke → node tests/e2e/fr-serve.cjs dist-protected-smoke 8241
//       → APP_URL=http://localhost:8241 node tests/e2e/smoke_protected_terms.cjs
// 검증 계약:
//  A. 설정 화면 '고유명사 보호' 행 + settings-protected-input/add 앵커 렌더 (ko 라벨)
//  B. 용어 입력→추가 → 칩 즉시 렌더(낙관적) + PATCH preferences.protectedTerms=['김비서'] + 다른 키(theme) 보존
//  C. reload 후 서버 하이드레이션으로 칩 유지(read-back) — localstate(at-prefs-v1) 미러도 포함 확인
//  D. 삭제(×) → PATCH protectedTerms=[] 발화 + 칩 소멸 (전체 삭제도 정당한 저장)
//  E. 중복 시도 → '이미 목록에 있습니다' 안내 + PATCH 중복 발화 없음
//  F. 콘솔 예외 0건
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8241';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'protected-terms');
fs.mkdirSync(OUT, { recursive: true });
const EXE = process.env.CHROME_PATH || '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const shot = (n) => path.join(OUT, `${n}.png`);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    const state = await installFixtures(page, {});
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // 서버 preferences 목 — theme(기타 선호)를 심어 딥머지 유실 0을 read-back 한다.
    const meStore = { preferences: { theme: 'dark' } };
    const patches = [];
    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        patches.push(body.preferences ?? {});
        Object.assign(meStore.preferences, body.preferences ?? {});
      }
      await route.fulfill({ json: { ok: true, data: { id: 'u1', preferences: meStore.preferences } } });
    });

    // ── A. 기본 렌더: 행/입력/버튼 존재 + 저장 이력 없음(빈 목록) ─────────────────
    await page.goto(APP);
    await page.getByTestId('settings-button').click();
    await page.getByTestId('settings-protected-input').waitFor();
    await page.getByText('고유명사 보호', { exact: true }).first().waitFor();
    assert.equal(await page.getByTestId(/^settings-protected-term-/).count(), 0, 'A: 초기 칩 없음(미저장=[])');
    assert.ok(!meStore.preferences.protectedTerms, 'A: 서버측 protectedTerms 미생성');
    await page.screenshot({ path: shot('10-settings-protected-empty') });

    // ── B. 추가 → 낙관적 칩 렌더 + PATCH protectedTerms=['김비서'], 다른 키 보존 ──
    await page.getByTestId('settings-protected-input').fill('김비서');
    await page.getByTestId('settings-protected-add').click();
    await page.getByTestId('settings-protected-term-0').waitFor();
    await page.getByText('김비서', { exact: true }).first().waitFor();
    await page.waitForTimeout(700); // PATCH 왕복
    assert.deepEqual(meStore.preferences.protectedTerms, ['김비서'], 'B: 서버 PATCH 반영');
    assert.equal(meStore.preferences.theme, 'dark', 'B: 다른 preferences 키 보존');
    const last = patches[patches.length - 1] || {};
    assert.deepEqual(last.protectedTerms, ['김비서'], 'B: 패치 페이로드 protectedTerms');
    await page.screenshot({ path: shot('20-settings-protected-added') });

    // ── C. reload 후 칩 유지 (서버 하이드레이션 우선 read-back) ─────────────────
    await page.goto(APP);
    await page.getByTestId('settings-button').click();
    await page.getByTestId('settings-protected-term-0').waitFor();
    await page.waitForTimeout(600); // hydrate 대기
    assert.equal(await page.getByTestId('settings-protected-term-0').count(), 1, 'C: reload 후 칩 유지');
    const chipText = await page.getByTestId('settings-protected-term-0').innerText();
    assert.match(chipText, /김비서/, 'C: 칩 라벨 실측');
    const mirrored = await page.evaluate(() => localStorage.getItem('at-prefs-v1'));
    assert.ok(mirrored && mirrored.includes('protectedTerms'), 'C: 로컬 미러(at-prefs-v1) 포함');
    await page.screenshot({ path: shot('30-settings-protected-after-reload') });

    // ── E(먼저). 중복 시도 → 안내 + 중복 PATCH 없음 ────────────────────────────
    const patchCountBefore = patches.length;
    await page.getByTestId('settings-protected-input').fill('김비서');
    await page.getByTestId('settings-protected-add').click();
    await page.getByText('이미 목록에 있습니다', { exact: true }).first().waitFor();
    await page.waitForTimeout(400);
    assert.equal(patches.length, patchCountBefore, 'E: 중복 추가는 PATCH를 내보내지 않는다');
    await page.screenshot({ path: shot('40-settings-protected-duplicate') });

    // ── D. 삭제 → PATCH [] + 칩 소멸 ───────────────────────────────────────────
    await page.getByTestId('settings-protected-remove-0').click();
    await page.waitForTimeout(700);
    assert.deepEqual(meStore.preferences.protectedTerms, [], 'D: 전체 삭제 서버 반영([] 발화)');
    assert.equal(await page.getByTestId(/^settings-protected-term-/).count(), 0, 'D: 칩 소멸');
    await page.screenshot({ path: shot('50-settings-protected-removed') });

    // ── F. 예외 0건 ────────────────────────────────────────────────────────────
    assert.deepEqual(errors, [], 'F: 콘솔 페이지 예외 없음: ' + errors.join(' | '));
    console.log('protected-terms smoke: 6/6 PASS (' + OUT + ')');
  } finally {
    await browser.close();
  }
})();
