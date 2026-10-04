/* global __dirname */
// 답글 목록(스레드 인덱스) e2e 스모크 — t_41c4c6f6 (스트립 승계작업 4)
// 9/28 '큐 스트립' 스모크(t_2f45ccb1 smoke_queue_strip, a9bc5841에서 소실)의 유효 계승면을 재커버:
//   확장3(모달 행=원문 발췌+답글 수+활동 시각 · 행탭=스레드 개방 · 앱바 배지=활성 수)
//   확장4(7일 무활동=종료 배지 · 활성/종료/전체 필터 · 활성>종료 정렬)
//   WS 큐 즉시 반영(부트스트랩 GET /queue는 보조 1회) — 폐기된 queue-strip/queue-chip testID는
//   새 계약의 QuestionTracker/QueueMessageMark로 승계(대표님 10/4 지시 3, t_3c882443·t_fd869e5b).
// 재발 방지 (t_4654d727이 남긴 '고정 created_at 절대 비교 금지' 규약의 실동 수단):
//   대표님 승인안 (b) — 실행시를 '실행일 UTC 12:00 + ANCHOR_OFFSET_DAYS' 앵커로 고정한다. 시드(anchorMs)와
//   브라우저 clock(setSystemTime, Date만 인공·타이머 현실)이 같은 인공 실행시를 공유 → 활성/종료 판정과
//   'N시간 전/N일 전' 라벨이 앵커-상대. 단언은 절대 날짜 문자열과 비교하지 않으므로 컨테이너 시계가
//   2026-12-30/2027-01-05로 흘러도 3연실행(OFFSET=오늘/+87d/+93d) 전부 동일 PASS여 한다.
//   (a) libfaketime은 미설치라 각하.
// 실행: EXPO_PUBLIC_API_URL=http://127.0.0.1:59999 EXPO_PUBLIC_WS_URL=ws://127.0.0.1:59999/ws \
//         npx expo export --platform web --output-dir dist-queue2 --clear
//       node tests/e2e/fr-serve.cjs dist-queue2 8264 &
//       APP_URL=http://localhost:8264 node tests/e2e/smoke_queue_threads_t41c4c6f6.cjs
//       ANCHOR_OFFSET_DAYS=87 APP_URL=... node tests/e2e/smoke_queue_threads_t41c4c6f6.cjs   # 가상이행일 2026-12-30
//       ANCHOR_OFFSET_DAYS=93 APP_URL=... node tests/e2e/smoke_queue_threads_t41c4c6f6.cjs   # 가상이행일 2027-01-05
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8264';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'queue-threads-t41c4c6f6');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
// 가정한 실행시 ANCHOR = (실행일+ANCHOR_OFFSET_DAYS) UTC 12:00. 시드와 브라우저 clock이 공유한다.
const OFFSET_DAYS = Number(process.env.ANCHOR_OFFSET_DAYS || '0');
const ANCHOR = (() => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); return d.getTime() + OFFSET_DAYS * 86400000; })();
async function openChat(page) {
  await page.getByTestId('session-card').first().click();
  await page.getByTestId('message-list').waitFor({ timeout: 8000 });
}
// 웹 마우스 홀드 롱프레스 — smoke_reply_quote 동일 수법 (rnw long-press 450ms + 여유)
async function longPress(page, locator) {
  const lb = await page.getByTestId('message-list').boundingBox();
  if (lb) await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.wheel(0, -400);
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
    // ── ① 확장3·4: 앱바 배지 · 모달 행 · 필터 · 정렬 · 행탭=시트 개방 (390) ──
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.clock.setSystemTime(ANCHOR); // Date만 인공, 타이머는 현실 — WS/렌더 경로 무영향
      await installFixtures(page, { threads: true, chief: true, anchorMs: ANCHOR });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await openChat(page);
      const btn = page.getByTestId('threads-open');
      await btn.waitFor({ timeout: 6000 });
      let btnText = '';
      for (let i = 0; i < 20; i += 1) { btnText = await btn.innerText(); if (btnText.includes('1')) break; await page.waitForTimeout(200); }
      check('① 확장3: 앱바 답글 배지 = 활성 스레드 수 1 (tq2 종료 미포함 — t_4654d727 실패 지점)', btnText.includes('답글') && btnText.includes('1'), btnText);
      const dead = await page.evaluate(() => document.querySelectorAll('[data-testid="queue-strip"], [data-testid^="queue-chip-"], [data-testid="queue-counter"], [data-testid^="queue-label-"], [data-testid^="queue-actions-"], [data-testid^="queue-reply-"], [data-testid^="queue-fork-"]').length);
      check('④ 승계: 폐기 스트립 testID 7종 DOM 0 (트래커/마커 이관 확인)', dead === 0, String(dead));
      await btn.click();
      await page.getByTestId('threads-modal').waitFor({ timeout: 5000 });
      await page.getByTestId('thread-row-tq1').waitFor({ timeout: 5000 });
      const row1 = page.getByTestId('thread-row-tq1');
      const rowText = await row1.innerText();
      check('② 확장3: 활성 행 = 원문 발췌 + 답글 수', rowText.includes('스레드 활성 질문') && rowText.includes('답글 1개'), rowText);
      check('⑤ 실행일 독립: 마지막 활동 = 앵커-상대 1시간 전 (절대 날짜 무비교)', rowText.includes('1시간 전'), (rowText.match(/마지막 활동[^\n]*/) || [''])[0]);
      // 필터 (구 page6 계약)
      await page.getByTestId('threads-filter-all').click();
      check('③ 확장4: 전체 = 활성+종료 2행, 종료 배지(tq2)', (await page.getByTestId('thread-row-tq1').count()) === 1
        && (await page.getByTestId('thread-row-tq2').count()) === 1 && await page.getByTestId('thread-ended-tq2').isVisible());
      const order = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="thread-row-"]')).map((e) => e.getAttribute('data-testid')));
      check('③ 확장4: 정렬 활성>종료', order.indexOf('thread-row-tq1') < order.indexOf('thread-row-tq2'), order.join(','));
      await page.getByTestId('threads-filter-ended').click();
      check('③ 확장4: 종료 필터 = tq2만', (await page.getByTestId('thread-row-tq2').count()) === 1 && (await page.getByTestId('thread-row-tq1').count()) === 0);
      check('⑤ 실행일 독립: 종료 행 라벨 = 앵커-상대 9일 전', (await page.getByTestId('thread-row-tq2').innerText()).includes('9일 전'));
      await page.getByTestId('threads-filter-active').click();
      check('③ 확장4: 활성 필터 = 종료 행 숨음', (await page.getByTestId('thread-row-tq2').count()) === 0 && (await page.getByTestId('thread-row-tq1').count()) === 1);
      await page.screenshot({ path: shot('01-modal-active-390') });
      // 행 탭 = 스레드 개방 (ThreadSheet #52) — fixture가 시드 답글을 /thread 미러 so 실답글 노출
      await page.getByTestId('thread-row-tq1').click();
      await page.getByTestId('thread-sheet').first().waitFor({ timeout: 8000 });
      let sheetText = '';
      for (let i = 0; i < 16; i += 1) {
        sheetText = await page.getByTestId('thread-sheet').first().innerText();
        if (sheetText.includes('스레드 활성 답글')) break;
        await page.waitForTimeout(250);
      }
      check('② 확장3: 행 탭 → 시트 = 원문 고정 + 답글 행', sheetText.includes('스레드 활성 질문') && sheetText.includes('스레드 활성 답글'), sheetText.slice(0, 60));
      await page.screenshot({ path: shot('02-sheet-390') });
      check('⑥ 런타임 오류 없음', errors.length === 0, errors.slice(0, 2).join('|'));
      await page.close();
    }

    // ── ② WS 큐 우선·HTTP 보조 + 카드 행 마커(승계 UI) + 시트 답글 발화 = parent_message_id ──
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.clock.setSystemTime(ANCHOR);
      const state = await installFixtures(page, { threads: true, anchorMs: ANCHOR });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await openChat(page);
      const queueGet = () => state.calls.filter((c) => c.path === '/api/sessions/source/queue' && c.method === 'GET').length;
      await page.waitForTimeout(400);
      check('⑦ GET /queue 부트스트랩 = 세션당 1회 (보조)', queueGet() === 1, String(queueGet()));
      state.sockets[0].send(JSON.stringify({ type: 'queue.updated', session_id: 'source', items: [{ id: 'wq1', content: '스레드 활성 질문', status: 'pending', position: 2, message_id: 'tq1' }] }));
      await page.getByTestId('queue-mark-wq1').waitFor({ timeout: 5000 });
      const markText = await page.getByTestId('queue-mark-wq1').innerText();
      check('⑦ WS queue.updated 즉시 반영 → 카드 행 체크포인트 마커(스트립 승계)', markText.includes('답변 대기'), markText);
      await page.screenshot({ path: shot('03-queue-mark-390') });
      const before = queueGet();
      await page.waitForTimeout(1200);
      check('⑦ WS 반영 후 즉시 재pull 0 (WS 우선·폴링 보조 — 9/27 경합 교훈)', queueGet() === before, `${before}→${queueGet()}`);
      // 시스텸 답글 발화 = 루트에 parent_message_id (슬랙식; 구 칩 '답글'의 승계 경로 = 시트 컴포저)
      await page.getByTestId('threads-open').click();
      await page.getByTestId('threads-modal').waitFor({ timeout: 5000 });
      await page.getByTestId('thread-row-tq1').click();
      await page.getByTestId('thread-sheet').first().waitFor({ timeout: 8000 });
      const composer = page.getByTestId('thread-sheet').first().locator('textarea[placeholder="에이전트에게 메시지 보내기"]');
      await composer.waitFor({ timeout: 8000 });
      // fill()은 RNW controlled TextInput의 onChange를 관통하지 못해 React state가 빈 값으로 남는다
      // (전송 early-return — diag 실측). pressSequentially의 실제 키 이벤트만 유효.
      await composer.click();
      await composer.pressSequentially('시트 경유 답글', { delay: 15 });
      await page.getByTestId('thread-sheet').first().locator('button', { hasText: '전송' }).first().click();
      await page.waitForTimeout(700);
      const posts = state.calls.filter((c) => c.path === '/api/sessions/source/messages' && c.method === 'POST');
      const reply = posts.find((c) => c.body && c.body.content === '시트 경유 답글');
      check('⑧ 시트 답글 POST = parent_message_id 루트(tq1) 고정', !!reply && reply.body.parent_message_id === 'tq1', JSON.stringify(reply && reply.body));
      // 시트 닫고 메인 리스트로 (바닥 시트가 롱프레스 히트를 덮음 — tracker 스모크 관례)
      await page.getByTestId('thread-panel-back').first().click();
      await page.waitForTimeout(600);
      // 메인 입력의 '답글'(인용배) = reply_to_id — 발화 자체는 루트 고정 아님 (t_62897e88 계약 그대로)
      await openKeyboardIfVoice(page);
      await longPress(page, page.getByTestId('message-row-ta1'));
      await page.getByTestId('msg-action-sheet').waitFor({ timeout: 4000 });
      check('⑧ 카드 시트 답글 행 = 칩 답글의 승계 진입점', await page.getByTestId('action-reply').isVisible());
      await page.getByTestId('action-reply').click();
      await page.getByTestId('chat-input').waitFor({ timeout: 5000 });
      await page.getByTestId('chat-input').fill('메인 인용 답글');
      await page.getByTestId('send-button').click();
      await page.waitForTimeout(700);
      const posts2 = state.calls.filter((c) => c.path === '/api/sessions/source/messages' && c.method === 'POST');
      const quote = posts2.find((c) => c.body && c.body.content === '메인 인용 답글');
      check('⑧ 메인 답글 POST = reply_to_id(ta1) 인용, parent 없음 (인용배 계약)', !!quote && quote.body.reply_to_id === 'ta1' && !quote.body.parent_message_id, JSON.stringify(quote && quote.body));
      check('⑥ 런타임 오류 없음(스파이)', errors.length === 0, errors.slice(0, 2).join('|'));
      await page.close();
    }

    // ── ③ 배지 0 = 미노출 (활성 스레드 없는 세션) ─────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.clock.setSystemTime(ANCHOR);
      await installFixtures(page, { threadsLite: true, anchorMs: ANCHOR });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await openChat(page);
      const txt = await page.getByTestId('threads-open').innerText();
      check('① 확장3: 활성 스레드 0 = 배지 숫자 미노출', txt.trim() === '답글', txt);
      await page.getByTestId('threads-open').click();
      await page.getByTestId('threads-modal').waitFor({ timeout: 5000 });
      check('② 빈 목록 = 안내 문구', await page.getByTestId('threads-modal').innerText().then((x) => x.includes('아직 답글이 달린 질문이 없어요')));
      check('⑥ 런타임 오류 없음(배지0)', errors.length === 0, errors.slice(0, 2).join('|'));
      await page.close();
    }

    // ── ④ 900(2-팬) 레이아웃: 레일 헤더 카운트 · 답글 버튼 위치 · 모달 캡처 ──
    // t_00fe9b0f 3-팬 개정 승계: 1440(wide)에서는 좌측 레일이 프로젝트 레일로 대체되고 스레드는
    // 우측 사이드체인 패널로 이관 → ThreadRail 유효 영역(768~1023)으로 뷰포트 하향, 계약 의미 불변.
    {
      const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.clock.setSystemTime(ANCHOR);
      await installFixtures(page, { threads: true, anchorMs: ANCHOR });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await openChat(page);
      let railHead = '';
      await page.getByTestId('thread-rail-count').waitFor({ timeout: 8000 });
      railHead = await page.getByTestId('thread-rail').innerText();
      check('⑤ 900: 레일 헤더 = 답글 + 활성 카운트 1', railHead.includes('답글')
        && (await page.getByTestId('thread-rail-count').innerText()) === '1', railHead.slice(0, 40));
      check('⑤ 900: 2-팬 = 우측 사이드체인 미렌더', (await page.getByTestId('sidechain-panel').count()) === 0);
      const railBox = await page.getByTestId('thread-rail').boundingBox();
      const btnBox = await page.getByTestId('threads-open').boundingBox();
      check('⑤ 900: 답글 버튼 = 앱바 상단·레일 우측', !!btnBox && !!railBox && btnBox.y < 90 && btnBox.x > railBox.x + railBox.width, btnBox ? `${Math.round(btnBox.x)},${Math.round(btnBox.y)}` : 'no box');
      await page.screenshot({ path: shot('04-pc1440-chat') });
      await page.getByTestId('threads-open').click();
      await page.getByTestId('threads-modal').waitFor({ timeout: 5000 });
      await page.getByTestId('threads-filter-all').click();
      await page.screenshot({ path: shot('05-pc1440-modal-all') });
      check('⑤ 900: 모달 전체 필터 = 2행+종료 배지', (await page.getByTestId('thread-ended-tq2').count()) === 1);
      await page.getByTestId('threads-close').click();
      check('⑥ 런타임 오류 없음(900)', errors.length === 0, errors.slice(0, 2).join('|'));
      await page.close();
    }

    // ── ⑤ EN 로케일 라벨 (구③) ───────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.clock.setSystemTime(ANCHOR);
      await installFixtures(page, { threads: true, anchorMs: ANCHOR });
      await page.addInitScript(() => localStorage.setItem('at-language', 'en')); // 후등록이 덮어쓴다 (tracker 스모크 관례)
      await page.goto(APP, { waitUntil: 'networkidle' });
      await openChat(page);
      const enBtn = page.getByTestId('threads-open');
      await enBtn.waitFor({ timeout: 6000 });
      let enBtnText = '';
      for (let i = 0; i < 20; i += 1) { enBtnText = await enBtn.innerText(); if (enBtnText.includes('1')) break; await page.waitForTimeout(200); }
      check('③ EN: 앱바 Reply + 배지 1', enBtnText.includes('Reply') && enBtnText.includes('1'), enBtnText);
      await enBtn.click();
      await page.getByTestId('threads-modal').waitFor({ timeout: 5000 });
      await page.getByTestId('thread-row-tq1').waitFor({ timeout: 5000 });
      const enRow = await page.getByTestId('thread-row-tq1').innerText();
      check('③ EN: 행 메타 = replies + 앵커-상대 1 hour ago', /1 replies/.test(enRow) && enRow.includes('1 hour ago'), enRow);
      await page.screenshot({ path: shot('06-en-modal-390') });
      check('⑥ 런타임 오류 없음(EN)', errors.length === 0, errors.slice(0, 2).join('|'));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} passed, ${failed} failed → ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
