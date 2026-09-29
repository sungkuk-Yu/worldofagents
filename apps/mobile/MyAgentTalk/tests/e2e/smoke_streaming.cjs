/**
 * 답변 토큰 스트리밍 e2e 스모크 2건 — t_cc232982 (대표님 9/29 자연스러운 대화 1순위)
 * 백엔드 계약: protocol.ts answer.delta {type, session_id, run_id, delta, index, seq} / answer.done {text, message_id}.
 * run_c_fixtures WS 라우트로 이벤트 주입(백엔드 없음, 최소 토큰 경로 — 9/26 교훈).
 *
 * 스모크① 성장 카드: delta 수신 → streaming-card 노출·본문 누적, 꼬리 커서(streaming-cursor) 존재,
 *   배칭(80ms 창)으로 토큰마다 갱신되지 않음(창 내 DOM 미변 관측), answer.done 후 카드 소실+커서 정지,
 *   같은 런 empathy 재질문에는 스트리밍 중 ack 버튼 행 없음 → answer.done 후 표시 (요구3, t_64e3edd6 안전).
 * 스모크② 이탈 정합성: delta 중 소켓 절단 → 재연결/재조회로 확정 answer 행 수신 →
 *   고아 성장 카드·커서 잔존 0, 전체 텍스트는 서버 진실(확정 행)로 유지·수렴.
 *
 * 실행: node tests/e2e/fr-serve.cjs dist-stream-tcc232982 8131 &
 *       APP_URL=http://localhost:8131 node tests/e2e/smoke_streaming.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
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
    // ═══ 스모크① 성장 카드 + 배칭 + 커서 + ack 억제 ═══
    const a = await openChat(browser);
    const { page: p1, socket } = a;
    // 발화 1회(ack 픽스처: empathy 재질문 실시간 행 + answer 행 run_id 'r0' 아님 — 스트림은 WS로 별도 주입)
    const box = await p1.getByTestId('voice-stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await p1.mouse.move(cx, cy); await p1.mouse.down();
    for (let i = 1; i <= 10; i++) { await p1.mouse.move(cx, cy - i * 20); await p1.waitForTimeout(30); }
    await p1.mouse.up();
    await p1.getByTestId('chat-input').fill('내일 출장 일정 잡아줘');
    await p1.getByTestId('send-button').click();
    await p1.getByTestId('ack-chips').waitFor({ timeout: 6000 }); // empathy 실시간 행 + 버튼 행(스트림 이전)

    // 성장 시작: 첫 delta = 선행 즉시 발행
    delta(socket(), 'r-stream', '출장', 0);
    await p1.getByTestId('streaming-card').waitFor({ timeout: 4000 });
    const t0 = await p1.getByTestId('streaming-text').innerText();
    check('① 첫 delta 즉시 성장 카드 노출(선행 플래시)', t0 === '출장', JSON.stringify(t0));
    check('① 꼬리 커서 성장 중 표시', (await p1.getByTestId('streaming-cursor').count()) === 1);

    // 배칭 관측: 창(80ms) 안에 3토큰 → DOM은 즉시 갱신되지 않고(선행 플래시 값 유지), 만료 후 누적본 1발행
    delta(socket(), 'r-stream', ' 일정', 1);
    delta(socket(), 'r-stream', ' 확인', 2);
    const during = await p1.getByTestId('streaming-text').innerText();
    check('① 배칭: 창 내 후속 토큰은 DOM 미변(토큰마다 재렌더 금지)', during === '출장', JSON.stringify(during));
    await p1.waitForTimeout(250);
    const batched = await p1.getByTestId('streaming-text').innerText();
    check('① 배칭: 창 만료 후 누적본 통합 발행', batched === '출장 일정 확인', JSON.stringify(batched));

    // 요구3: 스트리밍 중 empathy 버튼 행 억제 → answer.done 후 재표시
    const duringAck = (await p1.getByTestId('ack-chips').count()) === 0;
    check('③ 스트리밍 성장 중 예/아니요 버튼 행 억제(t_64e3edd6 충돌 방지)', duringAck);
    await p1.screenshot({ path: shot('01-growing-card') });

    // 확정: message.new(answer) 후 answer.done — 카드 소실, 커서 정지, 확정 본문 카드 유지
    delta(socket(), 'r-stream', '했어요', 3);
    await p1.waitForTimeout(250);
    socket().send(JSON.stringify({
      type: 'message.new', session_id: 'source', run_id: 'r-stream', seq: SEQ++,
      message: { id: 'ans-r-stream', role: 'agent', source_neuron: 'answer', content: '출장 일정 확인했어요', turn_index: 900, created_at: new Date().toISOString() },
    }));
    socket().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'r-stream', seq: SEQ++, text: '출장 일정 확인했어요', message_id: 'ans-r-stream' }));
    await p1.waitForTimeout(500);
    check('① answer.done 후 성장 카드 소실(본문message.new 승계)', (await p1.getByTestId('streaming-card').count()) === 0);
    check('① 확정 답변 본문 표시(누적 텍스트 유실 없음)', (await p1.getByTestId('streaming-text').count()) === 0 && (await p1.getByTestId('message-list').innerText()).includes('출장 일정 확인했어요'));
    check('① done 후 꼬리 커서 잔존 없음(정지)', (await p1.getByTestId('streaming-cursor').count()) === 0);
    await p1.screenshot({ path: shot('02-finalized') });
    check('① JS 예외 0', a.errors.length === 0, a.errors.slice(0, 2).join(' | '));

    // ═══ 스모크② 이탈(네트워크 끊김) 정합성 ═══
    const b = await openChat(browser);
    const { page: p2, state: st2, errors: err2 } = b;
    const s1 = b.socket();
    delta(s1, 'r-drop', '중간에', 0);
    await p2.getByTestId('streaming-card').waitFor({ timeout: 4000 });
    delta(s1, 'r-drop', ' 끊긴', 1);
    await p2.waitForTimeout(200);
    check('② 이탈 전 성장 카드+커서 존재', (await p2.getByTestId('streaming-card').count()) === 1 && (await p2.getByTestId('streaming-cursor').count()) === 1);
    // 서버 진실 준비: 확정 answer 행(전체 텍스트)을 GET messages에 run_id와 함께 심는다
    st2.messages.source.push({
      id: 'ans-drop', role: 'agent', source_neuron: 'answer', run_id: 'r-drop',
      content: '중간에 끊긴 답변의 최종 전문입니다', turn_index: 999, created_at: new Date().toISOString(),
    });
    // 소켓 절단 → 훅은 백오프 후 재연결, 재구독 current_seq 0 = 강제 재동기화(전량 refresh)
    s1.close({ code: 1006 });
    await p2.waitForTimeout(3500);
    const reconnected = st2.sockets.length >= 2;
    check('② WS 재연결 (fixtures 새 소켓)', reconnected, `sockets=${st2.sockets.length}`);
    await p2.waitForTimeout(1500);
    check('② 이탈 후 고아 성장 카드/커서 잔존 0', (await p2.getByTestId('streaming-card').count()) === 0 && (await p2.getByTestId('streaming-cursor').count()) === 0);
    const feedText = await p2.getByTestId('message-list').innerText();
    check('② 확정 행으로 전체 텍스트 유지(서버 진실 수렴)', feedText.includes('중간에 끊긴 답변의 최종 전문입니다'), feedText.slice(-60));
    await p2.screenshot({ path: shot('03-after-drop-recovery') });
    check('② JS 예외 0', err2.length === 0, err2.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(2); });
