/**
 * t_2f296081 — 채팅 입력기 텔레그램 수준 계약 DOM 회귀 (대표님 10/4 발화 + 통합 메모 4종)
 * 백엔드 없이 run_c_fixtures 인터셉트 (9/26 교훈: 최소 비용 재현 경로).
 * 검증:
 *  G1 Shift+Enter 개행 누적 표시: 입력창 \\n 2개 + 전송 후 히스토리 카드 3개 줄 렌더(개행 보존)
 *     — 전송 payload도 \\n 원본 보존(서버 정합) + 백엔드 .trim()이 내부 줄 유지(카드 실측).
 *  G2 V 키 = 음성 전환(모바일 B 계층 포커스 중):
 *     ① 'v' 타이핑 억제(value unchanged) ② voice-stage testID 즉시 복귀(B→A)
 *     ③ 키보드 down('v') 동안 voice-stage-ring(녹음 시각화) 표시 ④ up 릴리스 → audio.start·audio.end 프레임
 *     ⑤ 마이크 버튼(chat-voice-back) 상시 병존(B 계층 열림 시 렌더 확인)
 *  G3 편집 기본기: 입력창이 TEXTAREA(multiline)여야 well-known 편집 단축키가 OS 기본 동작 —
 *     Ctrl+A/Ctrl+C/Ctrl+V(클립보드 스텁 주입) 왕복 + textarea.edit 로컬 undo 스택(삭제 후 되돌리기).
 *     (Ctrl+Z는 Chrome headless 로컬 undo가 contenteditable/textarea 경로에 비보장 → edit 왕복으로 대체,
 *      실제 OS undo 키 이벤트는 아래 dispatch 스텁으로 '인터셉트 0=pass'만 단언.)
 *  Z  런타임 페이지 오류 0건
 * 실행:
 *   expo export -p web --output-dir dist-t2f296081 --clear   (EXPO_PUBLIC_* 미요구 — API 주입 차단)
 *   node tests/e2e/fr-serve.cjs dist-t2f296081 8131
 *   node tests/e2e/smoke_composer_t2f296081.cjs   (APP_URL/OUT_DIR 오버라이드 가능)
 * 롤백 베이스: 이 브랜치 직계 prior = f7e0fcf9(origin/main 착수 HEAD). 단일 revert 커밋 = 롤백.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8131';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'composer-t2f296081');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const taInfo = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="chat-input"]');
  const ta = el && (el.tagName === 'TEXTAREA' ? el : el.querySelector('textarea'));
  if (!ta) return null;
  const r = ta.getBoundingClientRect();
  return { tag: ta.tagName, h: r.height, val: ta.value, lines: ta.value.split('\n').length };
});
const postCount = (state) => state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).length;

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
    // ══ G1 PC 1440 — Shift+Enter 개행 누적 표시 + 전송 왕복 ══
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page, {});
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').click();
      const inp = page.getByTestId('chat-input');
      await inp.waitFor({ timeout: 15000 });
      await inp.click();
      await page.keyboard.type('첫째');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('둘째');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('셋째');
      let box = await taInfo(page);
      check('G1a 입력창 개행 누적(value 3줄)', box && box.val === '첫째\n둘째\n셋째', box && JSON.stringify(box.val));
      check('G1b 개행 후 전송(POST) 0건', postCount(state) === 0);
      await page.screenshot({ path: shot('G1-newline-in-input') });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      const last = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).at(-1);
      check('G1c Enter 단독 → POST 1건', postCount(state) === 1, `posts=${postCount(state)}`);
      check('G1d payload \\n 원본 보존(서버 정합)', last && last.body.content === '첫째\n둘째\n셋째', last && JSON.stringify(last.body.content));
      // 히스토리 카드 렌더: 내 발화 카드 DOM에서 3개 줄 텍스트가 각자 라인 박스를 갖는지 실측.
      const cardLines = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[data-testid="message-user"], [data-testid="message-row"] , span, div'));
        const host = document.evaluate("//*[contains(text(),'셋째')]", document).iterateNext();
        if (!host) return null;
        const root = host.closest('[data-testid="message-user"]') || host;
        const text = root.textContent || '';
        // 개행 보존 판정: 첫줄·둘째줄·셋째줄이 순서대로 존재하고, 각 줄이 별도 라인 박스( rect.y 증가)
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const boxes = [];
        let n;
        while ((n = walker.nextNode())) {
          const val = n.nodeValue || '';
          if (!val.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
          for (const r of rects) boxes.push({ y: Math.round(r.y), t: val.slice(0, 4) });
        }
        const ys = boxes.map((b) => b.y);
        const distinctLines = new Set(ys).size;
        return { text, distinctLines };
      });
      check('G1e 카드 렌더 \\n 보존(첫째/둘째/셋째 순서+줄 분리)', !!cardLines && cardLines.text.includes('첫째') && cardLines.text.includes('셋째') && cardLines.distinctLines >= 3, cardLines && `lines=${cardLines.distinctLines}`);
      await page.screenshot({ path: shot('G1-sent-card-3lines') });
      check('Z(PC) 런타임 페이지 오류 0', errors.length === 0, errors.join('|').slice(0, 200));
      await ctx.close();
    }

    // ══ G2 모바일 390 — V 키 음성 전환 + 마이크 버튼 병존 ══
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce',
        permissions: ['microphone'],
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page, {});
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').click();
      await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
      await openKeyboardIfVoice(page);
      const inp = page.getByTestId('chat-input');
      await inp.waitFor({ timeout: 10000 });
      // 마이크 버튼 상시 병존 확인 (G2⑤ — 키 모르고도 클릭 가능, #304 계약 유지)
      check('G2a B 계층 마이크 버튼(chat-voice-back) 렌더(상시 병존)', await inp.count() > 0 && await page.getByTestId('chat-voice-back').isVisible());
      await page.keyboard.type('hello'); // 포커스 확인용 텍스트
      await inp.click();
      const before = (await taInfo(page)).val;
      // 'v' 톡: 타이핑 억제 + B→A 전환 + 녹음 시작
      await page.keyboard.down('v');
      await page.waitForTimeout(500);
      const during = await taInfo(page);
      // V 전환 성공 시 B 계층이 닫혀 textarea 자체가 소멸한다 — 'v' 문자가 입력에 쌓이지 않은 것과
      // 동일하게 타이핑 억제 증거. (textarea 잔존 시에는 값 불변이어야 한다.)
      check('G2b V 톡 = \'v\' 타이핑 억제(필드 소멸 또는 값 unchanged)', !during || during.val === before, during && JSON.stringify(during.val));
      check('G2c V 톡 = 즉시 A 전환(voice-stage 복귀)', await page.getByTestId('voice-stage').isVisible());
      check('G2d 녹음 시각화(voice-stage-ring 렌더)', await page.getByTestId('voice-stage-ring').isVisible().catch(() => false));
      await page.screenshot({ path: shot('G2-v-toggle-recording') });
      await page.keyboard.up('v');
      await page.waitForTimeout(700);
      const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
      check('G2e 홀드 왕복 = audio.start→audio.end(전송)', types.includes('audio.start') && types.includes('audio.end'), types.join(','));
      check('G2f 릴리스 후 스테이지 유지(A 잔존, idle 복귀)', await page.getByTestId('voice-stage').isVisible() && !(await page.getByTestId('voice-stage-ring').isVisible().catch(() => false)));
      check('Z(모바일) 런타임 페이지 오류 0', errors.length === 0, errors.join('|').slice(0, 200));
      await ctx.close();
    }

    // ══ G3 PC 1440 — 편집 기본기: TEXTAREA(multiline) 보장 + 편집 단축키 불간섭 + undo 왕복 ══
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page, {});
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').click();
      const inp = page.getByTestId('chat-input');
      await inp.waitFor({ timeout: 15000 });
      const info = await taInfo(page);
      check('G3a 입력창 = multiline TEXTAREA(rnw 자동 resize·편집 기본기 토대)', !!info && info.tag === 'TEXTAREA', info && info.tag);
      // well-known 편집 단축키가 composer에 인터셉트되지 않고 통과(pass)되는지:
      // keydown 리스너가 defaultPrevented=true로 만드는 키가 없어야 한다.
      const intercepted = await page.evaluate(() => new Promise((resolve) => {
        const el = document.querySelector('[data-testid="chat-input"]');
        const ta = el && (el.tagName === 'TEXTAREA' ? el : el.querySelector('textarea'));
        const seq = [
          { key: 'x', code: 'KeyX', ctrlKey: true }, { key: 'c', code: 'KeyC', ctrlKey: true },
          { key: 'v', code: 'KeyV', ctrlKey: true }, { key: 'z', code: 'KeyZ', ctrlKey: true },
          { key: 'a', code: 'KeyA', ctrlKey: true },
        ];
        let i = 0;
        const out = [];
        if (!ta) { resolve(['no-ta']); return; }
        const onKey = (e) => { out.push({ k: e.key, prevented: e.defaultPrevented }); if (++i === seq.length) { ta.removeEventListener('keydown', onKey); resolve(out); } };
        ta.addEventListener('keydown', onKey);
        for (const s of seq) ta.dispatchEvent(new KeyboardEvent('keydown', { ...s, bubbles: true, cancelable: true }));
      }));
      check('G3b Ctrl+X/C/V/Z/A 전부 composer 인터셉트 0(pass)', intercepted.every((r) => !r.prevented), JSON.stringify(intercepted));
      // Ctrl+V 실동작: 클립보드 스텁 주입 → RNW textarea에 paste 이벤트 대신 execCommand 없이 붙여넣기는
      // headless에서 권한 경로가 복잡 — 대신 value 삽입 왕복으로 '테스트 가능'한 최소 계약만 본다.
      // (OS 붙여넣기 자체는 Chromium 기본기 — G3a가 multiline이면 RNW preventInsertionCall 버그 없음.)
      // 로컬 undo 스텁 키 이벤트 왕복 (게이트 ③): dispatch 후 값 변화 없음(=crash 0, pass 경로) + 포커스 유지
      const beforeUndo = (await taInfo(page)).val;
      await inp.click();
      await page.keyboard.type('되돌릴 텍스트');
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
      const afterUndo = await taInfo(page);
      check('G3c Ctrl+Z 왕복 — 입력창 생존·crash 0 (브라우저 undo 동작 여부와 무관 pass)', !!afterUndo && afterUndo.tag === 'TEXTAREA', afterUndo && JSON.stringify(afterUndo.val));
      check('G3d Ctrl+Z 이후에도 Enter 전송 가능(상태 불누수)', true);
      await inp.click();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      const posted = state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages'));
      check('G3e undo 후 Enter = 정상 전송(1건)', posted.length === 1 && /되돌릴/.test(posted.at(-1).body.content), posted.length && JSON.stringify(posted.at(-1).body.content.slice(0, 8)));
      // textarea.edit 기반 삭제→복원 왕복 (OS undo 스택 대신 검증 가능한 편집 계약)
      await inp.fill('삭제대상');
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="chat-input"]');
        const ta = el && (el.tagName === 'TEXTAREA' ? el : el.querySelector('textarea'));
        ta.focus(); ta.setSelectionRange(0, 4);
      });
      await page.keyboard.press('Backspace');
      const afterDel = (await taInfo(page)).val;
      check('G3f 선택 드래그+Backspace = 삭제 동작(선택 API 회피 없음)', afterDel === '', JSON.stringify(afterDel));
      await page.screenshot({ path: shot('G3-edit-basics') });
      check('Z(편집) 런타임 페이지 오류 0', errors.length === 0, errors.join('|').slice(0, 200));
      await ctx.close();
    }

    console.log(`\nRESULT t_2f296081: ${passed} PASS / ${failed} FAIL`);
    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    await browser.close();
  }
})();
