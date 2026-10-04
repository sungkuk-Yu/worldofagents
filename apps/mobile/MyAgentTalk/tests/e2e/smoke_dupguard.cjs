/**
 * 중복 전송·quip 이중 렌더 회귀 스모크 — t_4af94b1c
 * 근거(재현 로그 t_c31e3f45): ① Enter+전송 동시 탭 → 백엔드 ingress 드롭 {deduped:true} 응답을
 *   프론트가 처리하지 못해 유령 낙관 행 + "서버가 응답하지 않았어요" 배너 + quip 3중 렌더.
 *   ② 첫 answer.delta~run.completed 구간에서 타이핑 카드와 스트리밍 카드가 같은 quip 이중 렌더.
 * 검증(백엔드 없는 run_c_fixtures 인터셉트 경로 — 9/26 교훈, 최소 토큰):
 *   A1 동일 텍스트 연속 클릭 → POST 1회·낙관 행 1개(가드/입력 클리어 이중 방어)
 *   A2 실행 중 answer.delta → 스트리밍 카드와 타이핑 카드 공존 시 quip 문구 DOM상 정확히 1회(②)
 *   A3 REST 확정 후 동일 발화 재전송 → 정당한 재요청 통과(POST 2회차, 가드 잔존 금지)
 *   B  deduped:true 응답 → 낙관 행 제거(유령 행 없음)·error-bar 없음·typing 정리·성공 처리
 * 실행: node tests/e2e/fr-serve.cjs dist-t4af94b1c 8137 &
 *       APP_URL=http://localhost:8137 node tests/e2e/smoke_dupguard.cjs
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8137';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'dupguard');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const QUIP = '답변 준비 중'; // ko quip.default = '답변 준비 중…' (t_140ecc15 ① — 의인화 대사 제거, 단계명 라벨화)

async function openChat(browser, fixtures) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, fixtures);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').first().click();
  await page.getByTestId('message-list').waitFor({ timeout: 8000 });
  // WS 등록은 message-list 렌더 후 확정된다(relay 스모크 동일 대기관) — 40×100ms 폴링
  for (let i = 0; i < 40 && !state.sockets.length; i++) await page.waitForTimeout(100);
  return { page, state, errors };
}
// A→B 전이(스트립 홀드 후 ↑ 릴리스 — smoke_ack_chips 동일 제스처)로 키보드 입력바 개방
async function openKeyboard(page) {
  const box = await page.getByTestId('voice-stage').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(cx, cy - i * 20); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.getByTestId('chat-input').waitFor({ timeout: 8000 });
}
const postCalls = (state) => state.calls.filter((c) => c.method === 'POST' && /\/messages$/.test(c.path));

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ── A: in-flight 가드 + ② quip 이중 렌더 + 확정 후 정당한 재전송 ──
    {
      const { page, state, errors } = await openChat(browser, { gateSend: true });
      const TEXT = '중복 금지 테스트';
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill(TEXT);
      await page.getByTestId('send-button').click();
      await page.getByTestId('send-button').click().catch(() => {}); // 동시 탭 재현(입력 클리어 전 2차 클릭)
      await page.waitForTimeout(300);
      check('A1 POST는 1회만 (in-flight 가드/입력 클리어)', postCalls(state).length === 1, `calls=${postCalls(state).length}`);
      // 사용자 행이 피드에 정확히 1개 — DOM text 노드 단위 세기(getByText exact는 접근성 라벨 복제와 경합) 대신
      // 마커로 카드 존재+중복 여부를 판정하고, 전송중… 라벨 개수로 실행 잔류 유령 행을 잡는다.
      check('A1 user 낙관 행 존재', (await page.getByText(TEXT, { exact: true }).count()) >= 1);
      // sendTicks(f40bc3a5) 이후 전송중 마커는 svg 버튼(aria-label) — 텍스트 라벨 갯수 대신
      // message-tick testID 개수로 유령/중복 낙관 행을 판정한다 (t_140ecc15 정합: 9/30 이후 stale 결함 수리).
      check('A1 user 낙관 행 1개 (전송 tick 마커 기준)', (await page.locator('[data-testid^="message-tick-"]').count()) === 1);
      await page.getByTestId('typing-indicator').waitFor({ timeout: 5000 });

      // ② 실행 중 answer.delta → 스트리밍 카드와 타이핑 카드 공존 구간에서 quip 1회만
      state.sockets.at(-1).send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'dg1', delta: '부분 답변이 흘러갑니다', index: 1 }));
      await page.waitForTimeout(600);
      const typingVisible = await page.getByTestId('typing-indicator').isVisible().catch(() => false);
      const streamVisible = (await page.getByText('부분 답변이 흘러갑니다').count()) > 0;
      const quipCount = await page.getByText(QUIP, { exact: false }).count();
      check('A2 타이핑 카드 + 스트리밍 카드 공존(검증 구간 성립)', typingVisible && streamVisible, `typing=${typingVisible} stream=${streamVisible}`);
      check('A2 quip 문구 DOM 정확히 1회 (이중 렌더 회귀 차단)', quipCount === 1, `count=${quipCount}`);
      await page.screenshot({ path: shot('a2-quip-single') });

      // A3 REST 확정(gate 해제) 후 동일 발화 재전송은 정당한 재요청 — 통과해야 한다
      state.resolveSend();
      await page.getByTestId('typing-indicator').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      await page.getByTestId('chat-input').fill(TEXT);
      await page.getByTestId('send-button').click();
      await page.waitForTimeout(400);
      check('A3 완료 후 동일 텍스트 재전송은 차단되지 않는다 (POST 2회차)', postCalls(state).length === 2, `calls=${postCalls(state).length}`);
      check('A 오류 없음', errors.length === 0, errors.join('|').slice(0, 120));
      await page.close();
    }

    // ── B: 백엔드 ingress 드롭 { deduped:true } → 유령 낙관 행 제거·오류 배너 없음 ──
    {
      const { page, state, errors } = await openChat(browser, { dedupWindow: true });
      const TEXT = '방금 보낸 것과 같음';
      await openKeyboard(page);
      await page.getByTestId('chat-input').fill(TEXT);
      await page.getByTestId('send-button').click();
      await page.waitForTimeout(600);
      check('B deduped 응답 수신', postCalls(state).length === 1);
      check('B 유령 user 행 없음 (deduped 분기)', (await page.locator('[data-testid^="message-tick-"]').count()) === 0 && (await page.getByText(TEXT).count()) === 0);
      check('B error-bar(실패 배너) 없음', (await page.getByTestId('error-bar').count()) === 0);
      const typingStuck = await page.getByTestId('typing-indicator').isVisible().catch(() => false);
      check('B typing 잔류 없음', !typingStuck);
      check('B 오류 없음', errors.length === 0, errors.join('|').slice(0, 120));
      await page.screenshot({ path: shot('b-deduped-clean') });
      await page.close();
    }

    console.log(`\n=== dupguard 스모크: PASS ${passed} / FAIL ${failed} ===`);
    process.exit(failed ? 1 : 0);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
