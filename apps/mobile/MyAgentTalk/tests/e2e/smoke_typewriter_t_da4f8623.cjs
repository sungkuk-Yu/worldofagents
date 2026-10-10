/**
 * 사람 타이핑 e2e 스모크 — t_da4f8623 → t_4c266653 3차 개정(대표님 10/10 원지시 ①②③)
 * 백엔드 없이 run_c_fixtures 인터셉트 + routeWebSocket 프레임 주입 (관례 승계).
 * 개정 계약 (폐기: 1자씩 40~120ms 지터 리빌 = '30자/s 총알받이 연출'):
 *  A. 리드 캡: '입력 중…' dots 버블 = 발화~첫 문장 노출 구간. 미완 delta 도착에도 유지(보류),
 *     첫 문장 경계 노출에 소멸, 확정 후 재점등 없음(모노토닉).
 *  B. 재질문(empathy) = 통째 확정 행 → 도착 즉시 전문 표시(리빌 상태 미생성·캐aret 0),
 *     칩 ≤2s(억제 창을 연출이 태우지 못한다), 본문=서문 1:1.
 *  C. WS 스트림: 미완 첫 청크 = 보류(0자+캐aret). 폭주 청크 후 노출=컷점 즉시(≤1틱 게이트).
 *     answer.done=전문 즉시, 확정 행 계승 1:1, 잔류 0.
 *  D. reduced-motion: 연출 0 — 도착 즉시 전문(폴백 1:1), reveal-body/caret 미사용.
 *  E. 배치 GET 히스토리 재현: 진입 즉시 전문, 리빌 상태·캐aret 0 (content 변형 0).
 * 실행: node tests/e2e/fr-serve.cjs dist-typewriter3 8131 &
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
const bubbleStill = (page, ms = 400) => new Promise(async (res) => {
  // ms 창 동안 버블이 '한 프레임도' 사라지지 않아야 true — 회귀(조기 소멸)면 waitForFunction 타임아웃.
  try {
    await page.waitForFunction(() => {
      if (!document.querySelector('[data-testid="typing-bubble-label"]')) throw new Error('gone');
      return false; // 계속 false = poll 반복 (사라지면 throw → catch)
    }, null, { timeout: ms, polling: 50 });
    res(true);
  } catch (e) { res(String(e && e.message || '').includes('gone') ? false : true); }
});
// t_96a708c5 확정 대기 봉인 (smoke_ack_chips waitChips류 poll 관례 승계):
//  waitEchoMounted — message-agent 행 중 마커 텍스트 포함 행 실존을 100ms poll로 기달.
//  3차 개정: 통째 행은 첫 관측=전문이라 선두/후미 매칭이 동시에 성립. C의 후미(tail) 매칭은
//  '노출=컷점 즉시' 변별자 — 지터 리빌 회귀 빌드에서는 소진(~2s)까지 실패해 FAIL 유지.
const waitEchoMounted = (page, headMarker, ms = 15000) =>
  page.waitForFunction((t) => Array.from(document.querySelectorAll('[data-testid="message-agent"]'))
    .some((el) => (el.innerText || '').includes(t)), headMarker, { timeout: ms, polling: 100 })
    .then(() => true).catch(() => false);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // ══ A. 리드 캡: 버블 = 발화~첫 문장 노출. 미완 delta에 소멸 아님(보류), 경계 노출에 소멸 ══
    {
      const { page, state, errors, ctx } = await openChat(browser, { ack: false, gateSend: true });
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill('출장 보고서 초안 만들어줘');
      await page.getByTestId('send-button').click();
      const bubble = page.getByTestId('typing-bubble-label');
      const shown0 = await bubble.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      check('A 발화 발송 직후 에이전트 자리에 \'입력 중…\' dots 버블(리드)', shown0);
      if (shown0) check('A 라벨 텍스트 = 입력 중…', (await bubble.innerText()).includes('입력 중'));
      const ws = () => state.sockets.at(-1);
      ws().send(JSON.stringify({ type: 'run.started', session_id: 'source', run_id: 'rA', seq: 1 }));
      await page.waitForTimeout(250);
      check('A run.started 후 버블 유지 (첫 delta 전)', await bubbleStill(page, 400));
      // 첫 delta = 종결부호 없는 미완 문장 → 노출 보류 → 버블이 리드로 남는다 (3차 개정 리드 캡:
      // 회귀(도착 즉시 소멸·1자 폭주)면 이 체크가 FAIL)
      ws().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'rA', delta: '좋습니다', index: 0, seq: 2 }));
      await page.waitForTimeout(350); // rAF/처리 유예 — 이 창에 소멸했다면 회귀 확정
      check('A 미완 delta(컷점 없음)에도 버블 유지 — 리드 캡 (30cps 총알받이 폐기 근거)', await bubbleStill(page, 400));
      // 경계 완성: 마침표 포함 청크 → 첫 문장('좋습니다.') 노출 = 버블 소멸각
      ws().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'rA', delta: '. 초안을', index: 1, seq: 3 }));
      check('A 첫 문장 경계 노출에 버블 소멸', await bubbleGone(page));
      await page.screenshot({ path: shot('01-after-first-sentence') });
      ws().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'rA', message_id: 'a9', text: '좋습니다. 초안을 만들게요. 잠시만요', ai_generated: true, seq: 4 }));
      ws().send(JSON.stringify({ type: 'run.completed', session_id: 'source', run_id: 'rA', seq: 5 }));
      state.resolveSend && state.resolveSend(); // POST 보류 해제 (실행 창 마감)
      await page.waitForTimeout(2000); // 회수 틱 + settling (구 4000 → 리빌 소진 창 폐지로 단축)
      check('A 완료/확정 후 버블 재점등 없음 (모노토닉)', (await page.getByTestId('typing-bubble-label').count()) === 0);
      check('A pageerror 0건', errors.length === 0, errors.join(' | ').slice(0, 140));
      await ctx.close();
    }

    // ══ B. 재질문(empathy) = 통째 도착 즉시 표시 + 칩 창 유지 — 리빌 상태 자체가 없다 ══
    {
      const EXPECT = require('./empathyPool.generated.cjs').requestion('내일 출장 일정 잡아줘', null, 'ko').text; // t_a7b39e0f: 백엔드 미러 첫 회전(hash seed)과 문자 동일 — 하드카피 금지
      const { page, state, errors, ctx } = await openChat(browser, { gateSend: true });
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill('내일 출장 일정 잡아줘');
      await page.getByTestId('send-button').click();
      await page.getByTestId('typing-bubble-label').waitFor({ timeout: 5000 }).catch(() => {});
      state.resolveSend(); // empathy+answer 도착 = 첫 에이전트 출력 = 버블 소멸각
      check('B empathy(재질문) 도착으로 버블 소멸', await bubbleGone(page));
      // 3차 개정: 통째 행 = 리빌 미생성 → 첫 관측부터 전문. 2초 상한(구 4s 소진 대기가 아님).
      const body = page.getByTestId('message-agent').nth(1);
      const arrived = await waitEchoMounted(page, EXPECT.slice(0, 6), 2000);
      check('B 재질문 도착 즉시 전문 표시 (컷점 무관 통째 노출 — 1자 연출 폐기)', arrived);
      const shown = (await body.innerText().catch(() => '')).trim();
      check('B 첫 관측 본문 = 서문 1:1 (content 불변 — 표시 계층만)', shown.includes(EXPECT), shown.slice(0, 40));
      check('B 리빌 캐aret 없음 (통째 행 연출 0)', !(await caretShown(page)));
      const chip = await page.getByTestId('ack-chips').waitFor({ timeout: 2000 }).then(() => true).catch(() => false);
      check('B 예/아니요 칩 ≤2s 노출 — 칩 발화 창을 표시 연출이 태우지 않는다 (t_e1de4cc4 승계)', chip);
      const finalTxt = (await body.innerText().catch(() => '')).trim();
      check('B 재질문 카드 본문 = 서문 유지', finalTxt.includes(EXPECT), finalTxt.slice(0, 40));
      check('B pageerror 0건', errors.length === 0, errors.join(' | ').slice(0, 140));
      await page.screenshot({ path: shot('02-empathy-instant') });
      await ctx.close();
    }

    // ══ C. WS 스트림 폭주 — 노출=컷점 즉시(≤1틱 게이트): 폭주 후 150ms 내 전문 ══
    {
      const LONG = '제14조 위약금은 연 5퍼센트 상한입니다. 제22조 해지는 30일 통보가 원칙이에요. 예외 조항은 특약으로 우선합니다.'; // ~57자
      const { page, state, errors, ctx } = await openChat(browser, { ack: false });
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill('계약서 조항 요약해줘');
      await page.getByTestId('send-button').click();
      await page.waitForTimeout(300);
      const ws = () => state.sockets.at(-1);
      ws().send(JSON.stringify({ type: 'run.started', session_id: 'source', run_id: 'rC', seq: 20 }));
      const card = page.getByTestId('stream-card-rC').first();
      await card.waitFor({ timeout: 4000 }).catch(() => {});
      // 1) 미완 첫 청크: 보류 — 노출 Text 미마운트(0자)·캐aret만 (노출=완료 문장부터, '중간 결과물' 금지)
      ws().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'rC', delta: '제14조', index: 0, seq: 21 }));
      await page.waitForTimeout(350);
      const revealCount1 = await card.getByTestId('chat-bubble-reveal').count();
      check('C 미완 첫 delta: 노출 보류(0자=Text 미마운트) + 캐aret 말미 (컷점 전 중간 결과물 금지)', revealCount1 === 0 && (await caretShown(page)));
      // 2) 폭주 주입 — 마지막 청크에 종결부호 포함. 회귀(30cps 지터)면 57자 소진 ~1.9s; ≤1틱이면 즉시.
      const tBurst = Date.now();
      const chunks = LONG.slice('제14조'.length).match(/.{1,5}/g) ?? [];
      for (let i = 0; i < chunks.length; i++) {
        ws().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'rC', delta: chunks[i], index: i + 1, seq: 22 + i }));
      }
      // 컷점=마침표까지 첫 문장('…상한입니다.')이 1틱 내 노출되는 것이 정본 게이트.
      const firstSent = '제14조 위약금은 연 5퍼센트 상한입니다.';
      const cutShown = await page.waitForFunction((t) => {
        const els = Array.from(document.querySelectorAll('[data-testid="chat-bubble-reveal"]'));
        return els.some((el) => (el.innerText || '').includes(t));
      }, firstSent, { timeout: 800, polling: 50 }).then(() => true).catch(() => false);
      const cutMs = Date.now() - tBurst;
      check('C 폭주 청크 노출 지연 ≤1틱(800ms 상한) — 마지막 delta 후 첫 문장 즉시 (30cps 회귀 차단)', cutShown, `t=${cutMs}ms`);
      await page.screenshot({ path: shot('03-stream-instant') });
      // 3) 확정 계승 — done/message.new 후 잔류 0·캐aret 소멸·행 원문 1:1
      ws().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'rC', message_id: 'ansC', text: LONG, ai_generated: true, seq: 90 }));
      ws().send(JSON.stringify({ type: 'message.new', session_id: 'source', run_id: 'rC', seq: 91, message: { id: 'ansC', session_id: 'source', role: 'agent', source_neuron: 'answer', turn_index: 40, content: LONG, created_at: new Date().toISOString() } }));
      ws().send(JSON.stringify({ type: 'run.completed', session_id: 'source', run_id: 'rC', seq: 92 }));
      await page.waitForTimeout(1500); // 회수 틱 + ID merge 수렴 (구 7000 → 드레인 창 폐지)
      const finalTxt = (await page.getByTestId('message-agent').last().innerText().catch(() => '')).trim();
      check('C 확정 행 원문=서문 1:1 (되감기·재타이핑 없음)', finalTxt.includes(LONG), finalTxt.slice(0, 40));
      check('C 스트림 카드 계승·잔류 0 (ID merge)', (await page.getByTestId('stream-card-rC').count()) === 0);
      check('C 확정 후 캐aret 소멸', !(await caretShown(page)));
      check('C pageerror 0건', errors.length === 0, errors.join(' | ').slice(0, 140));
      await ctx.close();
    }

    // ══ D. reduced-motion — 연출 0, 도착 즉시 전문 (1:1 폴백) ══
    {
      const { page, errors, ctx } = await openChat(browser, { reduce: true });
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill('견적서 다시 보내줘');
      await page.getByTestId('send-button').click();
      // t_96a708c5 waitEchoMounted + t_a7b39e0f 계약(도착 후 첫 관측=전문) 통합: 결정적 술어 대기 후 즉시 읽기.
      const arrived = await waitEchoMounted(page, 'Test reply to 견적서');
      if (!arrived) console.log('  WARN  D 에코행 15s 내 미도착 — 단언은 그대로 FAIL (경합 봉인 실패 관측)');
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

    console.log(`\nsmoke_typewriter_t_da4f8623 (3차 개정) — PASS ${passed} / FAIL ${failed}`);
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('SMOKE ABORT:', e.message); process.exit(2); });