/**
 * 답변 대기 UI e2e 스모크 — t_363c0faa (백엔드 t_811e176c 계약 착지)
 * 백엔드 없이 run_c_fixtures 인터셉트로 계약 픽스처 렌더 (9/26 교훈: 최소 비용 재현 경로).
 * /pending 라우트는 STATEFUL — 해소 발화 POST 시 백엔드처럼 행을 제거한다 (부트스트랩 pull과
 * WS 스냅샷이 같은 미러로 수렴; 정적 라우트는 보조 pull이 WS를 덮는 정상 경로를 실패로 위장한다 — 9/28 dbg 발견).
 * 검증: ① GET /pending 부트스트랩 → 앱바 '답변 대기' 버튼 + 개수 배지(=2)
 *       ② 탭 → 하단 시트 = 발췌 행 + kind 배지 + 예/아니오 칩(freeform은 칩 없음)
 *       ③ '예' 칩 → POST content='예' 1회, 재탭 중복 발화 0 (요구 3)
 *       ④ 해소 반영 = 배지 1·예/아니오 행 제거 (POST 미러) + '아니오' 추가 회신
 *       ⑤ WS reply.pending.updated count0 = 즉시 해소 스냅샷 반영 → 배지 소멸 + 열려 있던 시트 자동 닫힘
 *       ⑥ freeform 행 탭 = 시트 닫힘 + 해당 카드 점프 하이라이트 + 입력창 키보드 계층 개방
 *       ⑦ GET /pending 404 강등 = 버튼 조용(배지 0) ⑧ EN 라벨 ⑨ 1440 캡처 ⑩ 콘솔 에러 0
 * 실행: (정적서버) node tests/e2e/fr-serve.cjs dist-pending 8116
 *       APP_URL=http://localhost:8116 node tests/e2e/smoke_reply_pending.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8116';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'reply-pending');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
// rich 픽스처의 실제 에이전트 행 id(text/table)를 대기 행으로 쓴다 — freeform 점프가 실카드에서 성립해야 하기 때문.
const BASE_ROWS = () => [
  { message_id: 'text', turn_index: 1, excerpt: '견적서를 먼저 보내도 될까요?', reply_kind: 'yesno' },
  { message_id: 'table', turn_index: 3, excerpt: '인쇄 파일은 어디로 제출할까요?', reply_kind: 'freeform' },
];

async function attachPendingRoute(page, state, rows) {
  await page.route('**/api/sessions/source/pending', (r) => r.fulfill({ json: { ok: true, data: { count: rows.length, items: rows } } }));
  // 해소 미러: content=예/아니오 회신 POST를 가로채 yesno 행 제거 + fixture messages 폴드(하이라이트·스크롤 대상 유지)
  await page.route('**/api/sessions/source/messages', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const body = req.postDataJSON() || {};
    if (body.content === '예' || body.content === '아니오') {
      const idx = rows.findIndex((x) => x.reply_kind === 'yesno');
      if (idx >= 0) rows.splice(idx, 1);
      const env = { ok: true, data: { user_message_id: 'u-resolve', messages: { user: { id: 'u-resolve', role: 'user', content: body.content, turn_index: 99 }, empathy: null, answer: null }, run_id: 'r-resolve' } };
      state.calls.push({ path: '/api/sessions/source/messages', method: 'POST', body });
      return route.fulfill({ json: env });
    }
    return route.fallback();
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ── ①②③④⑤⑥ — 부트스트랩 + 시트 + 예/아니오 + 해소 + freeform 점프 ──
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const state = await installFixtures(page, { rich: true });
    const rows = BASE_ROWS();
    await attachPendingRoute(page, state, rows);
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('chat-appbar').waitFor({ timeout: 8000 });

    const btn = page.getByTestId('pending-open');
    await btn.waitFor({ timeout: 6000 });
    check('부트스트랩 GET /pending → 앱바 답변 대기 버튼', await btn.isVisible());
    const badge = page.getByTestId('pending-count');
    await badge.waitFor({ timeout: 5000 });
    check('배지 = 미해소 개수 2', (await badge.innerText()).includes('2'), await badge.innerText());
    await page.screenshot({ path: shot('01-badge') });

    await btn.click();
    await page.getByTestId('pending-modal').waitFor({ timeout: 5000 });
    check('탭 → 답변 대기 시트 (발췌 행)', (await page.getByTestId('pending-row-text').innerText()).includes('견적서를 먼저 보내도 될까요?'));
    const yesRow = await page.getByTestId('pending-row-text').innerText();
    const freeRow = await page.getByTestId('pending-row-table').innerText();
    check('yesno 행 = 예/아니오 칩 2개', (await page.getByTestId('pending-yes-text').count()) === 1 && (await page.getByTestId('pending-no-text').count()) === 1 && yesRow.includes('예') && yesRow.includes('아니오'));
    check('freeform 행 = 예/아니오 칩 없음(주관식 라벨)', (await page.getByTestId('pending-yes-table').count()) === 0 && freeRow.includes('주관식'));
    await page.screenshot({ path: shot('02-sheet') });

    // ③ 예 칩 → content='예' 전송, 1회 소모
    const before = state.calls.filter((c) => c.path.endsWith('/messages') && c.method === 'POST').length;
    await page.getByTestId('pending-yes-text').click();
    await page.waitForTimeout(600);
    const posts = state.calls.filter((c) => c.path.endsWith('/messages') && c.method === 'POST');
    const yesPost = posts.slice(before).find((c) => c.body && c.body.content === '예');
    check("'예' 탭 → POST content='예'", !!yesPost, JSON.stringify(posts.slice(before).map((c) => c.body && c.body.content)));
    // 1회 소모: 재탭 시도가 가능하면(스냅샷 해소 전) consumed 가드로 차단되고, 이미 해소됐으면 행 자체가 사라진다.
    // 양 경로 모두 '예' POST는 총 1회 — 중복 발화 0건이 요구 3의 본질.
    await page.getByTestId('pending-yes-text').click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(300);
    const dup = state.calls.filter((c) => c.path.endsWith('/messages') && c.method === 'POST' && c.body && c.body.content === '예').length;
    check('1회 소모 — 재탭에서 중복 발화 0건', dup === 1, `count=${dup}`);

    // ④ 해소 반영: yesno 행 제거 → 배지 1, 행 소멸
    await badge.waitFor({ timeout: 5000 });
    check('해소 발화 후 배지 1', (await badge.innerText()).trim() === '1', await badge.innerText());
    check('해소된 yesno 행 = 시트에서 제거', (await page.getByTestId('pending-row-text').count()) === 0);
    await page.screenshot({ path: shot('03-after-yes') });

    // ⑤ WS count0 스냅샷 = 즉시 해소 반영 → 열려 있던 시트 자동 닫힘 + 배지 소멸
    state.sockets.at(-1).send(JSON.stringify({ type: 'reply.pending.updated', session_id: 'source', count: 0, items: [] }));
    await page.waitForTimeout(500);
    check('WS count 0 → 시트 자동 닫힘', (await page.getByTestId('pending-modal').count()) === 0);
    check('배지 소멸 (0 = 렌더 없음)', (await page.getByTestId('pending-count').count()) === 0);
    await page.screenshot({ path: shot('04-resolved') });

    // ⑤b WS 실시간 점화 — 미러(rows=[table])와 동일 항목이라 보조 pull과 수렴 (경합 위장 없음)
    state.sockets.at(-1).send(JSON.stringify({ type: 'reply.pending.updated', session_id: 'source', count: 1, items: [{ message_id: 'table', turn_index: 3, excerpt: '인쇄 파일은 어디로 제출할까요?', reply_kind: 'freeform' }] }));
    await page.waitForTimeout(300);
    check('WS reply.pending.updated 실시간 점화 (배지 1)', (await page.getByTestId('pending-count').innerText()).trim() === '1');

    // ⑥b consumed 가드 결정적 검증 — 미러 없는 pageB: /pending은 항상 1건 고정(POST가 대기를 안 줄임),
    // WS도 해소 없음. '예' 더블탭 후 POST가 1건이면 가드가 실질 작동한 것 (행 잔존 환경에서 재탭 차단).
    const pageB = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const stateB = await installFixtures(pageB, { rich: true });
    await pageB.route('**/api/sessions/source/pending', (r) => r.fulfill({ json: { ok: true, data: { count: 1, items: [BASE_ROWS()[0]] } } }));
    await pageB.goto(APP, { waitUntil: 'networkidle' });
    await pageB.getByTestId('session-card').click();
    await pageB.getByTestId('pending-count').waitFor({ timeout: 6000 });
    await pageB.getByTestId('pending-open').click();
    await pageB.getByTestId('pending-yes-text').click();
    await pageB.waitForTimeout(300);
    await pageB.getByTestId('pending-yes-text').click();
    await pageB.waitForTimeout(300);
    const yesB = stateB.calls.filter((c) => c.path.endsWith('/messages') && c.method === 'POST' && c.body && c.body.content === '예').length;
    check('consumed 가드: 행 잔존 환경에서 더블탭 → POST 1건', yesB === 1, `count=${yesB}`);

    // ── ⑥ freeform 행 탭 = 시트 닫힘 + 카드 점프 하이라이트 + 키보드 입력바 개방 ──
    await page.getByTestId('pending-open').click();
    await page.getByTestId('pending-row-table').click();
    await page.waitForTimeout(900);
    check('freeform 탭 → 시트 닫힘', (await page.getByTestId('pending-modal').count()) === 0);
    check('freeform 탭 → 해당 카드 점프/하이라이트', (await page.getByTestId('focus-highlight').count()) === 1);
    check('freeform 탭 → 키보드 입력바 개방(focus)', await page.getByTestId('chat-input').isVisible());
    await page.screenshot({ path: shot('05-freeform-jump') });

    // ── ⑦ GET /pending 404 (011 미적용 강등) → 버튼 조용·배지 0 ──
    const page2 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    page2.on('pageerror', (e) => errors.push(String(e)));
    await installFixtures(page2);
    await page2.route('**/api/sessions/source/pending', (r) => r.fulfill({ status: 404, json: { ok: false, error: { code: 'NOT_FOUND', message: 'migration 011 not applied' } } }));
    await page2.goto(APP, { waitUntil: 'networkidle' });
    await page2.getByTestId('session-card').click();
    await page2.getByTestId('chat-appbar').waitFor({ timeout: 8000 });
    await page2.waitForTimeout(800);
    check('404 강등 — 버튼은 조용(배지 0)', (await page2.getByTestId('pending-open').count()) === 1 && (await page2.getByTestId('pending-count').count()) === 0);
    await page2.screenshot({ path: shot('06-404-degrade') });

    // ── ⑧ EN 라벨 증거 ──
    const page3 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US', reducedMotion: 'reduce' });
    const state3 = await installFixtures(page3);
    await page3.addInitScript(() => localStorage.setItem('at-language', 'en'));
    await attachPendingRoute(page3, state3, BASE_ROWS());
    await page3.goto(APP, { waitUntil: 'networkidle' });
    await page3.getByTestId('session-card').click();
    await page3.getByTestId('pending-count').waitFor({ timeout: 6000 });
    await page3.getByTestId('pending-open').click();
    await page3.getByTestId('pending-modal').waitFor({ timeout: 5000 });
    const enRow = await page3.getByTestId('pending-row-text').innerText();
    check('EN — kind 배지 Yes/No + Yes/No 버튼', enRow.includes('Yes/No') && enRow.includes('Yes') && enRow.includes('No'), enRow.replace(/\n/g, ' | '));
    await page3.screenshot({ path: shot('07-en') });

    // ── ⑨ 1440 캡처 ──
    const page4 = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const state4 = await installFixtures(page4, { rich: true });
    await attachPendingRoute(page4, state4, BASE_ROWS());
    await page4.goto(APP, { waitUntil: 'networkidle' });
    await page4.getByTestId('session-card').click();
    await page4.getByTestId('pending-count').waitFor({ timeout: 6000 });
    await page4.screenshot({ path: shot('08-desktop-1440') });
    check('1440 캡처 생성', fs.existsSync(shot('08-desktop-1440')));

    check('콘솔 에러 0', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }
  console.log(`\n=== reply_pending smoke: ${passed} PASS / ${failed} FAIL ===`);
  assert.equal(failed, 0, `${failed} 실패`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
