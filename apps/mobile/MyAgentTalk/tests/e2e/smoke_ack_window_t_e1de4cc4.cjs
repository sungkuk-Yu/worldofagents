/**
 * t_e1de4cc4 — ① 스트림 카드 상태문구 2중 줄 봉인 + ② 공감 재질문 예/아니요 칩 발화 가능 창 봉인
 *
 * 대표님 10/10 스크린샷 신고 재현. 라이브 ON 경로 = 백엔드 실이벤트 순서(chatTurn.ts/graph.ts read-back):
 *   message.new(user) → run.started(placeholder, text='') → message.new(empathy)
 *   → [자동예 리드 chipProceedMs 2.5~2.6s] → answer.delta → answer.done
 *
 *  페이지 A (reduced-motion; 억제식 결함 봉인):
 *   S1  empathy가 placeholder(run.started) '후' 도착 → 칩 ≤1.5s 노출.
 *       (결함 전: 억제식 streams.some(!s.done)이 text 빈 placeholder부터 억제 → empathy 도착 순간
 *        이미 억제 → 각인 영구 미생성 → delta 전 칩 실질 미노출. base(5a9a0f43) 빌드 = S1 FAIL.)
 *   S1b 창 활성 중 answer.delta(첫 실토큰) = 억제 → 칩 소멸 (t_cc232982 요구3 '반쯤 쓰인 카드 금지' 취지 불변)
 *   S1c answer.done 후 칩 재노출(억제 해제 순간 = 새 창 개시, t_b2004d50 요구3) + ≈2.5s 자동 소진
 *  페이지 B (reduced-motion; POST 확정 empathy 단일 창):
 *   S2  칩 노출 → 미터치 ≈2.5s(2.0~3.4s 대역) 자동 소진 (t_64e3edd6)
 *  페이지 C (reduced-motion; 결함① 2중 줄 봉인 — 스크린샷과 동일 '답변 중 · 대기 1건'):
 *   S3  선두 실행 placeholder + 서버 미매칭 user(WS) 1건 대기 = content='' 구간 상태문구 DOM 정확히 1회
 *       + testID stream-live-mark 카운트=1 (결함 전: emptyFallback+live-mark 동문구 2회 = FAIL)
 *  페이지 D (리빌 ON; exceptKey 봉인 — 재질문 통째-리빌이 칩 창을 태우면 안 된다):
 *   S4  긴 재질문(200자) 리빌 진행 중에도 칩 ≤1.5s 노출 (결함 전: 리빌 ≈16s+ 동안 억제 = FAIL)
 *  S5  전 페이지 런타임 JS 예외 0
 *
 * 실행 (fix 빌드 — 전체 PASS 기대):
 *   npx expo export -p web --output-dir dist-te1de4cc4 --clear
 *   node tests/e2e/fr-serve.cjs dist-te1de4cc4 8121
 *   APP_URL=http://localhost:8121 node tests/e2e/smoke_ack_window_t_e1de4cc4.cjs
 * 변별 대조 (base=main HEAD 5a9a0f43, 무변경 — S1/S3/S4 FAIL 기대):
 *   (main 저장소에서) npx expo export -p web --output-dir dist-te1de4cc4-base --clear
 *   node tests/e2e/fr-serve.cjs dist-te1de4cc4-base 8122
 *   APP_URL=http://localhost:8122 node tests/e2e/smoke_ack_window_t_e1de4cc4.cjs
 */
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8121';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'ack-window-te1de4cc4');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
let SEQ = 1;
const ev = (sock, type, extra) => sock.send(JSON.stringify({ type, session_id: 'source', seq: SEQ++, ...extra }));
const msgNew = (sock, row) => ev(sock, 'message.new', { message: row });
const empathyRow = (id, turnIndex, content) => ({
  id, session_id: 'source', role: 'agent', source_neuron: 'empathy', turn_index: turnIndex,
  content, created_at: new Date().toISOString(),
  structured_payload: { empathy_question: content, template_id: 'eq_confirm', empathy_ack: '네, 확인했어요' },
});
async function waitChips(page, timeout = 1500) {
  const t0 = Date.now();
  for (;;) {
    if ((await page.getByTestId('ack-chips').count()) > 0) return Date.now() - t0;
    if (Date.now() - t0 > timeout) return -1;
    await sleep(100);
  }
}
async function waitGone(page, timeoutMs = 3800) {
  const t0 = Date.now();
  for (;;) {
    if ((await page.getByTestId('ack-chips').count()) === 0) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) return -1;
    await sleep(100);
  }
}
async function openChat(browser, errors, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, { ack: true, gateSend: !!opts.gateSend });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
  for (let i = 0; i < 60 && !state.sockets.length; i++) await sleep(100);
  return { ctx, page, state, socket: () => state.sockets.at(-1) };
}
async function send(page, text) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('send-button').click();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];
  try {
    // ══ 페이지 A: ON 경로 실순서 user→run.started(placeholder)→empathy — 억제식 봉인 ══
    {
      const { ctx, page, state, socket } = await openChat(browser, errors, { gateSend: true });
      await send(page, '윈도우 프루브 발화 하나'); // POST1 gate 보류 (실행 중 재현)
      await sleep(300);
      ev(socket(), 'run.started', { run_id: 'r-w1' });
      await sleep(300); // placeholder 자리 확보 (text='' — 억제 대상 아님)
      msgNew(socket(), empathyRow('empW1', 100, '이거 맞죠? 윈도우 프루브 확인입니다')); // ON 경로: empathy는 placeholder 후 도착
      const shownIn = await waitChips(page, 1500);
      check('S1 ON경로 empathy=placeholder 후 도착 → 칩 ≤1.5s 노출 (결함 전=영구 미노출)', shownIn >= 0, `latency=${shownIn}ms`);
      await page.screenshot({ path: shot('s1-chip-window-open') });

      // S1b: 창 활성 중 첫 실토큰 delta = 억제 (t_cc232982 요구3 취지 불변)
      ev(socket(), 'answer.delta', { run_id: 'r-w1', delta: '부분 답변이 흘러갑니다', index: 0 });
      const bGone = await waitGone(page, 1200);
      check('S1b 첫 answer.delta(실토큰) = 억제 → ≤1.2s 칩 소멸', bGone >= 0, `elapsed=${bGone}ms`);

      // S1c: answer.done = 억제 해제 → 새 창 개시 + 미터치 소진
      ev(socket(), 'answer.done', { run_id: 'r-w1', message_id: 'ans-r-w1', text: '윈도우 프루브 답변 확정' });
      const cShown = await waitChips(page, 1500);
      check('S1c answer.done 후 칩 재노출 — 억제 해제 순간이 창 개시', cShown >= 0, `latency=${cShown}ms`);
      if (cShown >= 0) {
        const elapsed = await waitGone(page, 3800);
        check('S1c done 창 ≈2.5s 미터치 소진 (2.0~3.8s 대역)', elapsed >= 2000, `elapsed=${elapsed}ms`);
      }
      await page.screenshot({ path: shot('s1c-after-done-expire') });
      await ctx.close();
    }

    // ══ 페이지 B: POST 확정 empathy(라이브 도장) 단일 창 ≈2.5s 소진 ══
    {
      const { ctx, page } = await openChat(browser, errors);
      await send(page, '윈도우 프루브 발화 둘');
      const s2Shown = await waitChips(page, 1500);
      check('S2 POST 확정 empathy → 칩 노출', s2Shown >= 0, `latency=${s2Shown}ms`);
      if (s2Shown >= 0) {
        const elapsed = await waitGone(page, 3400);
        check('S2 미터치 ≈2.5s 자동 소진 (2.0~3.4s 대역)', elapsed >= 2000 && elapsed <= 3400, `elapsed=${elapsed}ms`);
      }
      await page.screenshot({ path: shot('s2-after-expire') });
      await ctx.close();
    }

    // ══ 페이지 C: 결함① — 선두 실행 placeholder + 대기 1건, 상태문구 1줄 봉인 ══
    {
      const { ctx, page, socket } = await openChat(browser, errors, { gateSend: true });
      await send(page, '윈도우 프루브 발화 셋'); // POST 보류 = 선두 unanswered (실행 중 재현)
      await sleep(300);
      msgNew(socket(), { id: 'uws2', session_id: 'source', role: 'user', content: '윈도우 프루브 발화 넷', turn_index: 4, created_at: new Date().toISOString() });
      ev(socket(), 'run.started', { run_id: 'r-w3' }); // 첫 delta 전 placeholder
      await sleep(500);
      const card = page.getByTestId('stream-card-r-w3');
      check('S3-0 placeholder 카드 자리 확보', (await card.count()) === 1);
      const st = await card.evaluate((el) => {
        const txt = el.textContent || '';
        return { status: (txt.match(/답변 중/g) || []).length, live: el.querySelectorAll('[data-testid="stream-live-mark"]').length };
      });
      check('S3 카드 내부 상태문구 DOM 정확히 1회 (결함 전=emptyFallback+live-mark 2회)', st.status === 1, `status=${st.status}`);
      check('S3 testID stream-live-mark 카운트=1', st.live === 1, `live=${st.live}`);
      await page.screenshot({ path: shot('s3-placeholder-single-line') });
      await ctx.close();
    }

    // ══ 페이지 D: 리빌 ON — 재질문 통째-리빌이 칩 창을 태우면 안 된다 (exceptKey 봉인) ══
    {
      const LONG = '이거 맞죠? 윈도우 프루브 긴 재질문 문장을 리빌 지연 검증용으로 늘려서 이백자 내외로 타이핑되게 합니다 리빌이 오래 걸려도 칩은 도착 즉시 떠야 합니다 대표님 계약은 재질문 노출과 동시에 예 아니오 선택창 삼초입니다';
      const { ctx, page, socket } = await openChat(browser, errors, { reducedMotion: 'no-preference', gateSend: true });
      await send(page, '윈도우 프루브 발화 다섯');
      await sleep(300);
      ev(socket(), 'run.started', { run_id: 'r-w5' });
      msgNew(socket(), empathyRow('empW5', 300, LONG)); // 200자+ → 리빌 ≈10s+ (MAX_BEGIN 240 이하)
      const dShown = await waitChips(page, 1500);
      check('S4 리빌 ON: 긴 재질문 타이핑 중에도 칩 ≤1.5s 노출 (결함 전=리빌 소진까지 억제)', dShown >= 0, `latency=${dShown}ms`);
      await page.screenshot({ path: shot('s4-reveal-on-chip') });
      await ctx.close();
    }

    check('S5 런타임 JS 예외 0건', errors.length === 0, errors.slice(0, 2).join('|').slice(0, 160));
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  assert.equal(failed, 0, `${failed} checks failed`);
})().catch((e) => { console.error('SMOKE ABORT:', e.message); process.exit(1); });
