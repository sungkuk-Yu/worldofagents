// t_0e03e405 스모크 — 확인응답 스레드화 + '질문 현황 = 顶级 질문만' (대표님 10/4 FINAL SCOPE)
//  ① 재질문 顶级 0건·스레드(확인 프레임) 1건 실측 — ack user 버블('예'/'아니요') 메인 피드 0
//  ② 칩 탭/2.5s 자동예(타임아웃) 후 답변 진행 정상 + 발화 user 카드 = 질문 현황 NOT
//  ③ '예를 들어…'류 진짜 질문 = 顶级 유지 (오탐 금지)
//  ④ smoke_tracker 불변식 확장: 질문 현황 항목 수 == 메인 채팅 顶级 user 질문 버블 수
//     (라이브 왕복: 질문 전송 → 재질문 → '예' 탭 → 답변 — 같은 왕복에서 read-back)
//  ⑤ 확인 스레드 프레임(원문 인용 헤더)+답변 진행+트래커 stage 전파 실측 캡처
// 실행: expo export --platform web --output-dir dist-t0e03e405 --clear
//       node tests/e2e/fr-serve.cjs dist-t0e03e405 8271
//       APP_URL=http://localhost:8271 node tests/e2e/smoke_confirm_thread_t_0e03e405.cjs
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8271';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'confirm-thread-t0e03e405');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 메인 피드 顶级 user 발화 텍스트 목록 (ack/답글 제외 렌더 실측) */
async function topUserTexts(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="message-user"]'))
    .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()));
}

