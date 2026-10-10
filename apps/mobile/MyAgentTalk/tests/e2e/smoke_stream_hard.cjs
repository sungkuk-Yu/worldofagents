/**
 * 스트리밍 렌더 hardening e2e 스모크 — t_5c559e85 (①②③④⑤ 통합 검증)
 * 백엔드 없이 run_c_fixtures 인터셉트 + routeWebSocket 프레임 주입 (9/26 교훈: 최소 비용 재현).
 * 검증:
 *  ① run.started → 인라인 카드(stream-card-r1) 1장, delta는 같은 카드 content 갱신(생성 0), footer 이중 렌더 없음
 *  ③ placeholder: 첫 토큰 전 빈 카드+quip로 자리 확보 (delta 전 testID 존재)
 *  ① 확정: answer.done+message.new 후 스트림 카드 소멸, 최종 본문 카드 1장 (전환 중 동시 존재 아님)
 *  ② contain: 스트림 카드 요소의 computed contain=layout (웹)
 *  ④ 드래프트: 입력 → reload → 값 복원; 발송 → localStorage 키 원자 소거
 *  ⑤ ticks: 실패(!) 탭 → 재전송 성공 → 체크(sent), 조용한 삭제 없음
 * 실행: node tests/e2e/fr-serve.cjs dist-render-hard 8121 &
 *       APP_URL=http://localhost:8121 node tests/e2e/smoke_stream_hard.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8121';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'stream-hard');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  try {
    // 데스크톱 폭 = 음성 스테이지 아닌 상시 입력창 경로 (④⑤ 검증 단순화)
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const state = await installFixtures(page, { rich: true });
    let postCount = 0;
    // messages 라우트를 래핑: 2회차 POST만 500 (⑤ 실패 시뮬레이션), 나머지는 fixture로 fallback
    await page.route('**/api/sessions/source/messages', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        postCount++;
        if (postCount === 2) return route.fulfill({ status: 500, json: { ok: false, error: { code: 'E', message: 'boom' } } });
      }
      await route.fallback();
    });
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('chat-appbar').waitFor({ timeout: 8000 });
    await page.waitForTimeout(500); // WS subscribed

    // ── ③+① placeholder → delta → 확정 ──
    const ws = () => state.sockets.at(-1);
    ws().send(JSON.stringify({ type: 'run.started', session_id: 'source', run_id: 'r1', seq: 1 }));
    ws().send(JSON.stringify({ type: 'run.progress', session_id: 'source', run_id: 'r1', stage: 'organizing', seq: 2 }));
    await page.waitForTimeout(300);
    const card = page.getByTestId('stream-card-r1');
    check('③ run.started/progress 직후 첫 토큰 전 placeholder 카드 자리 확보', await card.count() === 1);
    const quipVisible = await page.getByTestId('stream-live-mark').count();
    check('③ placeholder 자리 확보 — 무텍스트 라이브 마커만 (t_e1de4cc4 ①: quip 문구 0줄)', quipVisible === 1);
    await page.screenshot({ path: shot('01-placeholder') });

    ws().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'r1', delta: '헬로', index: 0, seq: 3 }));
    ws().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'r1', delta: ' 월드', index: 1, seq: 4 }));
    await page.waitForTimeout(400);
    check('① delta 누적 — 같은 카드 1장 유지(새 카드 생성 금지)', await card.count() === 1, `cards=${await page.getByTestId(/^stream-card-/).count()}`);
    const text = await card.innerText();
    check('① content patch 렌더 — 누적 본문 표시', text.includes('헬로') && text.includes('월드'), text.slice(0, 40));
    const dupFinal = await page.getByText('헬로 월드', { exact: false }).count();
    check('① footer 이중 렌더 없음 — 본문 노출 위치 1개', dupFinal <= 1 && dupFinal >= 1, `count=${dupFinal}`);
    // ② contain:layout 실측 (웹 computed style)
    const contain = await card.evaluate((el) => getComputedStyle(el).contain);
    check('② 스트림 카드 contain:layout (Open WebUI 1단계)', contain.includes('layout'), `contain=${contain}`);
    await page.screenshot({ path: shot('02-streaming') });

    // 확정: answer.done → message.new(같은 run answer 행) → 카드 1장으로 수렴
    ws().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'r1', message_id: 'ans1', text: '헬로 월드 최종', ai_generated: true, seq: 5 }));
    ws().send(JSON.stringify({ type: 'message.new', session_id: 'source', run_id: 'r1', seq: 6, message: { id: 'ans1', session_id: 'source', role: 'agent', source_neuron: 'answer', turn_index: 90, content: '헬로 월드 최종', created_at: new Date().toISOString() } }));
    ws().send(JSON.stringify({ type: 'run.completed', session_id: 'source', run_id: 'r1', seq: 7 }));
    await page.waitForTimeout(500);
    check('① 확정 후 스트림 카드 소멸(ID merge)', await page.getByTestId(/^stream-card-/).count() === 0);
    const finalCount = await page.getByText('헬로 월드 최종', { exact: true }).count();
    check('① 최종 본문 카드 정확히 1장(이중 카드 없음)', finalCount === 1, `count=${finalCount}`);
    await page.screenshot({ path: shot('03-settled') });

    // ── ④ 드래프트 저장/복원 → ⑤ 발송 후 성공 sends에서 원자 clear ──
    const input = page.getByTestId('chat-input');
    await input.waitFor({ timeout: 6000 });
    await input.fill('이건 아직 안 보낸 초안이에요');
    await page.waitForTimeout(600); // 디바운스 350ms > 대기
    const draftRaw = await page.evaluate(() => localStorage.getItem('at-draft-source'));
    check('④ 입력 → localStorage 드래프트 저장(디바운스)', draftRaw === '이건 아직 안 보낸 초안이에요', String(draftRaw));
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('chat-appbar').waitFor({ timeout: 8000 });
    await page.getByTestId('chat-input').waitFor({ timeout: 6000 });
    await page.waitForTimeout(400);
    const restored = await page.getByTestId('chat-input').inputValue();
    check('④ 화면 재진입 → 미전송 입력 복원', restored === '이건 아직 안 보낸 초안이에요', restored);
    await page.screenshot({ path: shot('04-draft-restored') });

    // 발송(POST #1 성공) → 드래프트 원자 소거 확인
    await page.getByTestId('send-button').click();
    await page.waitForTimeout(800);
    const draftAfterSend = await page.evaluate(() => localStorage.getItem('at-draft-source'));
    check('④ 발송 시 원자적 clear(키 제거, 유령 드래프트 없음)', draftAfterSend === null, String(draftAfterSend));
    const sentLabel = await page.getByText('Test reply to 이건 아직 안 보낸 초안이에요', { exact: false }).count();
    check('④ 발송 성공 — 본문 카드 반영', sentLabel >= 1, `count=${sentLabel}`);

    // ── ⑤ 실패(!) → tick 탭 재전송(POST #2 500 → #3 성공) → 체크(sent), 조용한 삭제 없음 ──
    await input.fill('실패 문장');
    await page.getByTestId('send-button').click();
    await page.waitForTimeout(700);
    const failTick = page.locator('[data-testid^="message-tick-"][aria-label="전송 실패"]');
    await failTick.waitFor({ timeout: 5000 });
    check('⑤ 전송 실패 → (!) tick 렌더, 행 유지(조용한 삭제 금지)', await failTick.count() === 1);
    await page.screenshot({ path: shot('05-failed-tick') });
    await failTick.click(); // tick 탭 = 재전송 (POST #3 fixture 성공)
    await page.waitForTimeout(900);
    check('⑤ 재전송 후 실패 tick 소멸', await page.locator('[aria-label="전송 실패"]').count() === 0);
    const sentTicks = await page.locator('[data-testid^="message-tick-"][aria-label="전송됨"]').count();
    check('⑤ 성공 → 체크(sent) tick', sentTicks >= 1, `sentTicks=${sentTicks}`);
    await page.screenshot({ path: shot('06-sent-tick') });

    check('콘솔 에러 0', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    failed++;
    console.log('  FAIL  스모크 예외:', e && e.message ? e.message : e);
  } finally {
    await browser.close();
  }
  console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})();
