/**
 * 답변 토큰 스트리밍 e2e 스모크 2건 — t_cc232982 (대표님 9/29 자연스러운 대화 1순위)
 * 백엔드 계약: protocol.ts answer.delta {type, session_id, run_id, delta, index, seq} / answer.done {text, message_id}.
 * run_c_fixtures WS 라우트로 이벤트 주입(백엔드 없음, 최소 토큰 경로 — 9/26 교훈).
 *
 * t_0633552f 현대화 (9/30, 출처 t_b2004d50 하네스 노트): 구 앵커(streaming-card/streaming-text/
 * streaming-cursor)는 ChatFeed footer의 !renderFlags.streamIdPatch 전용 경로 — 기본 ON 빌드에서는
 * 인라인 stream-* 카드(StreamCard.tsx: testID=stream-card-<runId>, 성장 마커=stream-live-mark)로
 * 대체된다. 구 하네스는 waitFor 타임아웃(구·신 빌드 동일 실패 = 제품 회귀 아님, 하네스 stale).
 *  · 배칭 계약도 이동: t_2fa10f11 머지 이후 브라우저는 80ms 디바운스가 아니라 rAF 프레임 배칭
 *    (≤1 re-render/frame) — '선행 즉시 플래시'는 rAF 불가 폴백(node/RN) 전용. e2e 관측은
 *    "연속 토큰이 프레임에 통합되어 누적본 발행, DOM 상태 전이 수 ≪ 토큰 수"로 검증.
 *  · PTT 제스처는 voice_helper.openKeyboardIfVoice 경유 — t_f8c40db0 이후 홀드 히트는 중앙
 *    지문형 패드(voice-stage-pad)뿐, 스트립 중앙 생드래그는 홀드를 시작하지 않는다.
 *
 * 스모크① 성장 카드(ON 인라인 경로): delta → stream-card-<runId> 노출·본문 누적, footer 이중
 *   렌더·구 스트립 testID 잔존 0, rAF 배칭(토큰마다 재렌더 금지), 같은 런 empathy 재질문에는
 *   스트리밍 중 ack 버튼 행 없음(t_cc232982 요구3) → answer.done 후 재표시, 확정 본문 카드 1장.
 * 스모크② 이탈 정합성: delta 중 소켓 절단 → 재연결/재조회로 확정 answer 행 수신 →
 *   고아 성장 카드·live-mark 잔존 0, 전체 텍스트는 서버 진실(확정 행)으로 유지·수렴.
 *
 * 실행: node tests/e2e/fr-serve.cjs dist-t0633552f 8131 &
 *       APP_URL=http://localhost:8131 node tests/e2e/smoke_streaming.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8131';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'streaming');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function openChat(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, { ack: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
  const socket = () => state.sockets.at(-1);
  for (let i = 0; i < 40 && !socket(); i++) await page.waitForTimeout(100);
  return { ctx, page, state, errors, socket };
}
// WS 주입 헬퍼 — 백엔드 protocol.ts 실형태(세션 'source', seq 단조 증가)
let SEQ = 1;
const delta = (sock, runId, text, index) => sock.send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: runId, delta: text, index, seq: SEQ++ }));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    // ═══ 스모크① 성장 카드(ON 인라인 stream-*) + rAF 배칭 + ack 억제→done 후 재표시 ═══
    const a = await openChat(browser);
    const { page: p1, socket } = a;
    // 발화 1회(ack 픽스처: empathy 재질문 실시간 행 + answer 행 run_id 'r-stream' 아님 — 스트림은 WS로 별도 주입)
    await openKeyboardIfVoice(p1); // t_f8c40db0: 홀드 히트=중앙 패드 — 스트립 생드래그는 홀드 미시작
    await p1.getByTestId('chat-input').fill('내일 출장 일정 잡아줘');
    await p1.getByTestId('send-button').click();
    await p1.getByTestId('ack-chips').waitFor({ timeout: 6000 }); // empathy 실시간 행 + 버튼 행(스트림 이전)

    // empathy 창(2.5s) 내 전 구간을 빠르게 소화한다: 억제→done→재표시가 같은 창에서 관측되어야 한다.
    // 배칭 관측: 10ms 샘플러로 성장 카드의 distinct DOM 상태 수를 센다. rAF 배칭이면 6토큰이
    // 1~3 프레임에 통합(전이 ≪ 6); 토큰마다 재렌더면 ≈6 — t_2fa10f11 '≤1 re-render/frame' 계약의 e2e 상당물.
    const TOK = ['출장', ' 일정', ' 잡아', ' 드릴', ' 게', ' 요'];
    const full = TOK.join('');
    const sampler = p1.evaluate(() => new Promise((resolve) => {
      const seen = [];
      const t0 = performance.now();
      const iv = setInterval(() => {
        const el = document.querySelector('[data-testid^="stream-card-"]');
        const txt = el ? el.innerText : '';
        if (txt && seen[seen.length - 1] !== txt) seen.push(txt);
        if (performance.now() - t0 > 400) { clearInterval(iv); resolve(seen); }
      }, 10);
    }));
    TOK.forEach((t, i) => delta(socket(), 'r-stream', t, i));
    const distinct = await sampler;
    check('① 인라인 성장 카드(stream-card-<runId>) 노출·누적본 통합 발행', distinct.length >= 1 && distinct[distinct.length - 1].includes(full), JSON.stringify((distinct[distinct.length - 1] || '').slice(0, 30)));
    check('① rAF 배칭: 6토큰 연속 주입 DOM 상태 전이 ≤4(토큰마다 재렌더 금지)', distinct.length <= 4, `distinct=${distinct.length}`);
    check('① 성장 중 카드 1장 유지(새 카드 생성 금지)', await p1.getByTestId(/^stream-card-/).count() === 1);
    check('① ON 모드 회귀 가드 — 구 footer 스트립 testID 잔존 0(streaming-card/text/cursor)',
      (await p1.getByTestId('streaming-card').count()) === 0 && (await p1.getByTestId('streaming-text').count()) === 0 && (await p1.getByTestId('streaming-cursor').count()) === 0);
    check('① footer 이중 렌더 없음 — 누적 본문 노출 위치 1개', (await p1.getByText(full, { exact: false }).count()) === 1);
    check('① 성장 마커(stream-live-mark — 무텍스트 펄스 도트, ①재작업 0줄 계약) 노출', (await p1.getByTestId('stream-live-mark').count()) === 1);
    check('③ 스트리밍 성장 중 예/아니요 버튼 행 억제(t_cc232982 요구3)', (await p1.getByTestId('ack-chips').count()) === 0);
    await p1.screenshot({ path: shot('01-growing-card') });

    // 확정: message.new(answer) 후 answer.done — 인라인 카드 소멸(ID merge), 확정 본문 1장, ack 재표시(창 내)
    socket().send(JSON.stringify({
      type: 'message.new', session_id: 'source', run_id: 'r-stream', seq: SEQ++,
      message: { id: 'ans-r-stream', role: 'agent', source_neuron: 'answer', content: full, turn_index: 900, created_at: new Date().toISOString() },
    }));
    socket().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'r-stream', seq: SEQ++, text: full, message_id: 'ans-r-stream' }));
    await p1.waitForTimeout(400);
    check('① 확정 후 인라인 성장 카드 소멸(ID merge — footer 카드 소실 상당)', await p1.getByTestId(/^stream-card-/).count() === 0);
    check('① 확정 후 live-mark 잔존 없음(커서 정지 상당)', (await p1.getByTestId('stream-live-mark').count()) === 0);
    check('① 확정 답변 본문 표시(누적 텍스트 유실 없음)', (await p1.getByTestId('message-list').innerText()).includes(full) && (await p1.getByText(full, { exact: false }).count()) === 1);
    check('③ answer.done 후 ack 버튼 행 재표시(empathy 창 내 — t_b2004d50 창 교정 전 basic 회귀 가드)', (await p1.getByTestId('ack-chips').count()) === 1);
    await p1.screenshot({ path: shot('02-finalized') });
    check('① JS 예외 0', a.errors.length === 0, a.errors.slice(0, 2).join(' | '));
    await a.ctx.close();

    // ═══ 스모크② 이탈(네트워크 끊김) 정합성 ═══
    const b = await openChat(browser);
    const { page: p2, state: st2, errors: err2 } = b;
    const s1 = b.socket();
    delta(s1, 'r-drop', '중간에', 0);
    await p2.getByTestId('stream-card-r-drop').waitFor({ timeout: 4000 });
    delta(s1, 'r-drop', ' 끊긴', 1);
    await p2.waitForTimeout(250);
    check('② 이탈 전 성장 카드+live-mark 존재', (await p2.getByTestId('stream-card-r-drop').count()) === 1 && (await p2.getByTestId('stream-live-mark').count()) === 1);
    // 서버 진실 준비: 확정 answer 행(전체 텍스트)을 GET messages에 run_id와 함께 심는다
    st2.messages.source.push({
      id: 'ans-drop', role: 'agent', source_neuron: 'answer', run_id: 'r-drop',
      content: '중간에 끊긴 답변의 최종 전문입니다', turn_index: 999, created_at: new Date().toISOString(),
    });
    // 소켓 절단 → 훅은 백오프 후 재연결, 재구독 시 catchUpDiffSync( fixtures /events 404 → 'gap' 재조회) → 확정 행 회수
    s1.close({ code: 1006 });
    await p2.waitForTimeout(3500);
    check('② WS 재연결 (fixtures 새 소켓)', st2.sockets.length >= 2, `sockets=${st2.sockets.length}`);
    await p2.waitForTimeout(1500);
    check('② 이탈 후 고아 성장 카드/live-mark 잔존 0', (await p2.getByTestId(/^stream-card-/).count()) === 0 && (await p2.getByTestId('stream-live-mark').count()) === 0);
    const feedText = await p2.getByTestId('message-list').innerText();
    check('② 확정 행으로 전체 텍스트 유지(서버 진실 수렴)', feedText.includes('중간에 끊긴 답변의 최종 전문입니다'), feedText.slice(-60));
    await p2.screenshot({ path: shot('03-after-drop-recovery') });
    check('② JS 예외 0', err2.length === 0, err2.slice(0, 2).join(' | '));
    await b.ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(2); });
