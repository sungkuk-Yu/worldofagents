/**
 * t_dee9e982 (대표님 9/29) — 짧은 히스토리 하단 앵커 회귀 캡처+지오메트리
 * 증상: 세션이 짧으면(1~2행) 발화가 화면 상단에 붙고 아래가 통째로 빈다 (listContent에
 * justifyContent:flex-end 없던 회귀). 수리: CHAT_LIST_ANCHOR(flexGrow:1 + flex-end).
 * 4상태: ① 모바일 390 A계층(voice strip) ② PC 1440 ③ 데모(voiceMode=false) ④ 키보드 개방(B).
 * +⑤ 긴 히스토리 정상 스크롤(상단 절단 없음) 회귀.
 * 앵커 판정: 짧은 리스트 = 마지막 발화 하단 여유 ≤ 입력경계 여백+α(strip 높이 or 통지 12+40).
 * 　(A계층 1턴 2행 ≈250px < 374px 가용영역 = true '짧은' 구간. 2턴 4행은 A에서 이미 스크롤
 * 　구간이라 앵커 판정 대상 아님 — 초기 FAIL은 프로브로 실측 구분함.)
 * 실행: node tests/e2e/fr-serve.cjs dist-anchor 8162
 *       APP_URL=http://localhost:8162 node tests/e2e/smoke_bottom_anchor.cjs
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice, backToVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8162';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'layout');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

// 리스트(스크롤 박스) 대비 마지막 발화 앵커 지오메트리 한 덩어리 측정.
// ★ 가림 판정은 '뷰포트에 실제 보이는' 마지막 행만 스코프 (웹 FlatList 리사이클 유령 행은
//   뷰포트 밖 절대위치에 잔존 — 裸 max(bottom)은 오염값, 초기 FAIL 원인). 앵커(여유) 판정은
//   마지막 행의 콘텐츠 좌표 기준이므로 그대로.
async function anchorGeometry(page) {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="message-list"]');
    const cards = Array.from(document.querySelectorAll('[data-testid="message-agent"],[data-testid="message-user"]'));
    const strip = document.querySelector('[data-testid="voice-stage"]');
    const bar = document.querySelector('[data-testid="chat-input-bar"]') || (document.querySelector('[data-testid="chat-input"]') ? document.querySelector('[data-testid="chat-input"]').closest('div[class]') : null);
    const lr = list ? list.getBoundingClientRect() : null;
    const rects = cards.map((c) => c.getBoundingClientRect());
    const lastBottom = rects.length ? Math.max(...rects.map((r) => r.bottom)) : null;
    const firstTop = rects.length ? Math.min(...rects.map((r) => r.top)) : null;
    // 스크롤 박스 안에 실제로 보이는 행들의 최소 top(절단 검사용)
    const visibleTops = rects.filter((r) => r.bottom > lr.top + 1 && r.top < lr.bottom - 1).map((r) => r.top);
    return {
      list: lr ? { top: Math.round(lr.top), bottom: Math.round(lr.bottom), h: Math.round(lr.height) } : null,
      listScroll: list ? { sh: list.scrollHeight, ch: list.clientHeight, st: Math.round(list.scrollTop) } : null,
      cardCount: cards.length,
      lastBottom: lastBottom === null ? null : Math.round(lastBottom),
      firstTop: firstTop === null ? null : Math.round(firstTop),
      minVisibleTop: visibleTops.length ? Math.round(Math.min(...visibleTops)) : null,
      anchorGap: lastBottom === null || !lr ? null : Math.round(lr.bottom - lastBottom),
      stripTop: strip ? Math.round(strip.getBoundingClientRect().top) : null,
      barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
      vh: window.innerHeight,
    };
  });
}

async function scrollToBottom(page) {
  await page.evaluate(() => {
    const l = document.querySelector('[data-testid="message-list"]');
    l.scrollTop = l.scrollHeight;
  });
  await page.waitForTimeout(450);
}

async function openChat(browser, viewport, { demo = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await installFixtures(page);
  await page.goto(APP, { waitUntil: 'networkidle' });
  if (demo) {
    // DialogueList(settings-button) → Settings '데모로 둘러보기'(demo-button) → Chat(demo) — 공식 진입로(smoke_failure_paths와 동일)
    await page.getByTestId('settings-button').waitFor({ timeout: 15000 });
    await page.getByTestId('settings-button').click();
    await page.getByTestId('demo-button').waitFor({ timeout: 15000 });
    await page.getByTestId('demo-button').click();
  } else {
    await page.getByTestId('session-card').click();
  }
  await page.getByTestId('message-list').waitFor({ timeout: 15000 });
  return { page, errors };
}

async function send(page, texts) {
  await openKeyboardIfVoice(page);
  for (const t of texts) {
    await page.getByTestId('chat-input').fill(t);
    await page.getByTestId('send-button').click();
    await page.getByText('Test reply to ' + t, { exact: true }).first().waitFor({ timeout: 15000 });
  }
  await page.waitForTimeout(600); // 페인트 대기 (fade 함정, t_3116c5bc)
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const results = {};
  try {
    // ── ①/④ 모바일 390: 짧은 히스토리(1발화=2행) — B(키보드) 측정 후 A(스트립) 복귀 측정 ──
    {
      const { page, errors } = await openChat(browser, { width: 390, height: 844 });
      await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
      await send(page, ['앵커1']); // 발화1+답변1 = true 짧은 세션

      const gb = await anchorGeometry(page); // ④ B 계층(send 직후 = 키보드 열림, strip 없음)
      results.m390B = gb;
      check('④ B: strip 미렌더', gb.stripTop === null);
      check('④ B: 짧은 리스트 마지막 발화 입력bar 위 앵커(여유 ≤ bar+40)', gb.anchorGap !== null && gb.barTop !== null && gb.anchorGap <= (gb.vh - gb.barTop) + 40, `gap=${gb.anchorGap} bar.top=${gb.barTop}`);
      check('④ B: 마지막 발화 < 입력bar 상단(겹침 0)', gb.lastBottom !== null && gb.barTop !== null && gb.lastBottom <= gb.barTop + 4, `last.bottom=${gb.lastBottom} bar.top=${gb.barTop}`);
      await page.screenshot({ path: shot('짧은세션-모바일390-키보드') });

      await backToVoice(page); // A 복귀: 패딩=voiceStageHeight 오버라이드 + flex-end 앵커
      await page.waitForTimeout(600); // A 전환 리레이아웃 안착 대기(패딩 오버라이드 반영)
      const ga = await anchorGeometry(page); // ① A 계층
      results.m390A = ga;
      check('① A: 마지막 발화 하단 앵커(여유 = strip+α, 상단 고정 아님)', ga.anchorGap !== null && ga.stripTop !== null && ga.anchorGap <= (ga.vh - ga.stripTop) + 40, `gap=${ga.anchorGap} strip.top=${ga.stripTop}`);
      check('① A: 마지막 발화 strip에 가림 0(패딩=strip 실측 계약)', ga.lastBottom !== null && ga.stripTop !== null && ga.lastBottom <= ga.stripTop + 4, `last.bottom=${ga.lastBottom} strip.top=${ga.stripTop}`);
      check('① A: 마지막 발화 리스트 상단 경계보다 아래(빈 화면 회귀 아님)', ga.lastBottom !== null && ga.lastBottom > ga.list.top, `last.bottom=${ga.lastBottom} list.top=${ga.list.top}`);
      check('① A: 런타임 오류 0', errors.length === 0, errors.join('|').slice(0, 140));
      await page.screenshot({ path: shot('짧은세션-모바일390-A') });
      await page.close();
    }

    // ── ② PC 1440: 짧은 히스토리 하단 앵커(입력바 위) ──
    {
      const { page, errors } = await openChat(browser, { width: 1440, height: 900 });
      await page.getByTestId('chat-input').waitFor({ timeout: 15000 });
      await page.getByTestId('chat-input').fill('PC 앵커 발화');
      await page.getByTestId('send-button').click();
      await page.getByText('Test reply to PC 앵커 발화', { exact: true }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      const g = await anchorGeometry(page);
      results.p1440 = g;
      check('② PC 짧은 리스트 하단 앵커(여유 ≤ bar+40)', g.anchorGap !== null && g.barTop !== null && g.anchorGap <= (g.vh - g.barTop) + 40, `gap=${g.anchorGap} bar.top=${g.barTop}`);
      check('② PC 마지막 발화 < 입력바 상단', g.lastBottom !== null && g.barTop !== null && g.lastBottom <= g.barTop + 4, `last.bottom=${g.lastBottom} bar=${g.barTop}`);
      check('② PC 런타임 오류 0', errors.length === 0, errors.join('|').slice(0, 140));
      await page.screenshot({ path: shot('짧은세션-PC1440') });
      await page.close();
    }

    // ── ③ 데모(voiceMode=false): 입력바 상시 + 하단 앵커 ──
    {
      const { page, errors } = await openChat(browser, { width: 390, height: 844 }, { demo: true });
      await page.getByTestId('chat-input').waitFor({ timeout: 15000 });
      await page.getByTestId('chat-input').fill('데모 앵커 발화');
      await page.getByTestId('send-button').click();
      await page.getByTestId('message-agent').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      const g = await anchorGeometry(page);
      results.demo = g;
      check('③ 데모 음성 스테이지 없음(바 입력 상시)', g.stripTop === null);
      check('③ 데모 짧은 리스트 하단 앵커', g.anchorGap !== null && g.barTop !== null && g.anchorGap <= (g.vh - g.barTop) + 40, `gap=${g.anchorGap} bar=${g.barTop}`);
      check('③ 데모 런타임 오류 0', errors.length === 0, errors.join('|').slice(0, 140));
      await page.screenshot({ path: shot('짧은세션-데모') });
      await page.close();
    }

    // ── ⑤ 긴 히스토리 회귀: 플렉스 초과 = 정상 스크롤(상단 절단 없음) — A계층 가림 유지 ──
    {
      const { page, errors } = await openChat(browser, { width: 390, height: 844 });
      await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
      for (let i = 1; i <= 6; i++) await send(page, [`긴회귀${i}`]);
      await backToVoice(page); // B→A: 스트립 가림 판정은 A 계층에서 (패딩=strip 계약)
      await page.waitForTimeout(600);
      const scroll = await page.evaluate(() => {
        const l = document.querySelector('[data-testid="message-list"]');
        return { sh: l.scrollHeight, ch: l.clientHeight };
      });
      check('⑤ 긴 리스트 스크롤 가능(플렉스 초과)', scroll.sh > scroll.ch + 2, `scrollH=${scroll.sh} client=${scroll.ch}`);
      await scrollToBottom(page);
      const g = await anchorGeometry(page);
      results.longA = g;
      const visLast = await page.evaluate(() => {
        // 뷰포트에 실제로 보이는 최하단 메시지 행만 스코프 (리사이클 유령 행 제외)
        const l = document.querySelector('[data-testid="message-list"]');
        const lr = l.getBoundingClientRect();
        let max = null;
        for (const c of document.querySelectorAll('[data-testid="message-agent"],[data-testid="message-user"]')) {
          const r = c.getBoundingClientRect();
          if (r.bottom > lr.top + 1 && r.top < lr.bottom - 1) max = max === null ? r.bottom : Math.max(max, r.bottom);
        }
        return max === null ? null : Math.round(max);
      });
      check('⑤ 최하단 스크롤 시 보이는 마지막 발화 strip 위(가림 0)', visLast !== null && g.stripTop !== null && visLast <= g.stripTop + 4, `visible.last.bottom=${visLast} strip.top=${g.stripTop}`);
      await page.evaluate(() => { const l = document.querySelector('[data-testid="message-list"]'); l.scrollTop = 0; });
      await page.waitForTimeout(350);
      const g0 = await anchorGeometry(page);
      // top=0에서 첫 발화가 리스트 상단 경계~+150(헤더/패딩) 사이 = 상단 절단 없음(flex-end 부작용 차단)
      const headOk = g0.minVisibleTop !== null && g0.minVisibleTop >= g0.list.top - 2 && g0.minVisibleTop <= g0.list.top + 150;
      check('⑤ top=0에서 첫 발화 헤드 바로 아래 노출(상단 절단 없음)', headOk, `minVisibleTop=${g0.minVisibleTop} list.top=${g0.list.top}`);
      await page.screenshot({ path: shot('긴히스토리-스크롤최상단') });
      check('⑤ 런타임 오류 0', errors.length === 0, errors.join('|').slice(0, 140));
      await page.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'anchor-probe.json'), JSON.stringify(results, null, 2));
    console.log(`\n== bottom-anchor t_dee9e982: ${passed} PASS / ${failed} FAIL ==`);
    process.exitCode = failed > 0 ? 1 : 0;
  }
})().catch((e) => { console.error('FATAL', e); process.exitCode = 2; });
