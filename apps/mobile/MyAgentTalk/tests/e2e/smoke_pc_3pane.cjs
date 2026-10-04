// t_00fe9b0f 3-팬 스모크 — 대표님 10/4 PC 레이아웃 최종 정의 + 포크 관리 모델 + 닫기 계약.
//  ① 1440×900 = 좌(새프로젝트 레일) + 중(메인 스트림) + 우(쓰레드 카드) + 컨텍스트(≥1280) 수납 실측
//  ② 상태색 3종 = 합의 상태(색값 계약): 주황#D97706=답변 계산 중 / 초록#16A34A=완료 / 빨강#DC2626=멈춤
//     — 판정 소스는 실데이터(답변 행·empathy 미해소)만. 재질문 미해소는 빨강, 답변 부재는 주황.
//  ③ 카드 → 단독 뷰: ← 복귀 · ◀▶ 다른 체인이동 · 닫기(confirmed 전용, 진행 중 비활성+툴팁) ·
//     'n closed' 카운터 → 재개방 → 일괄 '완료된 것 정리' → undo 3s → 복원.
//  ④ 새프로젝트(하드포크): 좌측 생성 버튼 → ForkDialog → fork POST(from=최종 확정 발화) → 새 방 진입,
//     계보 행 '#높이 · 원 체인' 표시, 아카이브는 세션 스코프(새 방 'n closed' 0).
//  ⑤ 회귀: 1100=3-팬(사이드체인 O, 컨텍스트 X) / 390=1-팬 불변(레일·패널 0, 현황 버튼 1).
// 실행: npx expo export --platform web --output-dir dist-3pane --clear
//       node tests/e2e/fr-serve.cjs dist-3pane 8263
//       APP_URL=http://localhost:8263 node tests/e2e/smoke_pc_3pane.cjs
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8263';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'pc-3pane');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const COLOR = { pending: 'rgb(217, 119, 6)', confirmed: 'rgb(22, 163, 74)', stalled: 'rgb(220, 38, 38)' };
const dotColor = async (page, id) => page.evaluate((t) => {
  const el = document.querySelector(`[data-testid="${t}"]`);
  return el ? getComputedStyle(el).backgroundColor : 'missing';
}, id);
const enterChat = async (page) => {
  await page.getByTestId('session-card').first().click();
  await page.getByTestId('chat-appbar').waitFor({ timeout: 8000 });
};

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ── ①·②·③ 1440: 3-팬 수납 + 3색 실측 + 닫기 왕복 ────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page, { chains: true });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await enterChat(page);

      // ① 3팬 동시 수납: 좌=project-rail(x≈0), 중=chat, 우=sidechain → context(1440 끝)
      await page.getByTestId('sidechain-card-q1').waitFor({ timeout: 8000 });
      const rail = await page.getByTestId('project-rail').boundingBox();
      const chain = await page.getByTestId('sidechain-panel').boundingBox();
      const ctxb = await page.getByTestId('context-panel').boundingBox();
      check('① 좌 레일 = 좌측 정렬', !!rail && rail.x < 20 && rail.width > 200, JSON.stringify(rail));
      check('① 우 = 사이드체인+컨텍스트 2패널(≥1280), 컨텍스트가 우측 끝', !!chain && !!ctxb
        && Math.abs(chain.x + chain.width - ctxb.x) < 2 && Math.abs(ctxb.x + ctxb.width - 1440) < 2, JSON.stringify(chain) + JSON.stringify(ctxb));
      const bar = await page.getByTestId('chat-appbar').boundingBox();
      check('① 가운데 스트림 = 양 패널 사이', !!bar && bar.x > rail.x + rail.width && bar.x + bar.width <= chain.x, JSON.stringify(bar));

      // ② 3색 = 합의 상태 (색값 계약, 실데이터 판정)
      check('② q1 완료=초록(#16A34A)', (await dotColor(page, 'sidechain-dot-q1')) === COLOR.confirmed, await dotColor(page, 'sidechain-dot-q1'));
      check('② q2 답변없음=주황(#D97706, 계산 중)', (await dotColor(page, 'sidechain-dot-q2')) === COLOR.pending);
      check('② q3 empathy미해소=빨강(#DC2626, 멈춤)', (await dotColor(page, 'sidechain-dot-q3')) === COLOR.stalled);
      check('② 리스트=색점만(단계바 DOM 0)', (await page.getByTestId('sidechain-panel').getByTestId('tracker-steps').count()) === 0);

      // ③ 단독 뷰: 진행 중 닫기 비활성(disabled DOM+툴팁) → ← · ◀▶ 다른 체인이동
      //    카드 순서(마지막 활동 내림): q4 > q3 > q2 > q1
      await page.getByTestId('sidechain-card-q2').click();
      await page.getByTestId('sidechain-detail').waitFor({ timeout: 5000 });
      check('③ 단독 뷰 = 그 체인만(원 질문 헤더 발췌)', (await page.getByTestId('sidechain-detail').innerText()).includes('체인 진행 질문'));
      check('③ 진행 중(pending) 닫기 비활성 DOM+\'답변 중이에요\'', (await page.locator('[data-testid="sidechain-close"][disabled]').count()) === 1
        && (await page.getByTestId('sidechain-close-hint').innerText()).includes('답변 중'));
      await page.getByTestId('sidechain-prev').click();
      await page.waitForTimeout(300);
      check('③ ◀ 다른 체인이동 → q3 멈춤=\'확인 대기 중이에요\'', (await page.getByTestId('sidechain-detail').innerText()).includes('체인 확인 질문')
        && (await page.getByTestId('sidechain-close-hint').innerText()).includes('확인 대기'));
      await page.getByTestId('sidechain-back').click();
      await page.getByTestId('sidechain-panel').waitFor({ timeout: 5000 });
      check('③ ← 리스트 복귀', (await page.getByTestId('sidechain-card-q3').count()) === 1);

      // ③ 닫기(confirmed) → '1 closed' → 재개방 → 단독 뷰 → 일괄 정리 → undo 복원
      await page.getByTestId('sidechain-card-q1').click();
      await page.getByTestId('sidechain-close').waitFor({ timeout: 5000 });
      await page.getByTestId('sidechain-close').click();
      await page.getByTestId('sidechain-closed-count').waitFor({ timeout: 5000 });
      check('③ 닫기(초록 전용) → 리스트 접힘+\'1 closed\'', (await page.getByTestId('sidechain-card-q1').count()) === 0
        && (await page.getByTestId('sidechain-closed-count').innerText()).includes('1'));
      await page.getByTestId('sidechain-reopen-q1').click();
      let detailText = '';
      for (let i = 0; i < 20; i += 1) {
        detailText = await page.getByTestId('sidechain-detail').innerText().catch(() => '');
        if (detailText.includes('체인 완료 질문')) break;
        await page.waitForTimeout(250);
      }
      check('③ 재개방 → 단독 뷰 원 질문 노출', detailText.includes('체인 완료 질문'));
      await page.getByTestId('sidechain-back').click();
      await page.getByTestId('sidechain-close-all').click();
      await page.getByTestId('sidechain-undo').waitFor({ timeout: 3000 });
      check('③ 일괄 \'완료된 것 정리\' → q4 접힘+\'2 closed\'', (await page.getByTestId('sidechain-card-q4').count()) === 0
        && (await page.getByTestId('sidechain-closed-count').innerText()).includes('2'));
      await page.getByTestId('sidechain-undo').click();
      await page.waitForTimeout(300);
      // undo = closeMany 직전 스냅샷({} — q1은 재개방으로 이미 열린 뒤의 일괄 닫기였으므로 원복 시 closed 0)
      check('③ undo 3s → q4 원복+\'n closed\' 소멸', (await page.getByTestId('sidechain-card-q4').count()) === 1
        && (await page.getByTestId('sidechain-closed-count').count()) === 0);
      await page.screenshot({ path: shot('01-pc1440-3pane') });
      assert.deepEqual(errors, [], '1440 콘솔 오류 0');
      await page.close();
    }

    // ── ④ 새프로젝트(하드포크): 닫힘 세션 격리 → 생성 버튼 → fork POST(최후 확정 발화) → 계보 2단계 ──
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page, { chains: true });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await enterChat(page);
      await page.getByTestId('sidechain-card-q1').waitFor({ timeout: 8000 });
      // 원 방에서 q1 닫기(아카이브) — 세션 스코프 검증의 전제 상태
      await page.getByTestId('sidechain-card-q1').click();
      await page.getByTestId('sidechain-close').waitFor({ timeout: 5000 });
      await page.getByTestId('sidechain-close').click();
      await page.getByTestId('sidechain-closed-count').waitFor({ timeout: 5000 });
      // 시드 계보: f1 = source의 #4에서 갈라짐 — 좌측 행에 표시
      const lineage = await page.getByTestId('project-lineage-f1').innerText();
      check('④ 좌측 하드포크 계보 행(#높이 · 원 체인)', lineage.includes('#4') && lineage.includes('Original project'), lineage);
      await page.getByTestId('project-row-f1').click();
      await page.getByTestId('chat-appbar').waitFor({ timeout: 8000 });
      await page.getByTestId('sidechain-card-q1').waitFor({ timeout: 8000 });
      check('④ 행 탭 = 포크 세션 진입(제목=하드포크 프로젝트)', (await page.getByTestId('chat-appbar-title').innerText()).includes('하드포크'));
      check('④ 아카이브 세션 스코프 — 원 방의 \'1 closed\'가 새 방에 비누출', (await page.getByTestId('sidechain-closed-count').count()) === 0);
      await page.screenshot({ path: shot('02-fork-session') });
      // 생성 = f1 방의 최후 확정 발화(e3) 지점 포크 → ForkDialog → fork POST → 새 방 진입
      await page.getByTestId('project-new').click();
      await page.getByTestId('fork-title').waitFor({ timeout: 5000 });
      await page.getByTestId('fork-submit').click();
      await page.waitForTimeout(800);
      const forkCall = state.calls.find((c) => c.path.endsWith('/fork') && c.method === 'POST' && c.path.includes('/f1/'));
      check('④ fork POST = 최후 확정 발화(from_message_id=e3)', !!forkCall && forkCall.body.from_message_id === 'e3', JSON.stringify(forkCall?.body || ''));
      check('④ 하드포크 진입(방명=dialog 기본 제목)', (await page.getByTestId('chat-appbar-title').innerText()).includes('하드포크'), await page.getByTestId('chat-appbar-title').innerText());
      // 계보 2단계 read-back: 새 방(forked)의 원 체인 = f1('하드포크 프로젝트')
      const lineage2 = await page.getByTestId('project-lineage-forked').innerText().catch(() => 'missing');
      check('④ 새 하드포크 계보 = 원 체인(f1)에서 #높이', lineage2 !== 'missing' && lineage2.includes('하드포크 프로젝트'), lineage2);
      await page.screenshot({ path: shot('03-hardfork-lineage') });
      assert.deepEqual(errors, [], '포크 플로우 콘솔 오류 0');
      await page.close();
    }

    // ── ⑤ 회귀: 1100(3-팬, 컨텍스트 없음) · 390(1-팬 불변) ────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await installFixtures(page, { chains: true });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await enterChat(page);
      await page.getByTestId('sidechain-card-q1').waitFor({ timeout: 8000 });
      check('⑤ 1100 — 좌 프로젝트 레일+우 사이드체인', (await page.getByTestId('project-rail').count()) === 1
        && (await page.getByTestId('sidechain-panel').count()) === 1);
      check('⑤ 1100 — 컨텍스트 패널 미수납(폭 절층)', (await page.getByTestId('context-panel').count()) === 0);
      check('⑤ 1100 — 현황 버튼 복귀(패널 없음)', (await page.getByTestId('tracker-open').count()) === 1);
      await page.screenshot({ path: shot('04-pc1100-3pane') });
      assert.deepEqual(errors, [], '1100 콘솔 오류 0');
      await page.close();
    }
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await installFixtures(page, { chains: true });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await enterChat(page);
      await page.waitForTimeout(500);
      check('⑤ 390 — 1-팬 불변(레일·사이드체인·컨텍스트 0)', (await page.getByTestId('project-rail').count()) === 0
        && (await page.getByTestId('thread-rail').count()) === 0
        && (await page.getByTestId('sidechain-panel').count()) === 0
        && (await page.getByTestId('context-panel').count()) === 0);
      check('⑤ 390 — 현황 시트 버튼 유지', (await page.getByTestId('tracker-open').count()) === 1);
      await page.getByTestId('tracker-open').click();
      await page.getByTestId('tracker-modal').waitFor({ timeout: 5000 });
      check('⑤ 390 — 현황 시트 오픈(모바일 경로 건재)', true);
      await page.screenshot({ path: shot('05-m390-onepane') });
      assert.deepEqual(errors, [], '390 콘솔 오류 0');
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n=== smoke_pc_3pane: ${passed} PASS / ${failed} FAIL ===`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
