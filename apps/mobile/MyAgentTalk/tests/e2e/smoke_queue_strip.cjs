/**
 * 상단 질문 큐 스트립 e2e 스모크 — t_2f45ccb1
 * 백엔드 없이 run_c_fixtures 인터셉트로 계약 픽스처 렌더 (메모리 최소 토큰 경로, 9/26 교훈).
 * 검증: ① 서버 큐 스냅샷 4건 → 스트립 표시(3초과 = 스크롤, 배지 없음) ② 상태 아이콘 3종+원문 라벨
 *       ③ answered 칩 탭 → 답변 카드 하이라이트 ④ GET /queue 404 폴백 → 메시지 로컬 유도 스트립
 *       ⑤ 빈 세션(질문 0) → 스트립 DOM 부재(빈 회색 바 금지)
 * 실행: (정적서버) python3 -m http.server 8096 --bind 127.0.0.1 -d dist-queue
 *       APP_URL=http://localhost:8096 node tests/e2e/smoke_queue_strip.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8096';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'queue-strip');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const QUEUE_ROWS = [
  { id: 'q1', content: '이번 분기 매출 요약을 먼저 정리해줘', status: 'answered', position: 1 },
  { id: 'q2', content: '그 다음 경쟁사 가격표도 비교 부탁해요', status: 'answered', position: 2 },
  { id: 'q3', content: '마지막으로 견적서 초안 만들어줄 수 있어?', status: 'skipped', position: 3 },
  { id: 'q4', content: '아 그리고 주간 리포트 템플릿도', status: 'pending', position: 4 },
];
(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const state = await installFixtures(page);
    // 서버 큐 스냅샷 라우트 (t_344e047a 계약 행) — messages가 []여도 스트립은 큐에서 선다.
    await page.route('**/api/sessions/source/queue', (r) => r.fulfill({ json: { ok: true, data: QUEUE_ROWS } }));
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();

    // ── ① 표시 · ② 라벨/아이콘 · ④ 폴백 아님(서버 큐 있음) ──
    await page.getByTestId('queue-strip').waitFor({ timeout: 8000 });
    const stripBox = await page.getByTestId('queue-strip').boundingBox();
    check('서버 큐 4건 스트립 표시', !!stripBox && stripBox.height > 0 && stripBox.height < 80, `h=${stripBox && Math.round(stripBox.height)}`);
    for (const [i, row] of QUEUE_ROWS.entries()) {
      check(`칩 ${i + 1} 원문 라벨`, await page.getByTestId(`queue-label-${row.id}`).isVisible(), row.content.slice(0, 12));
    }
    // 4개 칩 중 answered 2종 svg 노출 (path count 검증 — 이모지 텍스트 아님)
    const svgCount = await page.getByTestId('queue-strip').locator('svg').count();
    check('상태 아이콘은 SVG (3종 이상)', svgCount >= 4, `svg=${svgCount}`);
    // 3건 초과 → 개수 배지 없이 스크롤 (스크롤 폭 ≥ 뷰포트 폭)
    const trackW = await page.getByTestId('queue-strip').locator('div').first().evaluate((el) => el.scrollWidth);
    const viewW = await page.getByTestId('queue-strip').locator('div').first().evaluate((el) => el.clientWidth);
    check('4건 = 좌우 스크롤 (배지 없음)', trackW > viewW, `scroll=${trackW} view=${viewW}`);
    check('개수 배지 금지', (await page.getByTestId('queue-strip').getByText(/\d+\s*건/).count()) === 0);
    await page.screenshot({ path: shot('01-strip-4chips') });

    // ── ③ answered 칩 탭 → 해당 카드로 점프+하이라이트 ──
    // q1은 messages에 매칭 행이 없어(로컬 유도 [] + 서버 전용 칩) 점프 대상 없음 — 점프는 메시지 매칭 칩에서 검증하므로
    // 폴백 시나리오(④)에서 메시지 기반 answered 칩 탭을 검증한다. 여기서는 WS queue.updated 실시간 갱신 확인:
    state.sockets.at(-1).send(JSON.stringify({ type: 'queue.updated', session_id: 'source', items: QUEUE_ROWS.slice(0, 3) }));
    await page.waitForTimeout(300);
    check('WS queue.updated 즉시 반영 (3건)', await page.getByTestId('queue-chip-q3').isVisible() && (await page.getByTestId('queue-chip-q4').count()) === 0);

    // ── ④ GET /queue 404 → 메시지 로컬 유도 스트립 ──
    const page2 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const state2 = await installFixtures(page2);
    await page2.route('**/api/sessions/source/queue', (r) => r.fulfill({ status: 404, json: { ok: false, error: { code: 'NOT_FOUND', message: 'route not landed' } } }));
    await page2.goto(APP, { waitUntil: 'networkidle' });
    await page2.getByTestId('session-card').click();
    await page2.waitForTimeout(400);
    check('빈 세션 = 스트립 DOM 부재 (0건 완전 숨김)', (await page2.getByTestId('queue-strip').count()) === 0);
    // 전송 → 응답: 폴백 로컬 유도(서버 큐 없음)로 answered 1건 표시
    await page2.getByTestId('chat-input').fill('질문 큐 테스트 발화');
    await page2.getByTestId('send-button').click();
    await page2.getByText('Test reply to 질문 큐 테스트 발화', { exact: true }).waitFor({ timeout: 8000 });
    await page2.getByTestId('queue-strip').waitFor({ timeout: 5000 });
    const chip = page2.locator('[data-testid^="queue-chip-"]');
    check('404 폴백: 메시지 로컬 유도 스트립', (await chip.count()) === 1);
    const label = await page2.locator('[data-testid^="queue-label-"]').first().innerText();
    check('원문 라벨 = 질문 전문', label.includes('질문 큐 테스트 발화'), label);
    await page2.screenshot({ path: shot('02-local-fallback') });
    // answered 칩 탭 → 답변 카드 하이라이트 + 스크롤
    await chip.first().click();
    await page2.getByTestId('focus-highlight').waitFor({ timeout: 4000 });
    check('칩 탭 → 카드 점프 + 하이라이트', await page2.getByTestId('focus-highlight').isVisible());
    await page2.screenshot({ path: shot('03-chip-jump') });

    // ── ⑤ EN 라벨 증거 — en-US 브라우저에서 서버 큐 스냅샷 칩(미매칭 행) 표시 ──
    const page3 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
    page3.on('pageerror', (e) => errors.push(String(e)));
    await installFixtures(page3); // fixture가 at-language=ko를 먼저 심음 → 그 뒤에 등록해야 덮어씀
    await page3.addInitScript(() => localStorage.setItem('at-language', 'en'));
    await page3.route('**/api/sessions/source/queue', (r) => r.fulfill({ json: { ok: true, data: [
      { id: 'e1', content: '오늘 이슈 요약', status: 'pending', position: 1 },
      { id: 'e2', content: '어제 내용 정리', status: 'answered', position: 2 },
    ] } }));
    await page3.goto(APP, { waitUntil: 'networkidle' });
    await page3.getByTestId('session-card').click();
    await page3.getByTestId('queue-strip').waitFor({ timeout: 8000 });
    const enAria = await page3.locator('[data-testid="queue-chip-e1"]').getAttribute('aria-label');
    check('EN 상태 라벨 병기 — chipAria 영어 문자열', !!enAria && enAria.includes('Waiting for a reply') && !enAria.includes('답변'), String(enAria));
    await page3.screenshot({ path: shot('04-en-labels') });
    check('런타임 오류 없음', errors.length === 0, errors.slice(0, 2).join('|'));
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} passed, ${failed} failed → ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