/** 390px — 트래커는 하단 시트(앱바 '현황')에 살므로 열어서 실측 후 닫는다 */
async function trackerRows390(page) {
  await page.getByTestId('tracker-open').click();
  await page.getByTestId('tracker-modal').waitFor({ timeout: 5000 });
  const n = await page.locator('[data-testid^="tracker-row-"]').count();
  const texts = (await page.locator('[data-testid^="tracker-row-"]').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').slice(0, 40));
  await page.getByTestId('tracker-close').click();
  await page.getByTestId('tracker-modal').waitFor({ state: 'detached', timeout: 5000 });
  return { n, texts };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ══ H. 히스토리 재현 (PC 1440, confirm 시드) — ①③④⑤ 정적 판정 ═══════════════
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await installFixtures(page, { confirm: true, tracker: false });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').first().click();
      await page.getByTestId('message-list').waitFor({ timeout: 8000 });
      await page.getByTestId('question-tracker-panel').waitFor({ timeout: 8000 });

      // ④ 불변식: 트래커 항목 수(2: cq1·cq2) == 顶级 user 버블 수 (ca1 '예'·ca2 '아니요' 미렌더)
      const users = await topUserTexts(page);
      const rowCount = await page.locator('[data-testid^="tracker-row-"]').count();
      check('H④ 질문 현황 항목 수 == 顶级 user 질문 버블 수', rowCount === 2 && users.length === 2,
        `rows=${rowCount} bubbles=${users.length} texts=${JSON.stringify(users)}`);
      check("H① '예'/'아니요' 顶级 버블 0 — 재질문 顶级 0건·확인 스레드(프레임) 1건/왕복",
        !users.some((u) => u.includes('예') && !u.includes('질문')) && !users.some((u) => u === '아니요')
        && (await page.locator('[data-testid^="confirm-thread-"]').count()) === 2);
      // 프레임 헤더 = 원문 인용 ('확인 쓰레드' + 질문 텍스트)
      const frame = await page.getByTestId('confirm-thread-ce1').innerText();
      check('H⑤ 확인 스레드 프레임 = 원문 인용 헤더', frame.includes('확인 쓰레드') && frame.includes('확인 왕복 질문'), frame.replace(/\n/g, ' | ').slice(0, 90));
      // 병합 ack reply 라인이 프레임 내부에 렌더
      const reply = await page.getByTestId('confirm-reply-ca1').innerText();
      check('H① 병합 확인응답 = 프레임 내부 reply 라인', reply.includes('예'));
      // 뱃지 진입점: cq1 카드에 '확인 쓰레드' 뱃지
      check('H③ 질문 카드 확인 스레드 진입 뱃지', (await page.locator('[data-testid^="confirm-entry-"]').count()) === 2);
      // 트래커: 두 질문 모두 답변 귀속 → 완료(stage3), '확인 필요' 잔존 0, 답글 NOT
      const r1 = await page.getByTestId('tracker-row-cq1').innerText();
      const r2 = await page.getByTestId('tracker-row-cq2').innerText();
      check('H② 답변 전파: 확인 왕복 질문 = 완료', r1.includes('완료') && !r1.includes('확인 필요'), r1.replace(/\n/g, ' | ').slice(0, 80));
      check('H② 답변 전파: 구조 신호 왕복 질문 = 완료 (reply_to_id 병합)', r2.includes('완료') && !r2.includes('답글'), r2.replace(/\n/g, ' | ').slice(0, 80));
      // 뱃지 탭 = empathy 카드로 점프+하이라이트
      await page.getByTestId('confirm-entry-cq1').click();
      await page.getByTestId('focus-highlight').first().waitFor({ timeout: 5000 });
      check('H③ 뱃지 탭 → 확인 스레드 카드로 점프 하이라이트', true);
      await page.screenshot({ path: shot('01-history-frames.png') });

      // ③ 오탐 금지 라이브: empathy 없는 '예를 들어…' 발화는 顶级 유지 (POST 응답에 empathy 없음)
      await page.getByTestId('chat-input').fill('예를 들어 아침 루틴 정리법 알려줘');
      await page.getByTestId('send-button').click();
      await page.waitForTimeout(1200);
      const users2 = await topUserTexts(page);
      check('H③ 예들을-들어 발화 = 顶级 버블 유지 (오탐 금지)', users2.some((u) => u.includes('예를 들어 아침 루틴')), JSON.stringify(users2.slice(-2)));
      const rowCount2 = await page.locator('[data-testid^="tracker-row-"]').count();
      check('H③ 트래커 = 질문 3행 (질문 수 = 顶级 질문 수)', rowCount2 === 3, `rows=${rowCount2}`);
      assert.deepEqual(errors, [], 'PC 콘솔 오류 0');
      await page.close();
    }

    // ══ L. 라이브 왕복 (390px) — ② 칩 탭 → 답변 진행 + 질문 현황 불변 ═══════════════
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const posts = [];
      page.on('request', (req) => {
        if (req.url().includes('/messages') && req.method() === 'POST') {
          try { posts.push(JSON.parse(req.postData() || '{}').content); } catch { posts.push('?'); }
        }
      });
      const state = await installFixtures(page, { ack: true });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').first().click();
      await page.getByTestId('message-list').waitFor({ timeout: 8000 });
      // 390px B 계층 개방 (smoke_ack_chips openKeyboard 규격): 음성 스테이지 ↑ 스와이프 → 채팅 입력
      const box = await page.getByTestId('voice-stage').boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 10; i += 1) { await page.mouse.move(cx, cy - i * 20); await page.waitForTimeout(30); }
      await page.mouse.up();
      await page.getByTestId('chat-input').waitFor({ timeout: 8000 });

      // 질문 발화 → 재질문 칩 노출. 기준선: hu(이전 질문)만 = 1행
      await page.getByTestId('tracker-open').click();
      await page.getByTestId('tracker-modal').waitFor({ timeout: 5000 });
      const rowsBase = await page.locator('[data-testid^="tracker-row-"]').count();
      await page.getByTestId('tracker-close').click();
      await page.getByTestId('tracker-modal').waitFor({ state: 'detached', timeout: 5000 });
      check('L④ 기준선 = 이전 질문 1행', rowsBase === 1, `rows=${rowsBase}`);
      await page.getByTestId('chat-input').fill('트래커 오염 테스트 질문');
      await page.getByTestId('send-button').click();
      const chip = await page.getByTestId('ack-chips').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
      check('L 발화 → 재질문(확인) 칩 노출', chip);
      await page.getByTestId('tracker-open').click();
      await page.getByTestId('tracker-modal').waitFor({ timeout: 5000 });
      const rowsBefore = await page.locator('[data-testid^="tracker-row-"]').count();
      check('L④ 질문 전송 직후 = 질문 현황 2행 (원 질문+이전질문, 반짝 ack 행 NOT)', rowsBefore === 2, `rows=${rowsBefore}`);
      await page.screenshot({ path: shot('02-live-before-tap.png') });
      await page.getByTestId('tracker-close').click();
      await page.getByTestId('tracker-modal').waitFor({ state: 'detached', timeout: 5000 });

      // '예' 칩 탭 (2.5s 창 내) — 발화 payload = '예' 1회, 이후 답변 진행
      const n0 = posts.length;
      await page.getByTestId('ack-chip-yes').click({ timeout: 1500 }).catch(() => {});
      await sleep(800);
      check("L② 칩 탭 = '예' POST 1회 (게이트 계약 텍스트)", posts.length >= n0 + 1 && posts[posts.length - 1] === '예', JSON.stringify(posts.slice(n0)));
      // 답변 카드 도착까지 폴링 — '예' 턴의 답변('Test reply to 예') = 확인이 새 왕복을 일으키지 않고 진행한 증거
      let answer = '';
      for (let i = 0; i < 40 && !answer; i += 1) {
        answer = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('[data-testid="message-agent"]'));
          return cards.map((c) => (c.textContent || '')).some((x) => x.includes('Test reply to 예')) ? 'ok' : '';
        });
        if (!answer) await sleep(250);
      }
      check('L② 예 탭 후 답변 진행 (확인 응답 = 스레드 이벤트, 발화 자체 질문 NOT)', !!answer);
      // 顶级 user 버블에 '예' 없음 + 발화 2건(hu·새 질문)만 유지
      const users = await topUserTexts(page);
      check("L① 답변 왕복 후에도 '예' 顶级 버블 0", !users.some((u) => /^(예|아니요)/.test(u)), JSON.stringify(users));
      await sleep(400);
      const after = await trackerRows390(page);
      check('L④ 질문 수 = 顶级 질문 수 불변 (발화+재질문+예+답변 왕복 → 2행)', after.n === 2, `rows=${after.n} ${JSON.stringify(after.texts)}`);
      // 칩 미터치 경로(2.5s 자동 소진) 재확인 — 발화 가능 창 내 무터치 유지 → 자동 진행
      await page.getByTestId('chat-input').fill('자동예 경로 질문');
      await page.getByTestId('send-button').click();
      const chip2 = await page.getByTestId('ack-chips').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
      let gone = false;
      if (chip2) {
        for (let i = 0; i < 34 && !gone; i += 1) { await sleep(100); gone = (await page.getByTestId('ack-chips').count()) === 0; }
      }
      check('L② 2.5s 자동 소진 후 답변 자동 진행 (타임버 행도 스레드 이벤트)', chip2 && gone);
      await sleep(600);
      const after2 = await trackerRows390(page);
      check('L④ 자동소진 왕복 후 질문 현황 = 顶级 질문 수 (hu,q,q2 = 3행)', after2.n === 3, `rows=${after2.n} ${JSON.stringify(after2.texts)}`);
      await page.screenshot({ path: shot('03-live-after-answer.png') });
      assert.deepEqual(errors, [], '모바일 콘솔 오류 0');
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n=== confirm-thread smoke: ${passed} PASS / ${failed} FAIL ===`);
  if (failed) process.exit(1);
})().catch((e) => { console.error('CONFIRM THREAD SMOKE CRASH:', e); process.exit(1); });
