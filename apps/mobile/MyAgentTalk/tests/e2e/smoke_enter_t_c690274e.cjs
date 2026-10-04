/**
 * t_c690274e — 채팅 입력창 Enter 분기·높이 성장 DOM 회귀 스모크 (대표님 10/3 'Shift+Enter 줄바꿈 불가')
 * 백엔드 없이 run_c_fixtures 인터셉트 (9/26 교훈: 최소 비용 재현 경로).
 * 검증:
 *  PC(1440, 입력바 상시):
 *   P1 Shift+Enter → textarea에 \n 삽입 + POST 0건 + 높이 성장(>1줄)   [버그 그 자체: 구 빌드는 개행 0·即时전송]
 *   P2 Enter 단독 → POST 1건(content 일치) + textarea 소거 + 높이 원복(~48)
 *   P3 조합 중 Enter(isComposing/keyCode229 합성 keydown) → POST 증가 0 (오전송 차단)
 *   P4 장문 8줄 → 높이 MAX 클램프(≈156) + scrollHeight>clientHeight(내부 스크롤)
 *   P5草稿: 여러 줄 유지 채로 버튼 전송도 정상 (\n 포함 body)
 *  모바일(390, 음성 콘솔 → ↑로 B 계층):
 *   M1 B 개방·포커스 후 Shift+Enter 개행 / Enter 전송 왕복 (실사용 경로)
 *   Z  런타임 페이지 오류 0건
 * 실행:
 *   expo export -p web --output-dir dist-tc690274e --clear   (EXPO_PUBLIC_* 미요구 — API 주입 차단)
 *   node tests/e2e/fr-serve.cjs dist-tc690274e 8130
 *   node tests/e2e/smoke_enter_t_c690274e.cjs   (APP_URL/OUT_DIR 오버라이드 가능)
 * 롤백 베이스(착수 시점 origin/main HEAD): f7e0fcf9bff2510616c1f39ce0a9872b79cae2d6
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8130';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'enter-tc690274e');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const taBox = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="chat-input"]');
  const ta = el && (el.tagName === 'TEXTAREA' ? el : el.querySelector('textarea'));
  if (!ta) return null;
  const r = ta.getBoundingClientRect();
  return { h: r.height, sh: ta.scrollHeight, cy: ta.clientHeight, val: ta.value, oy: getComputedStyle(ta).overflowY };
});
const postCount = (state) => state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).length;
async function openSession(browser, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, {});
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  return { ctx, page, state, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // ── PC 1440 — 입력바 상시(voiceMode=false), Enter 계약 검증의 주 무대 ──
    {
      const { ctx, page, state, errors } = await openSession(browser, { width: 1440, height: 900 });
      await page.getByTestId('chat-input').waitFor({ timeout: 15000 });
      const h0 = await taBox(page);
      check('PC0 입력창 TEXTAREA(multiline) 렌더·1줄 높이', !!h0 && h0.h > 40 && h0.h <= 56, h0 && `h=${h0.h.toFixed(1)}`);

      // P1 Shift+Enter = 줄바꿈 (버그 그 자체)
      const inp = page.getByTestId('chat-input');
      await inp.click();
      await page.keyboard.type('첫줄');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('둘째줄');
      let box = await taBox(page);
      const posts0 = postCount(state);
      check('P1 Shift+Enter → \\n 삽입(개행 성공)', box.val === '첫줄\n둘째줄', JSON.stringify(box.val));
      check('P1 Shift+Enter → 전송(POST) 발생 0', posts0 === 0);
      check('P1 Shift+Enter 후 높이 성장(>1줄)', box.h > h0.h + 10, `h=${box.h.toFixed(1)} vs base=${(h0 && h0.h).toFixed(1)}`);
      await page.screenshot({ path: shot('P1-shift-enter-newline') });

      // P2 Enter 단독 = 전송 (여러 줄 본문 채로)
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      const posts1 = postCount(state);
      const last = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).at(-1);
      check('P2 Enter 단독 → POST 1건', posts1 === 1, `posts=${posts1}`);
      check('P2 전송 본문 = 개행 보존 ' + JSON.stringify('첫줄\n둘째줄'), last && last.body.content === '첫줄\n둘째줄', last && JSON.stringify(last.body.content));
      box = await taBox(page);
      check('P2 발송 후 textarea 소거', box.val === '', JSON.stringify(box.val));
      check('P2 발송 후 높이 원복(1줄)', box.h <= h0.h + 4, `h=${box.h.toFixed(1)}`);
      await page.screenshot({ path: shot('P2-enter-sent-restored') });

      // P3 IME 조합 중 Enter — 합성 keydown(isComposing + keyCode229)이 capture handler를 통과해야 함
      await inp.click();
      await page.keyboard.type('한글');
      const postsBefore = postCount(state);
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="chat-input"]');
        const ta = el && (el.tagName === 'TEXTAREA' ? el : el.querySelector('textarea'));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(300);
      check('P3 조합 중 Enter → 미전송 (isComposing/keyCode229 가드)', postCount(state) === postsBefore);
      await page.screenshot({ path: shot('P3-composing-enter-hold') });

      // P4 8줄 장문 → MAX 클램프 + 내부 스크롤
      await page.keyboard.press('Shift+Enter'); // 조합 종료 정리용 개행 하나
      const LONG = Array.from({ length: 8 }, (_, i) => `줄${i + 1}`).join('\n');
      await inp.fill(LONG);
      await page.waitForTimeout(150);
      box = await taBox(page);
      check('P4 8줄 → 높이 클램프(≈156, 5줄+패딩)', box.h >= 140 && box.h <= 162, `h=${box.h.toFixed(1)}`);
      check('P4 초과분 내부 스크롤(scrollHeight>clientHeight, overflowY auto)', box.sh > box.cy && box.oy === 'auto', `sh=${box.sh} cy=${box.cy} oy=${box.oy}`);
      await page.screenshot({ path: shot('P4-eight-lines-clamp') });

      // P5 여러 줄 유지 채 전송 버튼 (개행 포함 본문 발송)
      await page.getByTestId('send-button').click();
      await page.waitForTimeout(400);
      const last5 = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).at(-1);
      check('P5 전송 버튼 = \\n 포함 본문 발송', last5 && last5.body.content === LONG, last5 && JSON.stringify(last5.body.content.slice(0, 12)));
      check('Z(PC) 런타임 페이지 오류 0', errors.length === 0, errors.join('|').slice(0, 200));
      await ctx.close();
    }

    // ── 모바일 390 — 음성 콘솔(B 계층 개방 후) 실사용 경로 왕복 ──
    {
      const { ctx, page, state, errors } = await openSession(browser, { width: 390, height: 844 });
      await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
      await openKeyboardIfVoice(page);
      const inp = page.getByTestId('chat-input');
      const focused = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="chat-input"]');
        const ta = el && (el.tagName === 'TEXTAREA' ? el : el.querySelector('textarea'));
        return !!ta && document.activeElement === ta;
      });
      check('M0 B 계층 개방·textarea 포커스', focused);
      const boxOpen = await taBox(page);
      check('M0 빈 값은 1줄 높이(placeholder 2줄 절첩에 scrollHeight 부풀림 회피)', !!boxOpen && Math.abs(boxOpen.h - 48) <= 3, boxOpen && `h=${boxOpen.h.toFixed(1)}`);
      await page.keyboard.type('모바일 첫줄');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('모바일 둘째줄');
      const box = await taBox(page);
      check('M1 Shift+Enter 개행(모바일 B)', box && box.val === '모바일 첫줄\n모바일 둘째줄', box && JSON.stringify(box.val));
      check('M1 Shift+Enter 미전송', postCount(state) === 0);
      await page.screenshot({ path: shot('M1-mobile-newline') });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      check('M2 Enter 단독 전송(모바일 B)', postCount(state) === 1);
      const box2 = await taBox(page);
      check('M2 전송 후 소거·원복', box2 && box2.val === '' && box2.h < 60, box2 && `h=${box2.h.toFixed(1)}`);
      await page.screenshot({ path: shot('M2-mobile-sent') });
      check('Z(모바일) 런타임 페이지 오류 0', errors.length === 0, errors.join('|').slice(0, 200));
      await ctx.close();
    }

    console.log(`\nRESULT t_c690274e: ${passed} PASS / ${failed} FAIL`);
    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    await browser.close();
  }
})();
