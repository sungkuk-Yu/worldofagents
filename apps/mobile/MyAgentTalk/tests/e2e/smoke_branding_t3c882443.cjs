/**
 * t_3c882443 브랜드 3종 실측 — 백엔드 없이 run_c_fixtures 인터셉트 (메모리 최소 토큰 경로, 9/26 교훈).
 *  ① 탭 제목: 기본 '마이에이전트톡' / 채팅 진입 시 'Original project — 마이에이전트톡' (document.title read-back)
 *  ② 헤더 로고: DialogueList 헤더 = g3 마크(40px image) + MyAgentTalk 워드마크 (390px+1440px 캡처)
 *  ③ 상단 큐 스트립 폐기: 채팅 DOM에 queue-strip/queue-chip 부재, 카드 행 마커는 유지
 * 실행: node tests/e2e/fr-serve.cjs dist-t3c882443 8096 (별도 셸)
 *       APP_URL=http://localhost:8096 node tests/e2e/smoke_branding_t3c882443.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8096';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'branding-t3c882443');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, n.endsWith('.png') ? n : `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ── 390px 모바일 ──
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page);
      await page.goto(APP, { waitUntil: 'networkidle' });
      await sleep(600);
      // ① 목록 화면 탭 제목 = 브랜드 기본값
      check('① 목록 탭 제목 = 마이에이전트톡', (await page.title()) === '마이에이전트톡', `title="${await page.title()}"`);
      // ② 헤더 로고 — 마크 이미지 노출 (390<640 → 워드마크 없이 마크 단독)
      const brand = page.getByTestId('header-brand');
      await brand.waitFor({ timeout: 8000 });
      const markBox = await brand.locator('img').first().boundingBox().catch(() => null);
      check('② 390px 헤더 마크 렌더(≥36px)', !!markBox && markBox.width >= 36 && markBox.height >= 36, markBox ? `w=${Math.round(markBox.width)} h=${Math.round(markBox.height)}` : 'no-img');
      const wordmark390 = await brand.getByText('MyAgentTalk').count();
      check('② 390px는 마크 단독(<640 워드마크 숨김 — 아이콘 6종과 충돌 방지)', wordmark390 === 0, `wordmark=${wordmark390}`);
      await page.screenshot({ path: shot('a-list-390.png') });
      // ③ 채팅 진입 — 스트립 폐기 + 탭 제목 패턴
      await page.getByTestId('session-card').first().click();
      await page.getByTestId('chat-appbar').waitFor({ timeout: 8000 });
      await sleep(800);
      check('③ 채팅 탭 제목 = 방명 — 마이에이전트톡', (await page.title()) === 'Original project — 마이에이전트톡', `title="${await page.title()}"`);
      const stripCount = await page.evaluate(() => document.querySelectorAll('[data-testid="queue-strip"], [data-testid^="queue-chip-"], [data-testid="queue-counter"]').length);
      check('③ 상단 큐 스트립 DOM 0 (폐기)', stripCount === 0, `found=${stripCount}`);
      const appbar = await page.getByTestId('chat-appbar').boundingBox();
      check('③ 앱바가 화면 최상단 (스트립 자리 없음)', !!appbar && appbar.y < 90, appbar ? `appbar.y=${Math.round(appbar.y)}` : 'no-appbar');
      await page.screenshot({ path: shot('b-chat-390.png') });
      check('Z 390px 런타임 페이지 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));
      await page.close();
    }
    // ── 1440px PC (사이드바 레일 + 홈 헤더) ──
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page);
      await page.goto(APP, { waitUntil: 'networkidle' });
      await sleep(600);
      const brand = page.getByTestId('header-brand').first();
      await brand.waitFor({ timeout: 8000 });
      const word = await brand.getByText('MyAgentTalk').count();
      check('② PC 홈 헤더 = 마크 + MyAgentTalk 워드마크', word >= 1, `wordmark=${word}`);
      await page.screenshot({ path: shot('c-list-1440.png') });
      await page.getByTestId('session-card').first().click();
      await page.getByTestId('chat-appbar').waitFor({ timeout: 8000 });
      await sleep(800);
      // (t_fd869e5b 정합) 왼쪽 세션목록 사이드바 = 슬랙식 스레드 레일 대체 — sidebar-logo는 폐기
      // 대상(shot_drfix 'count 0' 단언과 동일 계약). 레일 자체의 존재로 브랜드 레일 승계 확인.
      const sbLogo = await page.getByTestId('sidebar-logo').count();
      check('② 사이드바(세션목록 레일) 폐기: sidebar-logo DOM 0', sbLogo === 0, `n=${sbLogo}`);
      const rail = await page.getByTestId('thread-rail').count();
      check('② 좌측 = 스레드 레일 존재 (t_fd869e5b 이관)', rail >= 1, `rail=${rail}`);
      const strip1440 = await page.evaluate(() => document.querySelectorAll('[data-testid="queue-strip"], [data-testid^="queue-chip-"]').length);
      check('③ 1440 채팅도 스트립 DOM 0', strip1440 === 0, `found=${strip1440}`);
      // queue 폴링/WS 단일 상태원천 경로 건재 검증: 발화 후 queue.updated(내용 매칭) → 카드 행 체크포인트 마커.
      // (스트립만 폐기 — 즐겨찾기 딥링크/QueueMessageMark 경로는 살아야 한다, 게이트 '코드 경로 정리' 항목.)
      await page.getByTestId('chat-input').fill('마커 유지 확인');
      await page.getByTestId('send-button').click();
      await sleep(700);
      state.sockets.at(-1)?.send(JSON.stringify({ type: 'queue.updated', session_id: 'source', items: [{ id: 'qm1', content: '마커 유지 확인', status: 'pending', position: 1 }] }));
      const markOk = await page.waitForSelector('[data-testid="queue-mark-qm1"]', { timeout: 6000 }).then(() => true).catch(() => false);
      check('③ 카드 행 체크포인트 마커 유지 (queue WS 경로 건재)', markOk);
      await page.screenshot({ path: shot('d-chat-1440.png') });
      check('Z 1440 런타임 페이지 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));
      await page.close();
    }
    console.log(`\nsmoke_branding_t3c882443 — ${passed} PASS / ${failed} FAIL — ${OUT}`);
    process.exitCode = failed ? 1 : 0;
  } finally { await browser.close(); }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
})().catch((e) => { console.error('FATAL', e); process.exitCode = 2; });
