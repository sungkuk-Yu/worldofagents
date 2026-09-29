/**
 * t_1731f0f6 — 꼬리 추종 LIVE 백엔드 재현 스모크 (reviewer 요구: 라이브 재현 근거 필수)
 * 백엔드(DEV :3026, DASHSCOPE LLM 실제 스트리밍) + 웹 번들(:8167) 실연결로:
 *  ① 발화 → answer.delta 실시간 스트리밍 중 bottom gap ≤110 유지(추종) + 배지 오탐 없음
 *  ② 스트림 중 위로 스크롤 → 이후 delta에도 강제이동 없음 + 확정 후 unseen 배지
 *  ③ 배지 탭 → 말미 정착
 *  ④ 마지막 카드가 voice-stage 상단 위 (패딩 클램프)
 *  ⑤ PC 1440 동시 확인 (텍스트 입력바 모드)
 *
 * 실행(하네스): bash run_be_t1731.sh (:3026) &
 *   node tests/e2e/fr-serve.cjs dist-tail-live 8167 &
 *   node tests/e2e/smoke_tail_live.cjs
 */
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');
const { openKeyboardIfVoice, backToVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8167';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'tail-follow-live');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
async function tailGeometry(page) {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="message-list"]');
    const cards = Array.from(document.querySelectorAll('[data-testid="message-agent"],[data-testid="message-user"]'));
    const edgeEl = document.querySelector('[data-testid="voice-stage"]')
      || document.querySelector('[data-testid="chat-input-bar"]')
      || (document.querySelector('[data-testid="chat-input"]') ? document.querySelector('[data-testid="chat-input"]').closest('div[class]') : null);
    let lastCard = null;
    if (list && cards.length) {
      const lr = list.getBoundingClientRect();
      const visible = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > lr.top + 1 && r.top < lr.bottom - 1; });
      // 유령 행(뷰포트 밖 잔존)은 폴백 사용 금지 — 보이는 행이 없으면 null(검사 실패로 노출)
      if (visible.length) lastCard = visible.reduce((a, b) => (a.getBoundingClientRect().bottom >= b.getBoundingClientRect().bottom ? a : b));
    }
    const lc = lastCard ? lastCard.getBoundingClientRect() : null;
    return {
      gap: list ? Math.round(list.scrollHeight - list.scrollTop - list.clientHeight) : null,
      scrollTop: list ? Math.round(list.scrollTop) : null,
      scrollable: list ? list.scrollHeight - list.clientHeight > 4 : false,
      lastCardBottom: lc ? Math.round(lc.bottom) : null,
      edgeTop: edgeEl ? Math.round(edgeEl.getBoundingClientRect().top) : null,
      badge: !!document.querySelector('[data-testid="unseen-badge"]'),
      streamText: !!document.querySelector('[data-testid="ai-generated-badge"]'),
    };
  });
}
async function login(page, stamp) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByTestId('login-hint').click().catch(async () => { await page.getByTestId('new-chat-button').click(); });
  await page.waitForTimeout(700);
  if (await page.getByTestId('login-card').isVisible().catch(() => false)) {
    await page.getByTestId('auth-mode-toggle').click();
    await page.getByTestId('login-email').fill(`tail-live-${stamp}@myagenttalk.dev`);
    await page.getByTestId('login-password').fill(`tail-pw-${stamp}`);
    await page.getByTestId('consent-all-required').click();
    await page.getByTestId('signup-submit').click();
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
  }
  await page.waitForTimeout(600);
}
(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const stamp = Date.now();
  try {
    // ══ 웹 모바일 390x844 — 라이브 LLM 스트리밍 추종 ══
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await login(page, stamp);
    await page.getByTestId('new-chat-button').click();
    await openKeyboardIfVoice(page);
    await page.getByTestId('chat-input').fill('계약서 위약금 조항과 중재 관할 조항에 대해 800자 이상으로 상세히 검토해 주세요. 지연이자 상한, 통보기한, 부속합의서 존속기간을 모두 다뤄 주세요.');
    await page.getByTestId('send-button').click();
    // delta 유입 추적: 콘텐츠가 900px 이상 성장할 때까지 스트림 추종 상태 샘플링 (LIVE LLM 박자)
    let samples = [];
    let sawScrollable = false, sawBadgeDuringStream = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const g = await tailGeometry(page);
      if (g.scrollable) {
        sawScrollable = true;
        samples.push(g.gap);
        if (g.badge) sawBadgeDuringStream = true;
        if (g.scrollTop + g.gap > 900) break; // 스크롤 가능 범위 900px+ — 읽기 시나리오 가능
      }
      await page.waitForTimeout(120);
    }
    check('① 라이브 스트리밍 중 추종 — growth 구간 bottom gap ≤130', samples.length > 3 && samples.slice(-6).every((x) => x <= 130), `last=${samples.slice(-6).join(',')}`);
    check('① 스트리밍 중 배지 오탐 없음', sawScrollable && !sawBadgeDuringStream, `samples=${samples.length}`);
    await page.screenshot({ path: shot('live-01-streaming-follow') });

    // ② 읽는 중: 위로 스크롤 → 강제이동 없음. 배지 시나리오는 2발째 전송으로 결정적으로 만든다
    //    (1발 답이 이미 끝났을 수 있어 자연 arrival 레이싱 금지). 입력바(B)는 열려 있으므로 재사용.
    // r5: 이탈 = 사용자 의도(wheel/touch) 판정 — 실제 사용자처럼 WheelEvent 디스패치 후 이동.
    await page.evaluate(() => {
      const l = document.querySelector('[data-testid="message-list"]');
      l.dispatchEvent(new WheelEvent('wheel', { deltaY: -700, bubbles: true, cancelable: true }));
      l.scrollTop = Math.max(0, l.scrollTop - 700);
    });
    await page.waitForTimeout(300);
    const readPos = await tailGeometry(page);
    await page.getByTestId('chat-input').fill('추가 확인: 요약 한 줄만');
    await page.getByTestId('send-button').click();
    // 낙관 user 카드 arrival = 배지 즉시(읽는 중), 그후 2발 답 arrival 누적. 강제이동 금지 확인.
    let finalized = null;
    const t1 = Date.now();
    while (Date.now() - t1 < 60000) {
      const g = await tailGeometry(page);
      if (g.badge) { finalized = g; break; }
      await page.waitForTimeout(400);
    }
    check('② 읽는 중 새 발화 arrival에도 강제이동 없음(scrollTop 유지)', !!finalized && Math.abs(finalized.scrollTop - readPos.scrollTop) <= 160, `read=${readPos.scrollTop} now=${finalized && finalized.scrollTop}`);
    check('② unseen 배지 발동', !!finalized && finalized.badge === true);
    await page.screenshot({ path: shot('live-02-reading-badge') });

    // ③ 배지 탭 → 말미 정착
    await page.getByTestId('unseen-badge').click();
    await page.waitForTimeout(1800);
    const landed = await tailGeometry(page);
    check('③ 배지 탭 후 말미 정착(gap≤130)', landed.gap <= 130, `gap=${landed.gap}`);
    check('③ 배지 소멸', !landed.badge);

    // ④ 음성 계층 복귀 — 마지막 카드 bottom ≤ strip 상단.
    //    B→A 전환 직전 프레임은 입력바 잔존/스트리밍 카드 성장 중이라 card>edge·card=null이
    //    관측된다(9/29 r6/r8 실측, 9/26 교훈: 전환애니 후 측정은 페인트 대기). 전환+추종이
    //    정착할 때까지 최대 8회(≈4s) 대기 — 그 뒤에도 안 붙으면 진짜 실패로 판정.
    await backToVoice(page);
    let g4 = null;
    for (let s = 0; s < 8; s++) {
      await page.waitForTimeout(500);
      g4 = await tailGeometry(page);
      if (g4.lastCardBottom !== null && g4.edgeTop !== null && g4.lastCardBottom <= g4.edgeTop + 2) break;
    }
    check('④ 마지막 카드 bottom ≤ voice-stage 상단', !!g4.lastCardBottom && !!g4.edgeTop && g4.lastCardBottom <= g4.edgeTop + 2, `card=${g4.lastCardBottom} edge=${g4.edgeTop}`);
    await page.screenshot({ path: shot('live-04-landed') });
    check('모바일 페이지 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));

    // ══ ⑤ PC 1440×900 — 텍스트 입력바 모드 라이브 추종 ══
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    await login(page2, stamp + 1);
    await page2.getByTestId('new-chat-button').click();
    await page2.getByTestId('chat-input').waitFor({ timeout: 20000 });
    await page2.getByTestId('chat-input').fill('중재지정과 준거법 조항을 500자 이상 상세히 검토해 주세요.');
    await page2.getByTestId('send-button').click();
    const samples2 = [];
    const t2 = Date.now();
    // r8b: 고로드에서 PC 답 스트림 시작이 45s를 넘긴 적 있음(samples=0건) — 창 75s로 확장.
    while (Date.now() - t2 < 75000) {
      const g = await tailGeometry(page2);
      if (g.scrollable) {
        samples2.push(g.gap);
        if (samples2.length >= 8) break;
      }
      await page2.waitForTimeout(150);
    }
    check('⑤ PC 라이브 스트리밍 추종(gap≤130)', samples2.length > 3 && samples2.every((x) => x <= 130), `samples=${samples2.join(',')}`);
    await page2.screenshot({ path: shot('live-05-pc-follow') });
    console.log(`\n결과: ${passed} PASS / ${failed} FAIL — 캡처 ${OUT}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('SMOKE ABORT', e.message); process.exit(1); });
