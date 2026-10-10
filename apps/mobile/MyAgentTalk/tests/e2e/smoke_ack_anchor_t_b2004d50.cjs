/**
 * t_b2004d50 — 칩 창 앵커 회귀 스모크 (서버 created_at → 프론트 최초 수신/노출 각도)
 * 김비서 판정(9/30, 볼트 2026-09-30): empathy created_at = 턴 시작 스탬프(user와 동일)인데
 * 발행은 런 종료 시(t_888c1669 실측 +144s) — 렌더 순간 2.5s 창이 이미 소진돼 예/아니요
 * 발화 가능 창이 실질 0. 오프라인 LLM 없이 WS 주입으로 이 실패 모드를 결정적 재현:
 *   A. created_at 35s 선버링 empathy를 WS message.new로 주입 → 도착 즉시(≤1.5s) 칩 노출.
 *      (구 앵커: now-created=35s > 2.5s → 영원히 미노출. 이 스모크가 dist-t888c1669에서
 *       A FAIL / 신 빌드 PASS — AC8 결정적 분기. 구 빌드 대조 실행법은 아래.)
 *   C. A의 창 안에서 '예' 탭 → POST 1회(body='예') + ack 결과 user 카드 미렌더(숨김 유지).
 *   B. 탭 응답으로 온 새 empathy 칩도 미터치 시 ≈2.5s(+틱 유예) 자동 소진 — 수명 규칙 불변.
 *   F. 소진 후 같은 id 재주입(WS 재구독 버스트 상당) → 재점등 없음(단일 도장+id dedupe).
 *   E. 스트리밍 중 도착 = 억제(t_cc232982 요구3) → answer.done '후' 표시 — 창은 수신각이
 *      아니라 노출 가능 각도에서 열린다(unit ③의 e2e 쌍). done 후 ≈2.5s 소진.
 *   D. reload = 히스토리 재현(배치 GET, arrivedAt 미스탬프) → seed stale empathy 포함 무버튼.
 * 실행 (신 빌드 — 전체 PASS 기대):
 *   expo export -p web --output-dir dist-tb2004d50 --clear   (본 스모크는 EXPO_PUBLIC_* 미요구 — API 주입 차단)
 *   node tests/e2e/fr-serve.cjs dist-tb2004d50 8113
 *   node tests/e2e/smoke_ack_anchor_t_b2004d50.cjs          (APP_URL/OUT_DIR 오버라이드 가능)
 * 구 빌드 대조 (A·B·C·E FAIL 또는 미노출 / D PASS — 결함 재현 증명):
 *   node tests/e2e/fr-serve.cjs dist-t888c1669 8214
 *   APP_URL=http://localhost:8214 node tests/e2e/smoke_ack_anchor_t_b2004d50.cjs
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8113';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'ack-anchor-tb2004d50');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
// WS 이벤트 주입 — 백엔드 protocol.ts 실형태 (session 'source', seq 단조 증가, message.new row 평면)
let SEQ = 1;
const msgNew = (sock, row) => sock.send(JSON.stringify({ type: 'message.new', session_id: 'source', seq: SEQ++, message: row }));
/** 칩 등장까지 소요(ms), timeout 내 미등장 시 -1 */
async function waitChips(page, timeout = 1500) {
  const t0 = Date.now();
  for (;;) {
    if ((await page.getByTestId('ack-chips').count()) > 0) return Date.now() - t0;
    if (Date.now() - t0 > timeout) return -1;
    await sleep(120);
  }
}
async function openChat(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, { ack: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
  const socket = () => state.sockets.at(-1);
  for (let i = 0; i < 40 && !socket(); i++) await sleep(100);
  return { ctx, page, state, errors, socket };
}
const empathyRow = (id, ageMs, turnIndex, extra = {}) => {
  // t_a7b39e0f: content는 백엔드 eq_confirm 포맷 미러와 문자 동일 합성 — 구 복창 접두 서식 폐기(t_51f9fd01) 반영.
  const q = require('./empathyPool.generated.cjs');
  const text = q.pool.find((x) => x.id === 'eq_confirm').ko.split('{요약}').join(q.summary(`앵커-프루브-${id}`));
  return {
    id, session_id: 'source', role: 'agent', source_neuron: 'empathy', turn_index: turnIndex,
    content: text, created_at: new Date(Date.now() - ageMs).toISOString(),
    structured_payload: { empathy_question: text, template_id: 'eq_confirm', empathy_ack: '네, 확인했어요' }, ...extra,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const { page, state, errors, socket } = await openChat(browser);

    // 진입 직전: seed(stale 9/26) 공감 행 = 무버튼 (smoke_ack_chips ⑦과 동일 회귀 가드)
    check('D0 진입 시드 stale 공감 행 무버튼', (await page.getByTestId('ack-chips').count()) === 0);

    // ── A. 선버링 created_at + 라이브 도착 → 즉시 노출 (t_888c1669 F 실패 모드 재현) ──
    msgNew(socket(), empathyRow('empA', 35000, 3));
    const shownIn = await waitChips(page, 1500);
    check('A created_at 35s 선버링 empathy WS 도착 → ≤1.5s 내 칩 노출 (구 앵커=영원 미노출)', shownIn >= 0, `latency=${shownIn}ms`);
    await page.screenshot({ path: path.join(OUT, 'A-arrived-chips.png') });

    // ── C. 창 내 '예' 탭 → POST 1회 + 결과 user 카드 숨김 ──
    const beforePosts = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).length;
    const beforeUser = await page.getByTestId('message-user').count();
    const tapped = shownIn >= 0 ? (await page.getByTestId('ack-chip-yes').click({ timeout: 1500 }).then(() => true).catch(() => false)) : false;
    check('C0 탭 성공 (발화 가능 창 실질 >0 — 대표님 불만 직접 교정)', tapped);
    await sleep(700);
    const posts = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).slice(beforePosts);
    check("C1 '예' 탭 → POST 1회 body='예'", posts.length === 1 && posts[0].body && posts[0].body.content === '예', `posts=${JSON.stringify(posts.map((p) => p.body && p.body.content))}`);
    const afterUser = await page.getByTestId('message-user').count();
    check('C2 ack 결과 user 카드 미렌더(낙관+서버 에코 숨김)', afterUser <= beforeUser, `before=${beforeUser} after=${afterUser}`);
    await page.screenshot({ path: path.join(OUT, 'C-after-tap.png') });

    // ── B. 탭 응답 empathy(신규 라이브) 칩 → 미터치 ≈2.5s 소진 ──
    const bShown = await waitChips(page, 6000);
    check('B 탭 응답의 새 empathy 칩 노출(POST 확정 = 라이브 도장)', bShown >= 0, `latency=${bShown}ms`);
    if (bShown >= 0) {
      const t0 = Date.now();
      let gone = false;
      for (let i = 0; i < 34 && !gone; i++) { await sleep(100); gone = (await page.getByTestId('ack-chips').count()) === 0; }
      const elapsed = Date.now() - t0;
      check('B 미터치 자동 소진 ≈2.5s (3.5s 유예 내)', gone, `elapsed=${elapsed}ms`);
      // ── F. 같은 id 재주입(재구독 버스트 상당) → 재점등 없음 ──
      msgNew(socket(), empathyRow('empA', 35000, 3));
      await sleep(800);
      check('F 소진 행 id 재주입 → 재점등 없음', (await page.getByTestId('ack-chips').count()) === 0);
    }

    // ── E. 스트리밍 중 도착 억제 → done 후 표시 + done 기준 소진 ──
    socket().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'r-str', delta: '작성 중', index: 0, seq: SEQ++ }));
    // turn_index 8 = 탭 POST가 만든 user5/emp6/answer7 위로 최신 공감 — 안 그러면 소진된 emp6가 '마지막 공감'으로 남아 미노출
    msgNew(socket(), empathyRow('empE', 35000, 8)); // 스트리밍 중 선버링 empathy 도착·도장
    await sleep(1500);
    check('E 스트리밍 중 = 억제 (t_cc232982 요구3)', (await page.getByTestId('ack-chips').count()) === 0);
    socket().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'r-str', seq: SEQ++, text: '앵커-프루브 답변 확정', message_id: 'ans-r-str' }));
    const eShown = await waitChips(page, 1500);
    check('E answer.done 후 칩 표시 — 창은 노출 가능 각도에서 열린다', eShown >= 0, `latency=${eShown}ms`);
    if (eShown >= 0) {
      const t0 = Date.now();
      let gone = false;
      for (let i = 0; i < 34 && !gone; i++) { await sleep(100); gone = (await page.getByTestId('ack-chips').count()) === 0; }
      check('E done 후 ≈2.5s 미터치 소진 (수신각+억제 시간 ≠ 즉시 소진)', gone, `elapsed=${Date.now() - t0}ms`);
    }
    await page.screenshot({ path: path.join(OUT, 'E-after-done.png') });

    // ── G. ON 경로(t_f46d1d7a empathyEarly) 실주문 시뮬레이션: empathy가 run.started/delta
    //    '전에' 도착( Brief: onEmpathyEarly → onRunReady 순 ) — 잠깐 노출→각인된다면, 이후
    //    긴 스트리밍 억제 구간이 그 각인을 폐기하고 done 순간이 새 창 개시가 되어야 한다
    //    (보정 전 결함: 초기 각인이 150s 스트리밍에 타서 done 후 칩 영구 미노출 = F 구조 실패).
    msgNew(socket(), empathyRow('empG', 120000, 9)); // created 120s 전(턴 시작), 지금 미억제 도착·도장
    const gPre = await waitChips(page, 1500); // 억제 전이라 즉시 노출(도장 앵커)
    check('G-1 미억제 empathy 도착 = 노출 (ON 경로 run.started 전)', gPre >= 0, `latency=${gPre}ms`);
    socket().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'r-early', delta: '초안', index: 0, seq: SEQ++ }));
    await sleep(1500); // 스트리밍 억제 = 초기 각인 폐기 구간
    check('G-2 스트리밍 진입 = 억제(초기 각인 소멸)', (await page.getByTestId('ack-chips').count()) === 0);
    socket().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'r-early', seq: SEQ++, text: '앵커-프루브 G 확정', message_id: 'ans-r-early' }));
    const gShown = await waitChips(page, 1500);
    check('G-3 done 직후 칩 재노출 — 초기 각인 무효화 후 done 각인 = 새 창 개시', gShown >= 0, `latency=${gShown}ms`);
    if (gShown >= 0) {
      const beforeG = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).length;
      const tapG = await page.getByTestId('ack-chip-yes').click({ timeout: 1200 }).then(() => true).catch(() => false);
      await sleep(600);
      const postsG = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).slice(beforeG);
      check("G-4 done 창 내 '예' 탭 성공 → POST 1회 (ON 기본화 시 F 발화 가능 창 보장)", tapG && postsG.length === 1 && postsG[0].body && postsG[0].body.content === '예', `tap=${tapG} posts=${JSON.stringify(postsG.map((p) => p.body && p.body.content))}`);
    }
    await page.screenshot({ path: path.join(OUT, 'G-on-early-window.png') });

    // ── D. reload = 히스토리 재현 → 무버튼 (미도장 + created 경화 이중 안전망) ──
    await sleep(400);
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(1200);
    await page.getByTestId('session-card').click();
    await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
    await sleep(800);
    const feedHasEmp = await page.getByTestId('message-list').innerText();
    check('D reload 후 공감 재질문 카드 재현됨(전제)', /앵커-프루브|이전 질문 복창/.test(feedHasEmp));
    check('D reload 히스토리 재현 = 무버튼 (재진입 재점등 금지)', (await page.getByTestId('ack-chips').count()) === 0);
    await page.screenshot({ path: path.join(OUT, 'D-reload-no-chips.png') });

    check('Z 런타임 JS 예외 0건', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 160));
  } finally {
    await browser.close();
    console.log(`\nRESULT ack-anchor-t_b2004d50: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
