/**
 * smoke_fast_entry.cjs — t_710b5d28 진입 페인트 임계 스모크 (대표님 10/4 "대화 진입 너무 느려")
 *
 * 재현: (A/B 리그) node tests/e2e/perf-serve.cjs dist-<빌드> 8353  ← 백엔드 :3037(DEV_MODE)
 *       APP_URL=http://127.0.0.1:8353 BACKEND_URL=http://127.0.0.1:3037 \
 *       PERF_EMAIL=... PERF_TOKEN=... node tests/e2e/smoke_fast_entry.cjs
 * 기본: 라이브 https://myagenttalk.com + 실백엔드 (배포 후 read-back 용; 라이브는 김비서 수동 절차).
 *
 * 단언 (카드 §3 예산):
 *   COLD(신규 컨텍스트, HTTP 로컬 캐시 없음) 목록 첫 페인트 ≤ 2000ms
 *   WARM(동일 컨텍스트 재접속, 불변 자산 캐시 히트)        ≤ 800ms
 *   + 스플래시 해제는 폰트 로드 이후(대표님 9/26 '폰트 없는 화면 노출 금지') — body 텍스트에
 *     스플래시 브랜드가 먼저 등장하고, 폰트 없는 상태의 목록은 관측되지 않는다.
 *   + tap→대화 화면 진입이 성공(entered)하고, 진입 fetch가 실패로 끝나지 않는다.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'https://myagenttalk.com';
const API = process.env.BACKEND_URL || 'https://app.myagenttalk.com';
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'fast-entry');
fs.mkdirSync(OUT, { recursive: true });
const COLD_MS = Number(process.env.COLD_MS || 2000);
const WARM_MS = Number(process.env.WARM_MS || 800);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = () => {
  window.__t = { marks: {} };
  const watch = () => {
    if (!('list' in window.__t.marks) && document.querySelector('[data-testid="session-card"]'))
      window.__t.marks.list = Math.round(performance.now());
    if (!('splash' in window.__t.marks) && document.querySelector('[data-testid="font-splash"]'))
      window.__t.marks.splash = Math.round(performance.now());
    if ('splash' in window.__t.marks && !('app' in window.__t.marks) && !document.querySelector('[data-testid="font-splash"]'))
      window.__t.marks.app = Math.round(performance.now());
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
};

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function bootOnce(browser, token, reuseCtx) {
  const ctx = reuseCtx || await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  if (!reuseCtx) await ctx.addInitScript((t) => { localStorage.setItem('at-web-v1.sess', t); localStorage.setItem('at-language', 'ko'); }, token);
  const page = await ctx.newPage();
  await page.addInitScript(PROBE);
  const t0 = Date.now();
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' });
  let painted = true;
  try { await page.getByTestId('session-card').first().waitFor({ timeout: 30000 }); } catch { painted = false; }
  const wall = Date.now() - t0;
  const marks = await page.evaluate(() => window.__t.marks);
  return { page, ctx, wall, marks, painted };
}

(async () => {
  const email = process.env.PERF_EMAIL, token = process.env.PERF_TOKEN;
  assert.ok(email && token, 'PERF_EMAIL/PERF_TOKEN 필요 (perf_trace.cjs가 발급·저장)');
  // 계정 유효성: 실패하면 401 → 온보딩 패널이라 페인트 단언이 무의미 — 사전 확인.
  const probe = await fetch(`${API}/api/sessions`, { headers: { authorization: 'Bearer ' + token } }).then((r) => r.status).catch(() => 0);
  assert.equal(probe, 200, `백엔드 세션 GET 200 기대, 실측 ${probe} (토큰 갱신 필요)`);
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // COLD — 신규 컨텍스트(브라우저 HTTP 캐시 없음 = 실사용자 첫 방문 근사)
    const cold = await bootOnce(browser, token, null);
    check('C① cold 목록 페인트 성공', cold.painted, `marks=${JSON.stringify(cold.marks)}`);
    check(`C② cold 페인트 ≤${COLD_MS}ms`, cold.marks.list != null && cold.marks.list <= COLD_MS, `list=${cold.marks.list}ms wall=${cold.wall}ms`);
    check('C③ 폰트 게이트: 스플래시 → 해제 순서 (폰트 없는 화면 노출 금지)', 'splash' in cold.marks && 'app' in cold.marks && cold.marks.app >= cold.marks.splash, `splash=${cold.marks.splash} app=${cold.marks.app}`);
    check('C④ 목록 페인트는 스플래시 해제 이후', cold.marks.list >= cold.marks.app);
    // WARM — 동일 컨텍스트 재접속 (불변 자산 HTTP 캐시 히트 = 2번째 방문 근사)
    await cold.page.close();
    const warm2 = await bootOnce(browser, token, cold.ctx);
    check('W① warm 목록 페인트 성공', warm2.painted, `marks=${JSON.stringify(warm2.marks)}`);
    check(`W② warm 페인트 ≤${WARM_MS}ms`, warm2.marks.list != null && warm2.marks.list <= WARM_MS, `list=${warm2.marks.list}ms wall=${warm2.wall}ms`);
    // 진입: 행 탭 → 대화 화면(voice stage 또는 chat input) 도달 — 실패(체인크 로 에러) 없는지.
    let entered = false;
    const tapT = Date.now();
    try { await warm2.page.getByTestId('session-card').first().click({ timeout: 8000 }); } catch { }
    try {
      await Promise.race([
        warm2.page.getByTestId('chat-input').waitFor({ timeout: 20000 }),
        warm2.page.getByTestId('voice-stage').waitFor({ timeout: 20000 }),
      ]);
      entered = true;
    } catch { }
    await sleep(400);
    check('E① 탭→대화 화면 진입 성공', entered, `${Date.now() - tapT}ms`);
    const chunkErr = await warm2.page.evaluate(() => document.querySelectorAll('[data-testid="chunk-loading"]').length);
    check('E② 진입 후 청크 로딩 폴백 잔존 0', chunkErr === 0, `n=${chunkErr}`);
    await warm2.page.screenshot({ path: path.join(OUT, 'entry-after-tap.png') }).catch(() => {});
    await warm2.ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`\nsmoke_fast_entry — ${passed} PASS / ${failed} FAIL — ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
