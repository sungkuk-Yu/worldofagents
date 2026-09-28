/**
 * 답변 대기 LIVE 왕복 실측 — t_363c0faa (mock 아님).
 * worldofagent.ai Netlify 수동 배포 정지(9/26 사고로그, 자격증명 김비서 소관) → 라이브 번들 로컬 대체:
 * 커밋된 트리에서 fresh export(--clear)한 번들을 실서버 DEV :3020(t_811e176c 라우트 착지)에 연결해 검증.
 *   백엔드: .worktrees/t_811e176c/apps/backend DEV_MODE=true PORT=3020 (기동 확인 후)
 *   정적서버: node tests/e2e/fr-serve.cjs dist-verify-pending 8111
 *   ※ 8082 등 다른 워커 점유 포트 금지 — 남의 dist를 실측하는 오탐 발생(9/28 이 카드에서 실측)
 *   실행: APP_URL=http://127.0.0.1:8111 node tests/e2e/verify_pending_live.cjs
 * 검증: ① 번들 문자열 실검출(reply.pending.updated/pending-open) ② 실 signup→턴 왕복 무오류
 *       ③ GET /pending 200 응답(라우트 실착지) + DEV 템플릿 답변 = 배지 0 강등(오탐 없음)
 *       ④ 답변 대기 버튼 최소 노출(회색, 배지 없음) — 콘솔 에러 0.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://127.0.0.1:8111';
const BUNDLE_DIR = process.env.BUNDLE_DIR || path.join(__dirname, '../../dist-verify-pending');
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'pending-live');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  // ① 라이브 번들 문자열 실검출 — 배포될 산출물 자체(로컬 대체)에서 계약 식별자 확인
  const js = fs.readdirSync(path.join(BUNDLE_DIR, '_expo/static/js/web')).filter((f) => /^index-.*\.js$/.test(f));
  const joined = js.map((f) => fs.readFileSync(path.join(BUNDLE_DIR, '_expo/static/js/web', f), 'utf8')).join('');
  check('번들 실검출: reply.pending.updated', joined.includes('reply.pending.updated'));
  check('번들 실검출: pending-open/pending-count testID', joined.includes('pending-open') && joined.includes('pending-count'));
  check('번들 실검출: api/sessions …/pending 경로', joined.includes('/pending')); // minify로 함수명은 사라질 수 있어 경로 리터럴만 단언
  // ko 번들 문자열: 웹팩 산출물엔 \uXXXX 이스케이프본으로도 들어온다 — 원문/이스케이프 양쪽 허용
  const koRaw = joined.includes('답변 대기');
  const koEsc = /\\ub2f5\\ubcc0 \\ub300\\uae30/.test(joined);
  check('번들 실검출: 답변 대기 문구(ko)', koRaw || koEsc);

  const stamp = Date.now();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const pendingReqs = [];
    page.on('response', (r) => { if (/\/api\/sessions\/[^/]+\/pending$/.test(r.url())) pendingReqs.push(r.status()); });
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.getByTestId('login-hint').click().catch(async () => { await page.getByTestId('new-chat-button').click(); });
    await page.waitForTimeout(800);
    await page.getByTestId('auth-mode-toggle').click();
    await page.getByTestId('login-email').fill(`pend-live-${stamp}@myagenttalk.dev`);
    await page.getByTestId('login-password').fill(`pend-live-${stamp}!A1`);
    await page.getByTestId('consent-all-required').click();
    await page.getByTestId('signup-submit').click();
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
    await page.getByTestId('new-chat-button').click();
    await openKeyboardIfVoice(page);
    await page.getByTestId('chat-input').fill('견적서 초안을 정리해줘');
    await page.getByTestId('send-button').click();
    await page.waitForSelector('[data-testid="message-list"]', { timeout: 20000 });
    await page.waitForTimeout(3000);
    // ② 부트스트랩 GET /pending 실라우트 왕복 (404 아님 = t_811e176c 라우트 착지 확인)
    check('GET /pending 실착지 (200)', pendingReqs.includes(200), `statuses=[${pendingReqs}]`);
    // ③ DEV 템플릿 답변 = 회신 요구 없음 → 배지 0 강등(오탐 없음)·버튼 최소 노출
    check('답변 대기 버튼 노출 (0건도 최소 UI)', await page.getByTestId('pending-open').isVisible());
    check('오배지 없음 — pending-count 미렌더', (await page.getByTestId('pending-count').count()) === 0);
    await page.screenshot({ path: shot('01-live-badge0') });
    check('콘솔/런타임 에러 0', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 160));
  } finally {
    await browser.close();
  }
  console.log(`\n=== pending LIVE: ${passed} PASS / ${failed} FAIL ===`);
  assert.equal(failed, 0, `${failed} 실패`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
