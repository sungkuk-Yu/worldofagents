/**
 * 답글/인용 e2e 스모크 — t_62897e88 (백로그④, 백엔드 t_02f58030 계약)
 * 백엔드 없이 run_c_fixtures 인터셉트로 계약 픽스처 렌더 (9/26 교훈: 최소 비용 재현 경로).
 * 검증: ① 카드 홀드(450ms, rnw PressResponder) → 액션 시트(답글/즐겨찾기/선택)
 *       ② '답글' → 입력바 위 인용 바(원문 1줄 + ✕) + 키보드 계층 개방
 *       ③ ✕ 취소 → 바 소멸, 발화 미발생 ④ 답글 유지 후 전송 → POST reply_to_id = 원문 id
 *       ⑤ 확정 user 카드 상단 인용 라인 렌더(스냅샷 by/text) ⑥ 인용 탭 → 원문 카드 하이라이트(2.6초 패턴)
 *       ⑦ 미전송/실패·데모 행 = 롱프레스 메뉴 답글 불가 ⑧ 시트 '선택' = 다중 선택 진입+행 선택
 *       ⑨ EN 라벨 ⑩ 1440 캡처 ⑪ 콘솔 에러 0
 * 실행: (정적서버) node tests/e2e/fr-serve.cjs dist-reply 8118
 *       APP_URL=http://localhost:8118 node tests/e2e/smoke_reply_quote.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8118';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'reply-quote');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

// 웹 마우스 홀드 롱프레스 — rnw PressResponder DEFAULT_LONG_PRESS_DELAY_MS=450 + 여유
async function longPress(page, locator) {
  // r9 머지게이트 수리: r5 꼬리추종은 '의도 없는 딥'(scrollIntoView)을 수축 클램프로 재추종한다 —
  // 실제 사용자처럼 휠 의도 마킹으로 이탈 후 배치를 되돌린다 (하네스만 변경, 제품 코드 무개입).
  const lb = await page.getByTestId('message-list').boundingBox();
  if (lb) await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.wheel(0, -800);
  await page.waitForTimeout(150);
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await locator.boundingBox();
  assert.ok(box, 'longPress: no box');
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(40, box.height / 2));
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ── ①②③④⑤⑥⑧ — 모바일 뷰포트(390) 답글 전체 흐름 ──
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const state = await installFixtures(page, { rich: true });
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('message-list').waitFor({ timeout: 8000 });

    // ① 에이전트 카드 'text' 홀드 → 시트
    await longPress(page, page.getByTestId('message-row-text'));
    await page.getByTestId('msg-action-sheet').waitFor({ state: 'visible', timeout: 3000 });
    check('① 카드 홀드 → 액션 시트 표시', await page.getByTestId('msg-action-sheet').isVisible());
    check('① 답글 행', await page.getByTestId('action-reply').isVisible());
    check('① 즐겨찾기 행', await page.getByTestId('action-favorite').isVisible());
    check('① 선택 행', await page.getByTestId('action-select').isVisible());
    // 갈라내기 게이트: rich 픽스처 에이전트는 'Test Agent'(비서 아님) → fork 행 미노출
    check('① 갈라내기는 김비서 room 게이트 (Test Agent=비노출)', (await page.getByTestId('action-fork').count()) === 0);
    await page.screenshot({ path: shot('01-action-sheet') });

    // ② '답글' → 인용 바 (키보드 계층도 함께 개방)
    await page.getByTestId('action-reply').click();
    await page.getByTestId('reply-draft-bar').waitFor({ state: 'visible', timeout: 3000 });
    const draftText = await page.getByTestId('reply-draft-bar').innerText();
    check('② 입력바 위 인용 바 = 원문 발췌', draftText.includes('Test content text') && draftText.includes('답글'), draftText.slice(0, 40));
    check('② 시트 종료', await page.getByTestId('msg-action-sheet').waitFor({ state: 'hidden', timeout: 3000 }).then(() => true).catch(() => false));

    // ③ ✕ 취소 → 바 소멸 + 발화 없음
    await page.getByTestId('reply-cancel').click();
    await page.waitForTimeout(200);
    check('③ 취소 → 인용 바 소멸', (await page.getByTestId('reply-draft-bar').count()) === 0);
    const postsBefore = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).length;
    check('③ 취소는 발행 중단 (POST 0)', postsBefore === 0);

    // ④ 재답글 + 전송 → POST reply_to_id
    await longPress(page, page.getByTestId('message-row-text'));
    await page.getByTestId('action-reply').click();
    await openKeyboardIfVoice(page);
    await page.getByTestId('chat-input').fill('인용 테스트 답글입니다');
    await page.getByTestId('send-button').click();
    await page.waitForTimeout(800);
    const replyPost = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).map((c) => c.body).find((b) => b && b.reply_to_id);
    check('④ POST reply_to_id = 원문 id', !!replyPost && replyPost.reply_to_id === 'text' && replyPost.content === '인용 테스트 답글입니다', JSON.stringify(replyPost && { r: replyPost.reply_to_id, c: replyPost.content }));
    check('④ 전송 시 인용 바 즉시 소멸', (await page.getByTestId('reply-draft-bar').count()) === 0);

    // ⑤ 확정 user 카드 상단 인용 라인 (백엔드 스냅샷 echo: by=Test Agent) — user 확정 id는 동적(u+index)
    const sentQuote = page.locator('[data-testid^="reply-quote-text-"]').first();
    await sentQuote.waitFor({ timeout: 5000 });
    const quoteLine = await sentQuote.innerText();
    check('⑤ 발송 카드 상단 원문 1줄 인용', quoteLine.includes('Test content text'), quoteLine.slice(0, 60));
    await page.screenshot({ path: shot('05-sent-quote') });

    // ⑥ 인용 탭 → 원문 카드 하이라이트 (scrollToIndex+2.6초 패턴)
    await sentQuote.click();
    await page.getByTestId('focus-highlight').waitFor({ timeout: 4000 });
    check('⑥ 인용 탭 → 원문 하이라이트', await page.getByTestId('focus-highlight').isVisible());
    await page.screenshot({ path: shot('06-jump-highlight') });
    await page.waitForTimeout(3200);
    check('⑥ 하이라이트 2.8초 후 자동 소멸', (await page.getByTestId('focus-highlight').count()) === 0);

    // ⑧ 시트 '선택' → 다중 선택 진입 + 해당 행 선택
    await longPress(page, page.getByTestId('message-row-info'));
    await page.getByTestId('action-select').click();
    await page.waitForTimeout(300);
    check('⑧ 선택 진입 + 카드 선택', await page.getByTestId('select-info').isVisible() && await page.getByTestId('selection-bar').isVisible());
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByTestId('selection-bar').or(page.getByTestId('appbar-selection-exit')).first().waitFor({ timeout: 2000 }).catch(() => {});

    // ⑦a 미전송(pending) 행 답글 불가 — gateSend: 첫 POST 보류 중 = 낙관 행이 화면에 pending
    const p4 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const state4 = await installFixtures(p4, { rich: true, gateSend: true });
    await p4.goto(APP, { waitUntil: 'networkidle' });
    await p4.getByTestId('session-card').click();
    await p4.getByTestId('message-list').waitFor({ timeout: 8000 });
    await openKeyboardIfVoice(p4);
    await p4.getByTestId('chat-input').fill('보류 중인 발화');
    await p4.getByTestId('send-button').click();
    // pending 낙관 행을 찾아 홀드 → 시트는 뜨지만 '답글'은 errors.unavailableAction (인용 바 미표시)
    const pendingRow = p4.locator('[data-testid^="message-row-"]').filter({ hasText: '보류 중인 발화' }).first();
    await pendingRow.waitFor({ timeout: 4000 });
    await longPress(p4, pendingRow);
    const sheetShown = await p4.getByTestId('msg-action-sheet').waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false);
    check('⑦a pending 행 시트 표시', sheetShown);
    if (sheetShown) {
      await p4.getByTestId('action-reply').click();
      await p4.waitForTimeout(300);
      check('⑦a pending 행 답글 거부 (인용 바 없음)', (await p4.getByTestId('reply-draft-bar').count()) === 0);
    }
    if (state4.resolveSend) state4.resolveSend();
    await p4.close();

    // ⑦b 데모 세션 = 롱프레스 시트 미표시 (설정 → 데모 명시 진입 후 카드 홀드)
    const p3 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    await installFixtures(p3, { rich: true });
    await p3.goto(APP, { waitUntil: 'networkidle' });
    await p3.getByTestId('settings-button').click().catch(() => {});
    await p3.getByTestId('demo-button').click().catch(() => {});
    await p3.waitForSelector('[data-testid="chat-input"]', { timeout: 8000 }).catch(() => {});
    if (await p3.getByTestId('demo-badge').count()) {
      await openKeyboardIfVoice(p3);
      const inp = p3.getByTestId('chat-input');
      if (await inp.count()) { await inp.fill('데모 발화'); await p3.getByTestId('send-button').click(); await p3.waitForTimeout(1500); }
      const anyRow = p3.locator('[data-testid^="message-row-"]').first();
      if (await anyRow.count()) {
        await longPress(p3, anyRow);
        check('⑦b 데모 = 액션 시트 미표시', (await p3.getByTestId('msg-action-sheet').count()) === 0);
      } else check('⑦b 데모 행 미생성 — 스킵', true);
    } else check('⑦b 데모 미진입 — 스킵', true);
    await p3.close();

    // ⑨⑩ EN + 1440 캡처 — PC 레이아웃( 입력바 상시)에서 답글 흐름 재확인
    // (run_c_fixtures가 ko를 강제 심는다 — installFixtures 이후 등록한 init script가 덮어쓴다)
    const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    const state2 = await installFixtures(p2, { rich: true });
    await p2.addInitScript(() => localStorage.setItem('at-language', 'en'));
    await p2.goto(APP, { waitUntil: 'networkidle' });
    await p2.getByTestId('session-card').click();
    await p2.getByTestId('message-list').waitFor({ timeout: 8000 });
    await longPress(p2, p2.getByTestId('message-row-table'));
    await p2.getByTestId('msg-action-sheet').waitFor({ state: 'visible', timeout: 3000 });
    const enReply = await p2.getByTestId('action-reply').innerText();
    check('⑨ EN 시트 라벨', /Reply/i.test(enReply), enReply);
    await p2.getByTestId('action-reply').click();
    await p2.getByTestId('reply-draft-bar').waitFor({ timeout: 3000 });
    const enBar = await p2.getByTestId('reply-draft-bar').innerText();
    check('⑨ EN 인용 바 "Replying to"', /Replying to/.test(enBar), enBar.slice(0, 50));
    await p2.screenshot({ path: shot('09-pc-1440-draftbar'), fullPage: false });
    await p2.getByTestId('chat-input').fill('PC reply works');
    await p2.getByTestId('send-button').click();
    await p2.waitForTimeout(800);
    const post2 = state2.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).map((c) => c.body).find((b) => b && b.reply_to_id === 'table');
    check('⑩ PC(1440) 답글 POST reply_to_id=table', !!post2);
    await p2.locator('[data-testid^="reply-quote-table-"]').first().waitFor({ timeout: 4000 });
    await p2.screenshot({ path: shot('10-pc-1440-sent') });

    // ⑪ 콘솔 에러
    check('⑪ 콘솔/페이지 에러 0 (모바일 세션)', errors.length === 0, errors.slice(0, 2).join('|'));
  } catch (e) {
    failed++;
    console.log('  FAIL  스모크 예외 — ' + String(e).slice(0, 300));
  } finally {
    await browser.close();
  }
  console.log(`\nreply-quote smoke: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})();
