/**
 * t_1731f0f6 — 텔레그램식 꼬리 추종 회귀 스모크 (대표님 9/29: "새 카드 발동 시 그 카드로,
 * 글이 길어지면 그 끝으로. 위로 스크롤해 읽는 중이면 강제이동 금지 + unseen 배지")
 *
 * 검증 (카드 body + 김비서 적용 게이트 t_c6cbcd53 반영):
 *  ① 스트리밍 추종: answer.delta 누적(콘텐츠 grow) 중 bottom gap ≤110px 유지(추종),
 *    delta 구간엔 unseen 배지 오탐 없음(라이브 증상 root cause — stale 쌍 전향 회귀).
 *  ② 읽는 중 이탈: 위로 스크롤(scrollTop 감소=이탈 신호) 후 delta지속 → 강제이동 없음.
 *    확정 message.new 발행 시에만 배지 발동(메시지 추가 = arrival), 배지 탭 → 말미 정착+소멸.
 *  ③ 최종 카드/칩이 하단 UI 경계(voice-stage strip 또는 입력바) 위에 안착 — 패딩 클램프(요구 C).
 *  ④ 예/아니오(공감 재질문 실시간 행 + ack-chips) 등장 성장 → 추종, 칩이 경계에 안 가림.
 *
 * 백엔드 없이 run_c_fixtures WS 인터셉트로 answer.delta/message.new 계약(백엔드
 * websocket/protocol.ts 규격) 주입 — 메모리 최소 토큰 경로 (9/26 교훈).
 *
 * 실행: node tests/e2e/fr-serve.cjs dist-tail 8166 &
 *       APP_URL=http://localhost:8166 node tests/e2e/smoke_tail_follow.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8166';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'tail-follow');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

// 스크롤 박스 bottom gap + 마지막 카드/하단 경계(strip 또는 키보드 입력바) 지오메트리 한 덩어리.
// gap = scrollHeight - scrollTop - clientHeight (측정 기반 bottom clamp 타깃과 동일 산식).
async function tailGeometry(page) {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="message-list"]');
    const cards = Array.from(document.querySelectorAll('[data-testid="message-agent"],[data-testid="message-user"]'));
    const edgeEl = document.querySelector('[data-testid="voice-stage"]')
      || document.querySelector('[data-testid="chat-input-bar"]')
      || (document.querySelector('[data-testid="chat-input"]') ? document.querySelector('[data-testid="chat-input"]').closest('div[class]') : null);
    let lastCard = null;
    if (list && cards.length) {
      const lr = list.getBoundingClientRect();
      // 웹 FlatList 유령 행(리사이클 후 뷰포트 밖 잔존) 제외 — 보이는 행만 스코프 (9/27 교훈)
      const visible = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > lr.top + 1 && r.top < lr.bottom - 1; });
      const pool = visible.length ? visible : cards;
      lastCard = pool.reduce((a, b) => (a.getBoundingClientRect().bottom >= b.getBoundingClientRect().bottom ? a : b));
    }
    const lc = lastCard ? lastCard.getBoundingClientRect() : null;
    return {
      gap: list ? Math.round(list.scrollHeight - list.scrollTop - list.clientHeight) : null,
      scrollTop: list ? Math.round(list.scrollTop) : null,
      scrollable: list ? list.scrollHeight - list.clientHeight > 4 : false,
      lastCardBottom: lc ? Math.round(lc.bottom) : null,
      edgeTop: edgeEl ? Math.round(edgeEl.getBoundingClientRect().top) : null,
      badge: !!document.querySelector('[data-testid="unseen-badge"]'),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    let postCount = 0, seq = 100;

    // POST 응답: user 행만 확정 — run_id 생략(백엔드는 WS run.*이 REST 응답보다 먼저 도착하나,
    // 픽스처는 사후 주입이라 run_id를 넣으면 coordinator가 턴을 선종료해 타이핑 카드가 못 뜬다).
    const stubPost = async (page) => {
      await page.route('**/api/sessions/source/messages', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const n = ++postCount;
        const content = (route.request().postDataJSON() || {}).content || '';
        return route.fulfill({ json: { ok: true, data: { user_message_id: 'u' + n, messages: { user: { id: 'u' + n, role: 'user', content, turn_index: 10 * n, created_at: new Date().toISOString() }, empathy: null, answer: null } } } });
      });
    };
    const openSession = async (page) => {
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').first().click();
      await page.getByTestId('message-list').waitFor({ timeout: 10000 });
      await page.waitForTimeout(500);
    };
    const waitSocket = async (state) => {
      for (let i = 0; i < 60 && !state.sockets.at(-1); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(state.sockets.at(-1), 'WS 소켓 미확보');
      return state.sockets.at(-1);
    };

    // ══ ①②③ 스트리밍 추종 + 이탈 + 배지 탭 (390x844 웹 모바일) ══
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const state = await installFixtures(page);
    await stubPost(page); // installFixtures보다 늦게 등록 → 우선 매칭, GET은 fallback
    await openSession(page);
    const sock = await waitSocket(state);
    const send = (obj) => sock.send(JSON.stringify({ session_id: 'source', ...obj }));

    // 시드 히스토리 5행(~3000px) — 스트리밍 확정 후에도 리스트가 스크롤 가능하게 (배지 시나리오 전제)
    for (let i = 0; i < 5; i++) {
      send({ type: 'message.new', seq: 1 + i, message: { id: 'seed' + i, role: 'agent', content: `시드 히스토리 ${i} — 검토 메모입니다. `.repeat(28), turn_index: i, created_at: new Date(Date.now() - 90000 + i * 1000).toISOString() } });
    }
    await page.waitForTimeout(400);
    let gs = await tailGeometry(page);
    check('시드 히스토리 적재 — 스크롤 가능', gs.scrollable && gs.gap <= 110, `scrollable=${gs.scrollable} gap=${gs.gap}`);

    await openKeyboardIfVoice(page);
    await page.getByTestId('chat-input').fill('꼬리추종 테스트 발화입니다');
    await page.getByTestId('send-button').click();
    await page.waitForTimeout(400);
    let g = await tailGeometry(page);
    check('① 전송 후 낙관 user 카드 말미 앵커', !g.scrollable || g.gap <= 40, `gap=${g.gap} scrollable=${g.scrollable}`);

    send({ type: 'run.started', run_id: 'run1', seq: ++seq });
    await page.getByTestId('typing-indicator').waitFor({ timeout: 5000 });

    // answer.delta 24조각 — 뷰포트 초과까지 성장, 매 조각 후 gap 샘플링
    const mkChunk = (i) => `꼬리추종 스트리밍 조각 ${i + 1} — 제${i + 1}조 위약금 조항을 검토한 결과 지연 이자 상한과 중재지 규정이 불명확합니다. 보완이 필요합니다. `.repeat(3);
    const gaps = [];
    for (let i = 0; i < 24; i++) {
      send({ type: 'answer.delta', run_id: 'run1', delta: mkChunk(i), index: i, seq: ++seq });
      await page.waitForTimeout(55); // 백개발 delta 리듬(50–100ms) 근사
      if (i % 4 === 3) gaps.push((await tailGeometry(page)).gap);
    }
    g = await tailGeometry(page);
    check('① 스트리밍 중 추종 — bottom gap 항상 ≤110px', g.scrollable && gaps.every((x) => x <= 110) && g.gap <= 110, `samples=${gaps.join(',')}`);
    check('① delta 구간 unseen 배지 오탐 없음 (root cause 회귀)', g.badge === false);
    await page.screenshot({ path: shot('01-streaming-follow') });

    // ② 읽는 중: 위로 스크롤(오프셋 실질 감소 = 이탈 신호) → delta 지속 → 강제이동 없음
    await page.evaluate(() => { const l = document.querySelector('[data-testid="message-list"]'); l.scrollTop = Math.max(0, l.scrollTop - 900); });
    await page.waitForTimeout(300);
    const before = await tailGeometry(page);
    for (let i = 24; i < 32; i++) {
      send({ type: 'answer.delta', run_id: 'run1', delta: mkChunk(i), index: i, seq: ++seq });
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(500);
    const after = await tailGeometry(page);
    check('② 읽는 중 delta에도 강제이동 없음(scrollTop 유지)', Math.abs(after.scrollTop - before.scrollTop) < 40, `before=${before.scrollTop} after=${after.scrollTop}`);
    check('② delta만으론 배지 없음(메시지 추가 아님) — 확정 전', after.badge === false);
    await page.screenshot({ path: shot('02-reading-stream') });

    // 확정 카드 발행 = arrival. seq는 delta 시퀀스보다 높게 (sequence tracker는 감소 seq 드롭 —
    // 백엔드 에코 루프 차단 계약과 동일, t_c31e3f45). 확정은 스트림 카드를 정리(짧은 본문=카드
    // collapse로 contentSize 수축 → 브라우저 bottom clamp → 말미 정착)한다.
    send({ type: 'message.new', run_id: 'run1', seq: 300, message: { id: 'a1', role: 'agent', source_neuron: 'answer', content: '검토했어요. 두 조항만 보완하면 됩니다.', turn_index: 12, created_at: new Date().toISOString() } });
    await page.waitForTimeout(400);
    send({ type: 'run.completed', run_id: 'run1', seq: 301 });
    await page.waitForTimeout(400);
    const settled = await tailGeometry(page);
    check('① 확정 카드 정착(짧은 본문) — bottom gap≤110, 배지 없음', settled.gap <= 110 && !settled.badge, `gap=${settled.gap} badge=${settled.badge}`);

    // ② 배지 시나리오(대표님 원증상 inverse): 읽는 중 *아래로* 새 카드가 쌓일 때만 강제이동 금지+배지.
    //    (확정 카드가 스트림을 collapse로 대체하면 contentSize 수축→bottom clamp→정착 — 정상.)
    await page.evaluate(() => { const l = document.querySelector('[data-testid="message-list"]'); l.scrollTop = Math.max(0, l.scrollTop - 900); });
    await page.waitForTimeout(300);
    const readBefore = await tailGeometry(page);
    check('② 읽기 위치 확보(scrollTop>0)', readBefore.scrollTop > 0, `st=${readBefore.scrollTop}`);
    // 새 턴 arrival (answer) — 콘텐츠가 읽기 위치 *아래*에서 성장 → scrollTop 유지 + 배지 발동
    const LONG_A2 = '추가 검토 결과 제14조 지연 이자 조항과 제22조 통보 기한 조항에 보완이 필요합니다. '.repeat(20);
    send({ type: 'message.new', run_id: 'run2', seq: 310, message: { id: 'a2', role: 'agent', source_neuron: 'answer', content: LONG_A2, turn_index: 22, created_at: new Date().toISOString() } });
    await page.waitForTimeout(600);
    const midRead = await tailGeometry(page);
    check('② 읽는 중 새 카드 arrival — 강제이동 없음(scrollTop 유지)', Math.abs(midRead.scrollTop - readBefore.scrollTop) < 40, `before=${readBefore.scrollTop} after=${midRead.scrollTop}`);
    check('② 읽는 중 arrival → unseen 배지 발동', midRead.badge === true);
    await page.screenshot({ path: shot('03-badge-shown') });

    // 배지 탭 → 하강 → 말미 정착 + 배지 소멸
    await page.getByTestId('unseen-badge').click();
    await page.waitForTimeout(1600); // animated 하강 + 안착
    const landed = await tailGeometry(page);
    check('② 배지 탭 후 말미 정착(gap≤110)', landed.gap <= 110, `gap=${landed.gap}`);
    check('② 배지 소멸', landed.badge === false);

    // ③ 요구 C — 순수 A 계층(웹 모바일 기본 진입, 키보드 왕복 없음)에서 마지막 카드 bottom이
    //    voice-stage 상단 위. (키보드→복귀 전환 상태에는 입력바 69px가 잔존하며 컨테이너가
    //    줄어드는 ChatInputConsole 고유의 전이 특성 — t_4758f25d 소관, 미터 오염 회피.)
    const pageB = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    pageB.on('pageerror', (e) => errors.push(String(e)));
    const stB = await installFixtures(pageB);
    await openSession(pageB);
    const sockB = await waitSocket(stB);
    const sendB = (obj) => sockB.send(JSON.stringify({ session_id: 'source', ...obj }));
    for (let i = 0; i < 5; i++) {
      sendB({ type: 'message.new', seq: 1 + i, message: { id: 'seedB' + i, role: 'agent', content: `시드 히스토리 ${i} — 검토 메모입니다. `.repeat(28), turn_index: i, created_at: new Date(Date.now() - 90000 + i * 1000).toISOString() } });
    }
    await pageB.waitForTimeout(300);
    // WS 스트리밍만 (입력 UI 미경유 → A 계층 유지) — delta 후 확정 카드 발행
    for (let i = 0; i < 10; i++) {
      sendB({ type: 'answer.delta', run_id: 'rB', delta: `경계 조각 ${i} — `.repeat(14), index: i, seq: 20 + i });
      await pageB.waitForTimeout(80);
    }
    sendB({ type: 'message.new', run_id: 'rB', seq: 40, message: { id: 'bEnd', role: 'agent', source_neuron: 'answer', content: `최종 답변 본문 — 경계 확인용. `.repeat(30), turn_index: 60, created_at: new Date().toISOString() } });
    await pageB.waitForTimeout(700);
    const g3 = await tailGeometry(pageB);
    check('③ 말미 추종 정착(gap≤110)', g3.gap <= 110, `gap=${g3.gap}`);
    check('③ 마지막 카드 bottom ≤ voice-stage 상단(strip 패딩 클램프 — 요구 C)', !!g3.lastCardBottom && !!g3.edgeTop && g3.lastCardBottom <= g3.edgeTop + 2, `card=${g3.lastCardBottom} edge=${g3.edgeTop}`);
    await pageB.screenshot({ path: shot('04-landed-above-strip') });
    check('①〜③ 페이지 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));

    // ══ ④ 예/아니오(실시간 공감 재질문 + ack-chips) 등장 성장 추종 ══
    const page2 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    page2.on('pageerror', (e) => errors.push(String(e)));
    const st2 = await installFixtures(page2, { ack: true });
    await stubPost(page2);
    await openSession(page2);
    const sock2 = await waitSocket(st2);
    await openKeyboardIfVoice(page2);
    await page2.getByTestId('chat-input').fill('재질문 트리거 발화');
    await page2.getByTestId('send-button').click();
    await page2.waitForTimeout(300);
    const base = postCount * 10; // stubPost의 user turn_index
    // 공감 재질문 행을 길게(≈400px+) → 리스트가 뷰포트를 초과하는 구간에서 growth 추종을 검증한다.
    const LONG_REASK = '재질문 트리거 발화에 대해 제가 이해한 바를 다시 확인합니다. ' .repeat(18);
    sock2.send(JSON.stringify({ type: 'message.new', session_id: 'source', run_id: 'run' + postCount, seq: ++seq, message: { id: 'emp-live', role: 'agent', source_neuron: 'empathy', content: LONG_REASK, turn_index: base + 1, created_at: new Date().toISOString(), structured_payload: { empathy_question: LONG_REASK.slice(0, 40), empathy_ack: '네, 확인했어요', empathy_full: '에코: 재질문 트리거 발화', template_id: 'eq_confirm' } } }));
    await page2.getByTestId('ack-chips').waitFor({ timeout: 5000 });
    await page2.waitForTimeout(600);
    const g4 = await tailGeometry(page2);
    check('④ 공감 재질문 등장으로 리스트 초과(스크롤 가능) — growth 추종 대상', g4.scrollable, `scrollable=${g4.scrollable}`);
    check('④ 공감·예/아니오 칩 등장 시 말미 추종(gap≤110)', g4.gap <= 110, `gap=${g4.gap}`);
    check('④ unseen 배지 오탐 없음(추종 중)', g4.badge === false);
    // 칩 행이 하단 경계(키보드 입력바)에 가려지지 않아야 한다 — 메시지 카드가 아닌 칩 자체 기준
    const chipsBox = await page2.getByTestId('ack-chips').boundingBox();
    check('④ 예/아니오 칩이 하단 경계 위에 안착', !!chipsBox && !!g4.edgeTop && Math.round(chipsBox.y + chipsBox.height) <= g4.edgeTop + 2, `chipsBottom=${chipsBox && Math.round(chipsBox.y + chipsBox.height)} edge=${g4.edgeTop}`);
    await page2.screenshot({ path: shot('05-ack-chips-follow') });

    check('전체 페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(`\n결과: ${passed} PASS / ${failed} FAIL — 캡처 ${OUT}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
