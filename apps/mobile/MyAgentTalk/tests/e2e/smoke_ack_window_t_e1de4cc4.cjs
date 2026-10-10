/**
 * t_e1de4cc4 — ① 스트림 카드 상태문구 2중 줄 봉인 + ② 공감 재질문 예/아니요 칩 발화 가능 창 봉인
 *
 * 대표님 10/10 스크린샷 신고(확인 스레드의 '이거 맞죠? 제 생각엔 ~라는 말씀이신 건대' 복창형
 * + 예/아니오 칩 부재)의 프론트 절반 봉인. 라이브 ON 경로 = 백엔드 실이벤트 순서(read-back:
 * chatTurn.ts/graph.ts): message.new(user) → run.started(placeholder, text='') →
 * message.new(empathy) → [자동예 리드 2.5~2.6s] → answer.delta… → answer.done → message.new(answer).
 *
 *   S1 empathy가 placeholder '후' 도착(ON 경로) → 칩 ≤1.5s 노출 + 창 내 '예' 탭 POST 1회.
 *      (결함 전: streams.some(!done) 억제식이 placeholder부터 true → 각인 영구 미생성 → 미노출.)
 *   S1b 창 활성 중 첫 answer.delta(실토큰) = 억제 소멸 — t_cc232982 요구3 '반쯤 쓰인 카드 금지' 취지 불변.
 *   S1c answer.done = 억제 해제 → 새 창 개시 ≈2.5s 미터치 소진 (t_b2004d50 요구3).
 *   S2 POST 확정 empathy(ack fixture) 단일 창 노출 → ≈2.5s 자동 소진 — 대조/회귀 구간(base도 PASS 기대).
 *   S3 (reduced) 선두 placeholder + queue.updated pending 2건(서버 position 0/1) → '답변 중 ·
 *      대기 1건' 상태문구 카드 내부 DOM 정확히 1회 + testID stream-live-mark=1 — 결함① 봉인.
 *      (결함 전: emptyFallback+live-mark 2회 — 스크린샷 '답변 중' 2줄.)
 *   S4 (reveal ON) 200자+ 재질문 통째-리빌 중에도 칩 ≤1.5s 노출 — 자기(empathy) 리빌 exceptKey 봉인.
 *      (결함 전: 재질문 리빌 ≈10s+가 발화 가능 창(2.5s)을 통째 태워 실질 미노출.)
 *
 * 실행: node tests/e2e/fr-serve.cjs dist-e1d-fix 8130 &
 *       APP_URL=http://localhost:8130 OUT_DIR=tests/e2e/artifacts/ack-window \
 *       node tests/e2e/smoke_ack_window_t_e1de4cc4.cjs
 * 변별 대조 (base=main HEAD 5a9a0f43; S1/S1c/S3/S4 FAIL 기대):
 *       node tests/e2e/fr-serve.cjs dist-e1d-base 8131 &
 *       APP_URL=http://localhost:8131 node tests/e2e/smoke_ack_window_t_e1de4cc4.cjs
 * reduced-motion(e2e 컨텍스트) = 리빌/스트림 연출 OFF 경로 — 서버 원문 즉시 렌더와 1:1.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8130';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'ack-window');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
// 모노토닉 seq — WS 핸들러의 seq 필터(<= lastSeq 드롭)를 통과하게 (랜덤/역행 금지, smoke_streaming 관례)
let SEQ = 100;
const ev = (socket, type, extra = {}) => socket.send(JSON.stringify({ type, session_id: 'source', seq: (SEQ += 1), ...extra }));
const msgNew = (socket, row) => ev(socket, 'message.new', { message: { ...row, session_id: row.session_id || 'source', role: row.role || 'agent', created_at: row.created_at || iso() } });

/** empathy 행 (메인 피드 라이브 경로 — arrivedAt WS 도장 = 앵커는 프론트 수신각) */
const empathyRow = (id, ageMs, text) => ({
  id, role: 'agent', source_neuron: 'empathy', turn_index: 2, content: text,
  created_at: iso(-ageMs),
  structured_payload: { empathy_question: text, template_id: 'eq_confirm', empathy_full: '에코: 원문', empathy_ack: '네, 확인했어요' },
});
const userRow = (id, turn, content, ageMs = 5000) => ({
  id, role: 'user', content, turn_index: turn, created_at: iso(-ageMs),
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const openChat = async (opts = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', ...opts });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page, { ack: true, ...opts.fixtures });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').click();
      await page.getByTestId('chat-appbar').waitFor({ timeout: 10000 });
      await page.waitForTimeout(600); // WS subscribed
      const socket = () => state.sockets.at(-1);
      return { ctx, page, state, errors, socket };
    };
    const waitChips = async (page, ms = 1500) => {
      const t0 = Date.now();
      for (let i = 0; i < Math.ceil(ms / 100); i++) {
        if ((await page.getByTestId('ack-chips').count()) > 0) return Date.now() - t0;
        await sleep(100);
      }
      return -1;
    };
    const waitGone = async (page, ms = 3400) => {
      const t0 = Date.now();
      for (let i = 0; i < Math.ceil(ms / 100); i++) {
        if ((await page.getByTestId('ack-chips').count()) === 0) return Date.now() - t0;
        await sleep(100);
      }
      return -1;
    };

    // ══ 페이지 A: ON 경로 라이브 순서 — placeholder 후 empathy 도착 = 칩 창 (S1/S1b/S1c) ══
    {
      const { ctx, page, state, errors, socket } = await openChat();
      msgNew(socket(), userRow('uws1', 1, '윈도우 프루브 발화 하나'));
      await sleep(300);
      ev(socket(), 'run.started', { run_id: 'r-w1' }); // 선두 런 placeholder (text='' — 억제 대상 아님)
      await sleep(300);
      msgNew(socket(), empathyRow('empW1', 100, '이거 맞죠? 윈도우 프루브 확인입니다')); // ON 경로: empathy는 placeholder 후
      const shownIn = await waitChips(page, 1500);
      check('S1 ON경로 empathy=placeholder 후 도착 → 칩 ≤1.5s 노출 (결함 전=영구 미노출)', shownIn >= 0, `latency=${shownIn}ms`);
      await page.screenshot({ path: shot('s1-chip-window-open') });
      const beforeA = page.locator('no-such'); // placeholder — POST 카운터는 state.calls
      void beforeA;

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
        check('S1c done 창 ≈2.5s 미터치 소진 (≥2.0s)', elapsed >= 2000, `elapsed=${elapsed}ms`);
      }
      // 창 활성 재도입: 새 empathy(신규 앵커) 도착 → 활성 창에서 '예' 탭 POST 1회 — 원계약 '선택창 보여라'의
      // 실질 검증(탭 가능한 노드여야 발화가 성립). 이전 done 스트림은 messages 확정 행으로 즉시 소멸.
      msgNew(socket(), empathyRow('empW1b', 50, '아니요라면 어떻게 할까요? 추가 확인입니다'));
      const tapShown = await waitChips(page, 1500);
      if (tapShown >= 0) {
        const postsBefore = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).length;
        const tap = await page.getByTestId('ack-chip-yes').click({ timeout: 1200 }).then(() => true).catch(() => false);
        await sleep(600);
        const posts = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).slice(postsBefore);
        check("S1d 창 내 '예' 탭 = POST 1회 payload '예' (칩이 실제로 발화 가능해야 함)", tap && posts.length === 1 && posts[0].body && posts[0].body.content === '예', `tap=${tap} posts=${JSON.stringify(posts.map((p) => p.body && p.body.content))}`);
      } else {
        check("S1d 창 내 '예' 탭 = POST 1회 payload '예' (칩이 실제로 발화 가능해야 함)", false, '탭 창 미노출');
      }
      check('A 런타임 JS 예외 0건', errors.length === 0, errors.slice(0, 2).join('|').slice(0, 160));
      await page.screenshot({ path: shot('s1d-after-tap') });
      await ctx.close();
    }

    // ══ 페이지 B: POST 확정 empathy(라이브 도장) 단일 창 ≈2.5s 소진 — 대조/회귀 구간 ══
    {
      const { ctx, page, errors } = await openChat();
      await page.getByTestId('voice-stage-pad').click({ position: { x: 48, y: 32 } }); // →키보드 전환
      await page.getByTestId('chat-input').waitFor({ timeout: 6000 });
      await page.getByTestId('chat-input').click();
      await page.getByTestId('chat-input').fill('윈도우 프루브 발화 둘');
      await page.getByTestId('send-button').click();
      const s2Shown = await waitChips(page, 1500);
      check('S2 POST 확정 empathy → 칩 노출 (base도 PASS — 회귀 대조)', s2Shown >= 0, `latency=${s2Shown}ms`);
      if (s2Shown >= 0) {
        const elapsed = await waitGone(page, 3400);
        check('S2 미터치 ≈2.5s 자동 소진 (2.0~3.4s 대역)', elapsed >= 2000 && elapsed <= 3400, `elapsed=${elapsed}ms`);
      }
      check('B 런타임 JS 예외 0건', errors.length === 0, errors.slice(0, 2).join('|').slice(0, 160));
      await page.screenshot({ path: shot('s2-after-expire') });
      await ctx.close();
    }

    // ══ 페이지 C: 결함① — 선두 실행 placeholder + '대기 1건', 상태문구 1줄 봉인 (실측 2중 줄 재현) ══
    {
      const { ctx, page, errors, socket } = await openChat();
      msgNew(socket(), userRow('uwsA', 1, '윈도우 프루브 발화 셋', 3000)); // 선두 질문
      ev(socket(), 'queue.updated', { items: [
        { id: 'q1', content: '윈도우 프루브 발화 셋', status: 'pending', position: 0, message_id: 'uwsA' },
        { id: 'q2', content: '윈도우 프루브 발화 넷', status: 'pending', position: 1 },
      ] });
      await sleep(300);
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
      check('C 런타임 JS 예외 0건', errors.length === 0, errors.slice(0, 2).join('|').slice(0, 160));
      await page.screenshot({ path: shot('s3-placeholder-single-line') });
      await ctx.close();
    }

    // ══ 페이지 D: 리빌 ON — 재질문 통째-리빌이 칩 창을 태우면 안 된다 (exceptKey 봉인) ══
    {
      const LONG = '이거 맞죠? 윈도우 프루브 긴 재질문 문장을 리빌 지연 검증용으로 늘려서 이백자 내외로 타이핑되게 합니다 리빌이 오래 걸려도 칩은 도착 즉시 떠야 합니다 대표님 계약은 재질문 노출과 동시에 예 아니오 선택창 유지입니다';
      const { ctx, page, errors, socket } = await openChat({ reducedMotion: 'no-preference' });
      msgNew(socket(), userRow('uwsB', 1, '윈도우 프루브 발화 다섯'));
      await sleep(300);
      ev(socket(), 'run.started', { run_id: 'r-w5' });
      msgNew(socket(), empathyRow('empW5', 300, LONG)); // 200자+ → 리빌 ≈10s+ (MAX_BEGIN 240 이하)
      const dShown = await waitChips(page, 1500);
      check('S4 리빌 ON: 긴 재질문 타이핑 중에도 칩 ≤1.5s 노출 (결함 전=리빌 소진까지 억제)', dShown >= 0, `latency=${dShown}ms`);
      check('D 런타임 JS 예외 0건', errors.length === 0, errors.slice(0, 2).join('|').slice(0, 160));
      await page.screenshot({ path: shot('s4-reveal-on-chip') });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  assert.equal(failed, 0, `${failed} checks failed`);
})().catch((e) => { console.error('SMOKE ABORT:', e.message); process.exit(1); });
