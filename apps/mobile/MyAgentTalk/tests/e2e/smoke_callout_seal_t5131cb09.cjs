/**
 * t_5131cb09 (대표님 10/10) — 음성 홀드 카피 Callout/텍스트 선택 봉인 스모크
 * 지시: "마이크 홀드 중 선택 가능 텍스트에서 복사용 Callout 팝업이 올라와 홀드를 지연·방해 →
 *       홀드 계층 전체 user-select:none(-webkit-touch-callout 포함) + selectstart/contextmenu 차단"
 * 검증(데스크톱 헤드리스는 iOS callout 버블을 재현 못 → 봉인의 실행 지점 자체를 단언):
 *   ① #mat-callout 규칙이 CSSOM에 파싱 존재(-webkit-touch-callout:none) — desktop Chromium은
 *      이 프로퍼티를 미지원해 computed가 ''이므로(실측) CSSOM 텍스트 단언이 유효한 검사.
 *   ② 홀드 계층(스트립·패드·힌트 알약과 그 텍스트 포함) computed user-select = none.
 *      (RNW Text 기본 user-select:auto가 신고 근원 — 힌트 'r-7bouqp' atomic 클래스 실측)
 *   ③ contextmenu = preventDefault(스트립 seal 리스너 — 패드/자식 전파 커버).
 *   ④ 홀드 기능 보존 회귀 — 패드 홀드 = 링 발동 + audio.start→audio.end (리스너가 제스처 삼키지 않음).
 *   ⑤ blast radius — message-list(채팅 텍스트)는 선택 가능 유지(복사 기능 무영향),
 *      상부 영역 드래그 셀렉트 동작 유지(봉인은 홀드 계층 한정).
 * 실행: (정적서버) node tests/e2e/fr-serve.cjs dist-<본빌드> 8263
 *       APP_URL=http://localhost:8263 node tests/e2e/smoke_callout_seal_t5131cb09.cjs
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8263';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'callout-seal-t5131cb09');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const state = await installFixtures(page, { reader: true });
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
    await page.getByTestId('voice-stage-pad').waitFor({ timeout: 8000 });
    await page.getByTestId('voice-stage-hint').waitFor({ timeout: 8000 }); // 첫 진입 = 힌트 알약(early-return 경로) — 이 트리도 봉인 대상

    // ① CSSOM 존재 단언 — #mat-callout 규칙이 파싱돼 -webkit-touch-callout:none을 담고,
    //    pad/ring/hint/hint 텍스트 엘리먼트에 실질 적용(user-select atomic 클래스 유입)
    const cssom = await page.evaluate(() => {
      const el = document.getElementById('mat-callout');
      if (!el || !el.sheet) return null;
      const rules = Array.from(el.sheet.cssRules).map((r) => r.cssText);
      const joined = rules.join('\n');
      const raw = el.textContent || ''; // desktop Chromium CSSOM은 미지원 프로퍼티를 cssText에서 드롭(실측) → 원문 단언용
      const padEl = document.querySelector('[data-testid="voice-stage-pad"]');
      const matched = padEl ? rules.some((r) => { try { return r.includes('voice-stage-pad') && padEl.matches(r.split('{')[0].trim()); } catch { return false; } }) : false;
      return { joined, raw, matched };
    });
    const cssomHasCallout = !!cssom && /-webkit-touch-callout:\s*none/.test(cssom.raw);
    check('① #mat-callout 원문에 -webkit-touch-callout:none 존재( iOS 전용 프로퍼티 — desktop Chromium cssText 드롭 실측이라 원문+매칭으로 검증)', cssomHasCallout, cssom ? `raw=${cssom.raw.length}B` : '규칙 없음');
    check('① 패드 요소가 규칙 셀렉터에 매칭', !!cssom && cssom.matched === true);
    const userSelectOf = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).userSelect : null;
    }, sel);
    const usStrip = await userSelectOf('[data-testid="voice-stage"]');
    const usPad = await userSelectOf('[data-testid="voice-stage-pad"]');
    const usHint = await userSelectOf('[data-testid="voice-stage-hint"]');
    const usHintText = await userSelectOf('[data-testid="voice-stage-hint"] div');
    check('② 스트립/패드 computed user-select none', usStrip === 'none' && usPad === 'none', JSON.stringify({ strip: usStrip, pad: usPad }));
    check('② 힌트 알약과 그 텍스트 = none (신고 화면 ' + JSON.stringify(await page.getByTestId('voice-stage-hint').innerText()) + ' 카피 봉인)', usHint === 'none' && usHintText === 'none', JSON.stringify({ hint: usHint, text: usHintText }));

    // ②b 패드 트리플-클릭 = 패드 서브트리 선택 0 (봉인 실측). 힌트 알약은 pointer-events:none이라
    //    클릭이 배후 메시지로 패스-스루 — 힌트 봉인은 computed(②)로만 단언할 수 있다(실측 근거).
    const selLen = () => page.evaluate(() => {
      const s = document.getSelection();
      if (!s || s.rangeCount === 0 || s.isCollapsed) return 0;
      return String(s.getRangeAt(0).toString() || '').length;
    });
    const clearSel = () => page.evaluate(() => document.getSelection()?.removeAllRanges());
    const pad = await page.getByTestId('voice-stage-pad').boundingBox();
    await clearSel();
    await page.mouse.click(pad.x + pad.width / 2, pad.y + pad.height / 2, { clickCount: 3 });
    await page.waitForTimeout(250);
    check('② 패드 트리플-클릭 = 선택 0', (await selLen()) === 0);
    await clearSel();
    await page.mouse.move(pad.x + 4, pad.y + pad.height - 4);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width - 4, pad.y + 4, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    check('② 패드 드래그 = 선택 생성 안 됨(user-select none 실측)', (await selLen()) === 0);
    await clearSel();

    // ③ contextmenu = preventDefault (스트립 seal 리스너, 자식 전파 커버)
    const ctxPrevented = await page.evaluate(() => {
      const padEl = document.querySelector('[data-testid="voice-stage-pad"]');
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window });
      padEl.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    check('③ 패드 contextmenu = 기본 동작 차단', ctxPrevented === true, `prevented=${ctxPrevented}`);
    const ctxOuter = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="message-list"]');
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window });
      list.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    check('③ 채팅 리스트 contextmenu = 미차단(blast radius 0)', ctxOuter === false);

    // ④ 홀드 기능 보존 — 봉인 리스너가 제스처를 삼키지 않는다 (링+전송 왕복 실측)
    await clearSel(); // 잔여 선택이 selectionchange로 responder를 terminate할 수 있다(선례: MagicPad 주석)
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    check('④ 패드 홀드 = 링 발동(봉인 후에도)', (await page.getByTestId('voice-stage-ring').count()) === 1);
    const usRing = await userSelectOf('[data-testid="voice-stage-ring"]');
    check('④ 홀드 중 ring subtree = user-select none ( armed/타이머 텍스트 노출 구간)', usRing === 'none', String(usRing));
    await page.screenshot({ path: path.join(OUT, '04-hold-ring-sealed.png') });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('④ 홀드-릴리스 = audio.start→audio.end (전송 보존)', types.includes('audio.start') && types.includes('audio.end'), types.join(','));

    // ⑤ blast radius — 메시지 텍스트는 선택 가능 유지
    const msgSel = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="message-list"]');
      if (!list) return null;
      const s = document.getSelection();
      s.removeAllRanges();
      s.selectAllChildren(list);
      const len = s.rangeCount > 0 ? String(s.getRangeAt(0).toString() || '').trim().length : 0;
      s.removeAllRanges();
      return len;
    });
    check('⑤ 메시지 텍스트 = 선택 가능(복사 기능 무영향)', typeof msgSel === 'number' && msgSel > 0, msgSel === null ? '앵커 없음' : `len=${msgSel}`);

    // ⑥ 상부 스크롤 영역 드래그 = 선택 동작 유지(봉인은 홀드 계층 한정)
    const topPoint = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="message-list"]');
      if (!list) return null;
      const r = list.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 30 };
    });
    if (topPoint) {
      await page.mouse.move(topPoint.x, topPoint.y);
      await page.mouse.down();
      await page.mouse.move(topPoint.x, topPoint.y + 80, { steps: 6 });
      await page.mouse.up();
      const dragLen = await page.evaluate(() => {
        const s = document.getSelection();
        if (!s || s.rangeCount === 0 || s.isCollapsed) return 0;
        return String(s.getRangeAt(0).toString() || '').length;
      });
      check('⑥ 상부 영역 드래그 = 선택 생성 가능(봉인 무영향)', dragLen > 0, `len=${dragLen}`);
    } else {
      check('⑥ 상부 영역 앵커 없음', false);
    }

    check('Z 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));
    await page.close();
  } finally {
    await browser.close();
    console.log(`\nRESULT callout-seal: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
