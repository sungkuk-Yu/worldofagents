// t_fd869e5b 스모크 — 레이아웃 확정 3종 (대표님 10/4 지시 3건)
//  A. 볼트 UI 소멸: vault-button/context-note 잔존 0 + 라우트 진입 불가 + '노트' 문구 0 (grep 0 실측과 별도)
//  B. 내 질문 트래커: PC 1440 우측 패널에 질문 3단계 행 렌더 (완료+답글수 / 접수됨 / 확인필요),
//     24h 경과 완료 축약 요약, 행 탭 = 카드 점프 하이라이트, WS 큐 스냅샷 answered → 완료 승격.
//     390px는 우측 패널 0 + 앱바 '현황' → 하단 시트 동일 행.
//  C. 즐겨찾기 상단 모달: 헤더 ★ → favorites-modal (라우트 push 아님), 행 탭 = 딥링크 focus-highlight.
//  D. 좌측 슬랙식 스레드 레일: 1440 채팅 = thread-rail이 세션목록 자리 대체, 답글 스레드 행 표시,
//     행 탭 = 레일 내부 상세(ThreadPanel) 원본 고정.
// 실행: (export) expo export --platform web --output-dir dist-tracker --clear
//       node tests/e2e/fr-serve.cjs dist-tracker 8261
//       APP_URL=http://localhost:8261 node tests/e2e/smoke_tracker_t_fd869e5b.cjs
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8261';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'tracker-fd869e5b');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ── A·B·C·D: PC 1440 (우측 패널 + 좌측 스레드 레일) ─────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page, { tracker: true });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').first().click();
      await page.getByTestId('message-list').waitFor({ timeout: 8000 });

      // A. 볼트 잔존 0 — 버튼/섹션/노트 행 렌더 소멸
      check('A: vault-button 0개', (await page.getByTestId('vault-button').count()) === 0);
      check('A: context-note-* 0개', (await page.locator('[data-testid^="context-note-"]').count()) === 0);
      const panel = page.getByTestId('context-panel');
      await panel.waitFor({ timeout: 8000 });
      const panelText = await panel.innerText();
      check('A: 패널에 노트 문구 0', !/노트/.test(panelText));
      check('A: listNotes API 호출 0', !state.calls.some((c) => c.path.startsWith('/api/vault')));

      // B. 트래커 행 — 완료/답글/확인필요/접수 + 24h 축약
      check('B: 우측 패널 트래커 섹션 렌더', (await page.getByTestId('question-tracker-panel').count()) === 1);
      check('B: 24h 경과 완료 = 축약 요약', await page.getByTestId('tracker-collapsed').isVisible());
      await page.getByTestId('tracker-row-q-new').waitFor({ timeout: 5000 });
      await page.getByTestId('tracker-row-q-ask').waitFor({ timeout: 5000 });
      check('B: 완료 질문은 축약 전 24h 내 행 유지', (await page.getByTestId('tracker-row-q-done').count()) === 1);
      check('B: 새 질문 = 접수됨 라벨', (await page.getByTestId('tracker-row-q-new').innerText()).includes('접수됨'));
      check('B: 확인 질문 = 이해 확인 중 + 확인 필요 배지', (await page.getByTestId('tracker-row-q-ask').innerText()).includes('이해 확인 중')
        && (await page.getByTestId('tracker-ask-q-ask').count()) === 1);
      check('B: 완료 질문 = 답글 1 (슬랙식)', (await page.getByTestId('tracker-row-q-done').innerText()).includes('답글'));
      // t_0e03e405 ④ 불변식 — '질문 현황 항목 수(+축약 완료) == 顶级(사용자) 질문 버블 수':
      // 시드 4질문 중 q-old는 24h 축약(행 3 + collapsed 1) ↔ message-user 4 (답글 r-done는 thread 전용,
      // empathy e-ask·answer 행은 agent — 질문 카운트 비대상).
      {
        const rowN = await page.locator('[data-testid^="tracker-row-"]').count();
        const bubN = await page.getByTestId('message-user').count();
        const collapsedN = await page.getByTestId('tracker-collapsed').count();
        check('B④ 질문 수(+축약) = 顶级 질문 수 불변식', rowN === 3 && bubN === 4 && collapsedN === 1, `rows=${rowN}+collapsed=${collapsedN} bubbles=${bubN}`);
      }
      // 행 탭 = 카드 점프+하이라이트
      await page.getByTestId('tracker-jump-q-new').click();
      await page.getByTestId('focus-highlight').first().waitFor({ timeout: 5000 });
      check('B: 행 탭 → 카드 점프 하이라이트', true);
      await page.screenshot({ path: shot('01-pc1440-panel') });
      const mainSock = () => state.sockets[0]; // 시트/레일 마운트가 소켓을 추가 생성 — 원본 채팅 세션은 0번
      // 답글 칩 탭 = 스레드 개방 (ThreadSheet #52 디텐트)
      await page.getByTestId('tracker-thread-q-done').click();
      await page.getByTestId('thread-sheet').first().waitFor({ timeout: 8000 });
      check('B: 답글 칩 탭 → 스레드 시트 개방', true);
      await page.getByTestId('thread-panel-back').first().click();
      await page.waitForTimeout(500);
      // WS 회신 대기 스냅샷 → 새 질문 '확인 필요' 승격/해소 (reply.pending.updated 단일 원천)
      mainSock().send(JSON.stringify({ type: 'reply.pending.updated', session_id: 'source', count: 1, items: [{ message_id: 'q-new', turn_index: 5, excerpt: '트래커 새 질문', reply_kind: 'freeform' }] }));
      await page.waitForTimeout(300);
      check('B: WS reply.pending → 확인 필요 배지 승격', (await page.getByTestId('tracker-ask-q-new').count()) === 1);
      mainSock().send(JSON.stringify({ type: 'reply.pending.updated', session_id: 'source', count: 0, items: [] }));
      await page.waitForTimeout(300);
      check('B: 해소 스냅샷 → 배지 소멸', (await page.getByTestId('tracker-ask-q-new').count()) === 0);
      // WS 큐 스냅샷 answered → 접수됨 질문 완료 승격 (서버 우선 2계층)
      mainSock().send(JSON.stringify({ type: 'queue.updated', session_id: 'source', items: [{ id: 'qq1', content: '트래커 새 질문', status: 'answered', position: 5 }] }));
      await page.waitForTimeout(300);
      check('B: WS queue.answered → 완료 승격', (await page.getByTestId('tracker-row-q-new').innerText()).includes('완료'));

      // D. 좌측 스레드 레일 (슬랙식) — 세션목록 자리 대체
      const rail = page.getByTestId('thread-rail');
      check('D: 좌측 레일 = 스레드 전용 공간', (await rail.count()) === 1);
      check('D: 레일에 답글 스레드 행 (q-done)', (await page.getByTestId('thread-rail-row-q-done').count()) === 1);
      check('D: 레일 = 세션목록(new-chat-button) 대체', (await rail.getByTestId('new-chat-button').count()) === 0);
      await page.getByTestId('thread-rail-row-q-done').click();
      await page.getByTestId('thread-rail-detail').waitFor({ timeout: 8000 });
      // 레일 상세 = ThreadPanel이 GET /messages/:id/thread 비동기 로드 → 원문 노출까지 폴링
      let detailText = '';
      for (let i = 0; i < 20; i += 1) {
        detailText = await page.getByTestId('thread-rail-detail').innerText();
        if (detailText.includes('트래커 완료 질문')) break;
        await page.waitForTimeout(250);
      }
      check('D: 행 탭 → 레일 내부 상세(원본 고정)', detailText.includes('트래커 완료 질문'));
      await page.screenshot({ path: shot('02-pc1440-rail-thread') });
      await page.getByTestId('thread-panel-back').first().click();
      await page.getByTestId('thread-rail-row-q-done').waitFor({ timeout: 5000 });
      check('D: 상세 뒤로 → 레일 목록 복귀', true);

      // C. 즐겨찾기 상단 모달 — ContextPanel '전체' 링크
      await page.getByTestId('context-panel').getByText('전체', { exact: true }).first().click();
      await page.getByTestId('favorites-modal').waitFor({ timeout: 5000 });
      check('C: 즐겨찾기 = 상단 모달(라우트 push 아님)', true);
      await page.screenshot({ path: shot('03-pc1440-favorites-modal') });
      await page.getByTestId('favorites-modal-close').click();
      await page.getByTestId('favorites-modal').waitFor({ state: 'detached', timeout: 5000 });
      check('C: ✕ 닫기 → 모달 소멸', true);
      assert.deepEqual(errors, [], 'PC 콘솔 오류 0');
      await page.close();
    }

    // ── 390px 모바일: 패널 0 · 현황 버튼 → 시트 · 헤더 ★ 모달 ─────────────
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await installFixtures(page, { tracker: true });
      await page.goto(APP, { waitUntil: 'networkidle' });
      // 헤더 ★ → 상단 모달 (목록 화면)
      await page.getByTestId('favorites-button').click();
      await page.getByTestId('favorites-modal').waitFor({ timeout: 8000 });
      check('C390: 목록 ★ 탭 → 상단 모달', true);
      await page.screenshot({ path: shot('04-m390-favorites-modal') });
      await page.getByTestId('favorites-modal-close').click();
      await page.waitForTimeout(250);
      await page.getByTestId('session-card').first().click();
      await page.getByTestId('message-list').waitFor({ timeout: 8000 });
      check('B390: 우측 패널 미렌더 (단일 컬럼)', (await page.getByTestId('context-panel').count()) === 0);
      check('A390: 화면 어디에도 볼트 진입 없음', (await page.getByTestId('vault-button').count()) === 0
        && (await page.locator('[data-testid^="context-note-"]').count()) === 0);
      await page.getByTestId('tracker-open').click();
      await page.getByTestId('tracker-modal').waitFor({ timeout: 5000 });
      check('B390: 앱바 현황 버튼 → 트래커 시트 (행 렌더)', (await page.getByTestId('tracker-row-q-new').count()) === 1);
      await page.screenshot({ path: shot('05-m390-tracker-modal') });
      await page.getByTestId('tracker-close').click();
      await page.getByTestId('tracker-modal').waitFor({ state: 'detached', timeout: 5000 });
      assert.deepEqual(errors, [], '모바일 콘솔 오류 0');
      await page.close();
    }

    // ── EN 라벨 스모크 ─────────────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
      await installFixtures(page, { tracker: true }); // init script 등록 순서 주의: 기본 'ko' 세팅(설치기 내부)을
      await page.addInitScript(() => localStorage.setItem('at-language', 'en')); // 후등록 스크립트가 덮어쓴다(같은 값이면 마지막 실행 wins)
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').first().click();
      await page.getByTestId('tracker-row-q-new').waitFor({ timeout: 8000 });
      // initializeLanguage의 changeLanguage는 비동기 — 첫 프레임 ko 라벨과 경합하므로 폴링 (smoke_i18n_proof 관례)
      let en = '';
      for (let i = 0; i < 20; i += 1) {
        en = await page.getByTestId('tracker-row-q-new').innerText();
        if (/Received/.test(en)) break;
        await page.waitForTimeout(250);
      }
      check('EN: Received 라벨', /Received/.test(en), en.replace(/\n/g, ' | '));
      check('EN: 레일 Threads 헤더', (await page.getByTestId('thread-rail').innerText()).length > 0);
      await page.screenshot({ path: shot('06-en1440-panel') });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n=== tracker smoke: ${passed} PASS / ${failed} FAIL ===`);
  if (failed) process.exit(1);
})().catch((e) => { console.error('TRACKER SMOKE CRASH:', e); process.exit(1); });
