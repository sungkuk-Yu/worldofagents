// t_0e03e405 라이브 read-back — 실백엔드 왕복에서 '우측 질문 현황 항목 수 == 메인 顶级 질문 버블 수' 불변식 실측+캡처
// 백엔드: DEV_MODE=true PORT=3020 (CORS에 8082 포함) / 서빙: dist-t0e03e405-live (EXPO_PUBLIC_API_URL=:3020 베이크)
// 실행: APP_URL=http://localhost:8082 node tests/e2e/verify_tracker_live_t_0e03e405.cjs
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8082';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'tracker-live-readback-t0e03e405');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const userBubbles = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="message-user"]'))
  .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()));
const trackerRows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="tracker-row-"]'))
  .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()));

(async () => {
  const stamp = Date.now();
  const email = `trk-live-${stamp}@myagenttalk.dev`;
  const cred = `trk-live-${stamp}!A1`;
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.getByTestId('login-hint').click().catch(async () => { await page.getByTestId('new-chat-button').click(); });
    await page.waitForTimeout(600);
    await page.getByTestId('auth-mode-toggle').click();
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(cred);
    await page.getByTestId('consent-all-required').click();
    await page.getByTestId('signup-submit').click();
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
    await page.getByTestId('new-chat-button').click();
    await page.getByTestId('chat-input').waitFor({ timeout: 20000 });

    // 왕복 1: 질문 → (재질문 칩 노출 시) '예' 탭 → 답변
    await page.getByTestId('chat-input').fill('라이브 검증 질문입니다. 오늘 요일만 짧게 알려줘');
    await page.getByTestId('send-button').click();
    const chip = await page.getByTestId('ack-chips').waitFor({ timeout: 300000 }).then(() => true).catch(() => false);
    if (chip) {
      // 확인응답 발화 전: 질문 1행 = 버블 1 (재질문 empathy는 agent 행 — 비계수)
      let rows = await trackerRows(page); let bubbles = await userBubbles(page);
      check('V1 발화 후 재질문 시점: 질문 현황 1행 == 顶级 버블 1', rows.length === 1 && bubbles.length === 1, `rows=${rows.length} bubbles=${bubbles.length}`);
      await page.screenshot({ path: path.join(OUT, 'V1-before-ack.png') });
      await page.getByTestId('ack-chip-yes').click({ timeout: 1500 }).catch(() => {});
    } else {
      console.log('  (라이브 라우터가 이번 턴 재질문 생략 — 칩 경로 스킵, 발화 자체는 顶级 유지)');
    }
    // 답변 완료 대기: '완료' 단계 행 등장
    let done = false;
    for (let i = 0; i < 240 && !done; i++) { await sleep(1000); done = (await trackerRows(page)).some((r) => r.includes('완료')); }
    assert.ok(done, '라이브 답변 도착 후 질문 현황 = 완료 전이');
    await sleep(1500); // 윈도우 정착
    let rows = await trackerRows(page), bubbles = await userBubbles(page);
    console.log('  rows=', JSON.stringify(rows)); console.log('  bubbles=', JSON.stringify(bubbles));
    check('V1 답변 후: 질문 현황 항목 수 == 顶级 질문 버블 수 (예 병합)', rows.length === bubbles.length && bubbles.every((b) => !/^(예|아니요)\b/.test(b)), `rows=${rows.length} bubbles=${bubbles.length}`);
    await page.screenshot({ path: path.join(OUT, 'V1-after-answer.png') });

    // 왕복 2: 후속 진짜 질문 ('예로 시작' 오탐 금지 — 顶级 유지 + 새 행)
    await page.getByTestId('chat-input').fill('예를 들어, 어젯밤 통화 내용을 간단히 정리해줄래?');
    await page.getByTestId('send-button').click();
    await page.getByTestId('ack-chips').waitFor({ timeout: 300000 }).then(() => true).catch(() => false);
    await sleep(2000);
    rows = await trackerRows(page); bubbles = await userBubbles(page);
    check('V2 예들을-들어 발화 = 顶级 버블 + 현황 2행 유지(오탐 금지)', bubbles.some((b) => b.includes('예를 들어')) && rows.length === 2 && bubbles.length === 2, `rows=${rows.length} bubbles=${JSON.stringify(bubbles.map((b) => b.slice(0, 14)))}`);
    await page.screenshot({ path: path.join(OUT, 'V2-real-question-kept.png') });
    check('V 런타임 오류 0건', errors.length === 0, JSON.stringify(errors.slice(0, 2)));
    await fetch(`${APP.replace(':8082', ':3020')}/api/dev/users/${encodeURIComponent(email)}`, { method: 'DELETE' }).catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(`\nRESULT tracker-live: ${passed} PASS / ${failed} FAIL`);
  if (failed) process.exit(1);
})().catch((e) => { console.error('TRACKER LIVE CRASH:', e); process.exit(1); });
