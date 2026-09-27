// t_b250487a 심야 영역구분 레이아웃 감사 — ③ 전 화면 캡처 + DOM 실측(버블 잔존 0 검증)
// 실행: (dist-tb250487a 정적서버 :8134) → node tests/e2e/shot_layoutaudit_t_b250487a.cjs
//       before 비교는 APP_URL=http://localhost:8135 OUT_DIR=.../before node 동일 스크립트
// 데이터: run_c_fixtures.cjs 전량 모의 — 데모 픽스처(실DB 아님). vision 검수용 PNG + structured check 출력.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8134';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'layout-audit-tb250487a', 'after');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

// 발신자 행(message-user/message-agent/message-user-label)만 스코프한 버블 실측 —
// 컨트롤 칩(suggestChip 등)의 alignSelf은 계약 대상이 아니다(카드 본문: 발신자 말풍선 금지).
const PROBE = () => {
  const rows = [...document.querySelectorAll('[data-testid="message-user"],[data-testid="message-agent"]')];
  const bubbles = [];
  const asym = [];
  const narrowBand = [];
  for (const el of rows) {
    const cs = getComputedStyle(el);
    if (cs.alignSelf === 'flex-end' || cs.alignSelf === 'flex-start') bubbles.push([el.getAttribute('data-testid'), cs.alignSelf]);
    const r = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
    if (new Set(r).size > 1) asym.push([el.getAttribute('data-testid'), r.join('|')]);
    const parentW = el.parentElement ? el.parentElement.getBoundingClientRect().width : 0;
    const w = el.getBoundingClientRect().width;
    if (el.getAttribute('data-testid') === 'message-user' && parentW > 0 && w < parentW - 4) narrowBand.push([el.textContent.slice(0, 24), `${w}px / ${parentW}px`]);
  }
  return {
    rows: rows.length,
    bubbles, asym, narrowBand,
    userLabels: document.querySelectorAll('[data-testid="message-user-label"]').length,
  };
};

async function openAt(browser, width, { login = false, wave = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 900 }, locale: 'ko-KR' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, { wave });
  await page.addInitScript(() => localStorage.setItem('at-language', 'ko'));
  await page.goto(APP, { waitUntil: 'networkidle' });
  if (login) {
    await page.evaluate(() => localStorage.removeItem('at-web-v1.sess'));
    await page.reload({ waitUntil: 'networkidle' });
  }
  return { page, errors, state };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const results = {};
  try {
    // ── 1. 로그인 ──
    for (const [w, tag] of [[390, 'm'], [1440, 'p']]) {
      const { page, errors } = await openAt(browser, w, { login: true });
      await page.screenshot({ path: shot(`01-login-${tag}-${w}`), fullPage: false });
      check(`01-login-${tag} 렌더`, (await page.locator('input, [role="textbox"], [data-testid]').count()) > 0, `${w}px`);
      check(`01-login-${tag} 오류 0`, errors.length === 0, errors.slice(0, 2).join(' | '));
      await page.close();
    }
    // ── 2. 대화목록 ──
    for (const [w, tag] of [[390, 'm'], [1440, 'p']]) {
      const { page, errors } = await openAt(browser, w);
      await page.getByTestId('session-card').first().waitFor({ timeout: 15000 });
      await page.screenshot({ path: shot(`02-dialogue-list-${tag}-${w}`) });
      check(`02-list-${tag} 세션카드 노출`, (await page.getByTestId('session-card').count()) >= 1);
      check(`02-list-${tag} 오류 0`, errors.length === 0, errors.slice(0, 2).join(' | '));
      await page.close();
    }
    // ── 3. 채팅(발신 행 포함) 모바일 390 ──
    {
      const { page, errors } = await openAt(browser, 390);
      await page.getByTestId('session-card').click();
      await page.getByText('견적 요청', { exact: true }).first().waitFor({ timeout: 15000 });
      await openKeyboardIfVoice(page);
      await page.getByTestId('chat-input').fill('레이아웃 감사 발화');
      await page.getByTestId('send-button').click();
      await page.getByText('Test reply to 레이아웃 감사 발화', { exact: true }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(600); // 페인트 대기 (t_3116c5bc fade 함정)
      await page.screenshot({ path: shot('03-chat-m-390') });
      results.m390 = await page.evaluate(PROBE);
      check('03-chat-m 메시지행 렌더', results.m390.rows >= 2, `rows=${results.m390.rows}`);
      check('03-chat-m alignSelf 버블 0', results.m390.bubbles.length === 0, JSON.stringify(results.m390.bubbles));
      check('03-chat-m borderRadius 좌우비대칭 0', results.m390.asym.length === 0, JSON.stringify(results.m390.asym));
      check('03-chat-m 사용자 밴드 전체폭', results.m390.narrowBand.length === 0, JSON.stringify(results.m390.narrowBand));
      check('03-chat-m \'나\' 라벨(t_b250487a 반전) 존재', results.m390.userLabels >= 1, `labels=${results.m390.userLabels}`);
      check('03-chat-m 오류 0', errors.length === 0, errors.slice(0, 2).join(' | '));
      await page.close();
    }
    // ── 4. 채팅 PC 3패널 1440 ──
    {
      const { page, errors } = await openAt(browser, 1440);
      await page.getByTestId('session-card').click();
      await page.getByText('견적 요청', { exact: true }).first().waitFor({ timeout: 15000 });
      await page.getByTestId('chat-input').fill('PC 레이아웃 감사 발화');
      await page.getByTestId('send-button').click();
      await page.getByText('Test reply to PC 레이아웃 감사 발화', { exact: true }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: shot('04-chat-pc-1440') });
      results.p1440 = await page.evaluate(PROBE);
      const panel = await page.getByTestId('context-panel').count();
      check('04-chat-pc 3패널(컨텍스트 패널) 노출', panel === 1, `context-panel=${panel}`);
      check('04-chat-pc alignSelf 버블 0', results.p1440.bubbles.length === 0, JSON.stringify(results.p1440.bubbles));
      check('04-chat-pc borderRadius 좌우비대칭 0', results.p1440.asym.length === 0, JSON.stringify(results.p1440.asym));
      check('04-chat-pc 사용자 밴드 전체폭', results.p1440.narrowBand.length === 0, JSON.stringify(results.p1440.narrowBand));
      check('04-chat-pc \'나\' 라벨 존재', results.p1440.userLabels >= 1, `labels=${results.p1440.userLabels}`);
      check('04-chat-pc 오류 0', errors.length === 0, errors.slice(0, 2).join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(results, null, 2));
    console.log(`\n== layout-audit ${path.basename(OUT)}: ${passed} PASS / ${failed} FAIL ==`);
    process.exitCode = failed > 0 ? 1 : 0;
  }
})().catch((e) => { console.error('FATAL', e); process.exitCode = 2; });
