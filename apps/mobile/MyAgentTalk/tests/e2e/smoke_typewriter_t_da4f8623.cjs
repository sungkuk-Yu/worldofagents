/**
 * 사람 타이핑 ②-프론트 e2e 스모크 — t_da4f8623
 * 백엔드 없이 run_c_fixtures 인터셉트 + routeWebSocket 프레임 주입 (관례 승계).
 * 검증 (카드 요구5):
 *  A. '입력 중…' dots 버블: 발화~첫 answer.delta 실존 → 첫 토큰에 소멸, 확정 후 재점등 없음
 *  B. 재질문(empathy) 1자 리빌: 첫 관측 strict prefix(통째 렌더 금지), 신장 단조, 5자 청크 점프 아님,
 *     완료 후 원문=서문 1:1, 커서(▍) 리빌 중 존재 → 완료 후 소멸
 *  C. WS 답변 스트림: 서버 delta 폭주(~5자/톡) 중에도 노출은 진도 앞부분만, done+message.new 후
 *     확정 행 1:1, 스트림 카드 계승(잔류 0), 커서 소멸
 *  D. reduced-motion: 연출 0 — 도착 즉시 전문(폴백 1:1), reveal-body/caret 미사용
 *  E. 배치 GET 히스토리 재현: 진입 즉시 전문, 리빌 상태·캐aret 0 (content 변형 0)
 * 실행: node tests/e2e/fr-serve.cjs dist-typewriter2 8131 &
 *       APP_URL=http://localhost:8131 node tests/e2e/smoke_typewriter_t_da4f8623.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8131';
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'typewriter');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function openChat(browser, { reduce = false, ack = true, gateSend = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', ...(reduce ? { reducedMotion: 'reduce' } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, { ack, gateSend });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('chat-appbar').waitFor({ timeout: 12000 });
  await page.waitForTimeout(400); // WS subscribed
  return { page, state, errors, ctx };
}
// 모바일 폭 = 음성 스테이지 기본 → 위로 올려 키보드 전환 (ack_chips 조이스틱 지오메트리 승계)
async function openKeyboard(page) {
  const box = await page.getByTestId('voice-stage').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(cx, cy - i * 20); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.getByTestId('chat-input').waitFor({ timeout: 8000 });
}
const caretShown = async (page) => (await page.getByTestId('typing-caret').count()) > 0;
const bubbleGone = (page) => page.waitForFunction(() => !document.querySelector('[data-testid="typing-bubble-label"]'), null, { timeout: 4000 }).then(() => true).catch(() => false);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // ══ A. dots 버블: 발화~첫 청크 실존 → 첫 answer.delta에 소멸, 완료 후 재점등 없음 ══
    {
      const { page, state, errors, ctx } = await openChat(browser, { ack: false, gateSend: true });
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill('출장 보고서 초안 만들어줘');
      await page.getByTestId('send-button').click();
      const bubble = page.getByTestId('typing-bubble-label');
      const bubbleOn = await bubble.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      check('A 발화 발송 직후 에이전트 자리에 \'입력 중…\' dots 버블', bubbleOn);
      if (bubbleOn) check('A 라벨 텍스트 = 입력 중…', (await bubble.innerText()).includes('입력 중'));
      const ws = () => state.sockets.at(-1);
      ws().send(JSON.stringify({ type: 'run.started', session_id: 'source', run_id: 'rA', seq: 1 }));
      ws().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'rA', delta: '좋습니다', index: 0, seq: 2 }));
      check('A 첫 answer.delta(첫 토큰)로 버블 소멸', await bubbleGone(page));
      await page.screenshot({ path: shot('01-after-first-chunk') });
      ws().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'rA', message_id: 'a9', text: '좋습니다. 초안을 만들게요. 잠시만요', ai_generated: true, seq: 3 }));
      ws().send(JSON.stringify({ type: 'run.completed', session_id: 'source', run_id: 'rA', seq: 4 }));
      state.resolveSend && state.resolveSend(); // POST 보류 해제 (실행 창 마감)
      await page.waitForTimeout(4000); // 리빌 소진 + settling
      check('A 완료/확정 후 버블 재점등 없음 (모노토닉)', (await page.getByTestId('typing-bubble-label').count()) === 0);
      check('A pageerror 0건', errors.length === 0, errors.join(' | ').slice(0, 140));
      await ctx.close();
    }

    // ══ B. 재질문(empathy) 1자 리빌 — 중간 프레임 capture, 1:1 수렴, 커서 생멸 ══
    {
      const EXPECT = '이거 맞죠? 내일 출장 일정 잡아줘'; // ack 픽스처 eq_confirm 회전 = '이거 맞죠? ' + 발화(12자)
      const { page, state, errors, ctx } = await openChat(browser, { gateSend: true });
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill('내일 출장 일정 잡아줘');
      await page.getByTestId('send-button').click();
      await page.getByTestId('typing-bubble-label').waitFor({ timeout: 5000 }).catch(() => {});
      state.resolveSend(); // empathy+answer 도착 = 첫 에이전트 출력 = 버블 소멸각
      check('B empathy(재질문) 도착으로 버블 소멸', await bubbleGone(page));
      const body = page.getByTestId('chat-bubble-reveal').first(); // empathy 카드(nth 0 agent+reveal)
      const seen = await body.waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
      check('B 재질문이 RevealBody(리빌 경로)로 들어온다 — 도착 즉시 통째 렌더 아님', seen);
      const samples = [];
      let monotone = true, jumped = false, caretMid = false, t0 = Date.now();
      let prevLen = -1;
      while (Date.now() - t0 < 2600) {
        const txt = (await body.innerText().catch(() => '')).trim();
        if (txt && txt !== samples[samples.length - 1]) {
          samples.push(txt);
          if (txt.length < prevLen) monotone = false;
          if (prevLen >= 0 && txt.length - prevLen > 3) jumped = true; // 1~2자 신장이어야 (5자 점프 금지)
          prevLen = txt.length;
          if (!caretMid) caretMid = await caretShown(page);
        }
        if (txt.length >= EXPECT.length) break;
        await page.waitForTimeout(40);
      }
      await page.screenshot({ path: shot('02-reveal-frames') });
      const first = samples[0] ?? '';
      check('B 리빌 다중 프레임 관측 (frames≥3, 통째 1회 렌더 배제)', samples.length >= 3, `frames=${samples.length}`);
      check('B 첫 관측 = 원문 strict prefix (한 글자부터)', first.length >= 1 && first.length < EXPECT.length && EXPECT.startsWith(first), `first='${first}'`);
      check('B 신장 단조 — 되감기 없음', monotone, samples.map((x) => x.length).join(','));
      check('B 5자 청크 점프 아님 — 사람 1자 감각', !jumped, samples.map((x) => x.length).join(','));
      check('B 리빌 중 말미 커서(▍) 존재', caretMid);
      check('B 완료 프레임 원문 = 서문 1:1', samples[samples.length - 1] === EXPECT, `last='${samples[samples.length - 1]}'`);
      await page.waitForTimeout(1200); // 소진→회수(커서/리빌 testID 수렴)
      check('B 완료 후 커서 소멸 (reveal-body 정리)', !(await caretShown(page)));
      // 칩 창: 리빌 중 억제 → 완료 후 노출 (요구1 visibleAckChip 충돌 방지)
      const chip = await page.getByTestId('ack-chips').waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
      check('B 리빌 완료 후 예/아니요 칩 노출 (억제 해제)', chip);
      const finalTxt = (await page.getByTestId('message-agent').nth(1).innerText().catch(() => '')).trim();
      check('B 재질문 카드 본문 = 서문 (표시만 늦었지 content 불변)', finalTxt.includes(EXPECT), finalTxt.slice(0, 40));
      check('B pageerror 0건', errors.length === 0, errors.join(' | ').slice(0, 140));
      await ctx.close();
    }

    // ══ C. WS 답변 스트림 — 서버가 앞서가도(5자/톡) 노출은 1자, 확정 계승 ══
    {
      const LONG = '제14조 위약금은 연 5퍼센트 상한입니다. 제22조 해지는 30일 통보가 원칙이에요.';
      const { page, state, errors, ctx } = await openChat(browser, { ack: false });
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill('계약서 조항 요약해줘');
      await page.getByTestId('send-button').click();
      await page.waitForTimeout(300);
      const ws = () => state.sockets.at(-1);
      ws().send(JSON.stringify({ type: 'run.started', session_id: 'source', run_id: 'rC', seq: 20 }));
      const card = page.getByTestId('stream-card-rC').first();
      await card.waitFor({ timeout: 4000 }).catch(() => {});
      const chunks = LONG.match(/.{1,5}/g) ?? [];
      for (let i = 0; i < chunks.length; i++) {
        ws().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'rC', delta: chunks[i], index: i, seq: 21 + i }));
        await page.waitForTimeout(60); // 백엔드 pacer 각도(t_a654c9ac 12~25자/s)
      }
      const cardReveal = card.getByTestId('chat-bubble-reveal'); // 카드 스코프 — REST 인라인 행 리빌과 혼동 금지
      const mid = (await cardReveal.first().innerText().catch(() => '')).trim();
      check('C delta 폭주 중 노출 = 누적 원문보다 진도 앞 (버퍼 선행)', mid.length > 0 && mid.length < LONG.length && LONG.startsWith(mid), `shown=${mid.length}/${LONG.length}`);
      await page.screenshot({ path: shot('03-stream-reveal') });
      ws().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'rC', message_id: 'ansC', text: LONG, ai_generated: true, seq: 90 }));
      ws().send(JSON.stringify({ type: 'message.new', session_id: 'source', run_id: 'rC', seq: 91, message: { id: 'ansC', session_id: 'source', role: 'agent', source_neuron: 'answer', turn_index: 40, content: LONG, created_at: new Date().toISOString() } }));
      ws().send(JSON.stringify({ type: 'run.completed', session_id: 'source', run_id: 'rC', seq: 92 }));
      await page.waitForTimeout(7000); // 소진(≤70자, drain 보증 2s) + 확정 행 수렴
      const finalTxt = (await page.getByTestId('message-agent').last().innerText().catch(() => '')).trim();
      check('C 확정 행 원문=서문 1:1', finalTxt.includes(LONG), finalTxt.slice(0, 40));
      check('C 스트림 카드 계승·잔류 0 (ID merge)', (await page.getByTestId('stream-card-rC').count()) === 0);
      check('C 확정 후 커서 소멸', !(await caretShown(page)));
      check('C pageerror 0건', errors.length === 0, errors.join(' | ').slice(0, 140));
      await ctx.close();
    }

    // ══ D. reduced-motion — 연출 0, 도착 즉시 전문 (1:1 폴백) ══
    {
      const { page, errors, ctx } = await openChat(browser, { reduce: true });
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill('견적서 다시 보내줘');
      await page.getByTestId('send-button').click();
      const finalTxt = (await page.getByTestId('message-agent').last().innerText().catch(() => '')).trim();
      check('D reduced-motion — 도착 즉시 전문 노출 (Test reply to 견적서…)', finalTxt.includes('Test reply to 견적서 다시 보내줘'), finalTxt.slice(0, 40));
      check('D reduced-motion — 리빌 경로(caret/reveal-body) 미사용', !(await caretShown(page)) && (await page.getByTestId('typing-caret').count()) === 0);
      check('D pageerror 0건', errors.length === 0, errors.join(' | ').slice(0, 140));
      await ctx.close();
    }

    // ══ E. 배치 GET 히스토리 재현 = 즉시 렌더 (arrivedAt 도장 무 = 리빌 미생성) ══
    {
      const { page, errors, ctx } = await openChat(browser);
      await page.waitForTimeout(500);
      const histTxt = (await page.getByTestId('message-agent').first().innerText().catch(() => '')).trim();
      check('E 진입 즉시 히스토리 전문 1:1 (content 변형 0)', histTxt.includes('이전 질문 복창'), histTxt.slice(0, 30));
      check('E 히스토리 행에 리빌 캐aret·reveal 경로 없음', !(await caretShown(page)) && (await page.getByTestId('chat-bubble-reveal').count()) === 0);
      check('E stale empathy 행에 칩 없음 (재점등 금지 승계)', (await page.getByTestId('ack-chips').count()) === 0);
      check('E pageerror 0건', errors.length === 0, errors.join(' | ').slice(0, 140));
      await ctx.close();
    }

    console.log(`\nsmoke_typewriter_t_da4f8623 — PASS ${passed} / FAIL ${failed}`);
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
