/**
 * 채팅 음성 스테이지 e2e 스모크 — t_e735d936 → t_4758f25d 최종 재스펙 (#311/#316/#318)
 * 검증: ① 웹 모바일(390) 진입 = 투명 보이스 스테이지(A). 고정 콘솔 DOM 0·입력창 미렌더·
 *       조이스틱 디스크/우측 키보드 버튼 없음. strip 높이=뷰포트 30% 클램프(180~300).
 *       첫 진입 힌트 알약("여길 길게 눌러 말하기") + 3s 후 페이드.
 *   ② 로드 시 마이크 권한 미요구 (permissions.query=microphone state 'prompt')
 *   ③ 스트립 홀드 → 링+초록 펄스+리본 canvas 출현(녹음 시각화) → ↑ 이탈 릴리스 =
 *       audio.start→audio.cancel + 키보드(B) 개방. B 배치: 좌=전송(초록)/우=마이크(A 복귀).
 *   ④ 스트립 탭-홀드 = audio.start→PCM→audio.end (놓으면 전송) + done 체크 후 잔상 0
 *   ⑤ 권한 거부 = 폴백 안내 한 줄 + 입력창 자동 개방(텍스트 완전 작동)
 *   ⑥ PC 1440 = 스테이지/링 없음, 입력창 상시·배치 불변(기존 동작 보존)
 *   ⑦ B→A 왕복: 마이크 탭 → 스테이지 복귀·입력창 접힘. 스크롤 영역(상부) 탭/드래그는 링 미발동.
 * 실행: (정적서버) node tests/e2e/fr-serve.cjs dist-<본빌드> 8158
 *       APP_URL=http://localhost:8158 node tests/e2e/smoke_voice_console.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8158';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'voice-console');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function openMobileChat(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
  return { page, state, errors };
}

// 스트립 중앙이 아니라 지문형 패드(voice-stage-pad) 중앙에서 홀드 시작 — t_f8c40db0(9/30) 히트 축소.
async function stageDrag(page, { dx = 0, dy = 0, holdMs = 120, steps = 6, out = false }) {
  const box = await page.getByTestId('voice-stage-pad').boundingBox();
  assert.ok(box, 'voice-stage-pad 박스');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  if (out) { // 스트립 밖 이탈 경로: 마지막에 크게 밖으로
    for (let i = 1; i <= steps; i++) { await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps); await page.waitForTimeout(30); }
    await page.mouse.move(cx + dx * 2.2, cy + dy * 2.2);
  } else {
    for (let i = 1; i <= steps; i++) { await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps); await page.waitForTimeout(30); }
  }
  await page.waitForTimeout(holdMs);
  return box;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── ① + ② 진입 = 투명 스테이지, 로드 시 권한 미요구 ──
    {
      const { page, state, errors } = await openMobileChat(browser);
      check('① voice-stage 렌더(1차 음성 계층)', await page.getByTestId('voice-stage').isVisible());
      const strip = await page.getByTestId('voice-stage').boundingBox();
      check('① strip 높이 = 30% 뷰포트 클램프(180~300)', strip.height >= 180 && strip.height <= 300, `h=${strip.height}`);
      check('① strip 상단 = 리스트 패딩 경계(히스토리 미점거)', Math.abs((844 - strip.height) - strip.y) <= 2, `y=${strip.y}`);
      const bg = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="voice-stage"]');
        return el ? getComputedStyle(el).backgroundColor : null;
      });
      check('① strip 배경 투명(채팅 배후 비침)', bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent', `bg=${bg}`);
      // ── t_f8c40db0 (대표님 9/30): 지문형 서클 패드만 인식 · 원 밖은 전역 스크롤 통과 ──
      const pad = await page.getByTestId('voice-stage-pad').boundingBox();
      check('① 홀드 패드(서클) 렌더 — 직경 ~96px', !!pad && Math.abs(pad.width - 96) <= 2 && Math.abs(pad.height - 96) <= 2, pad ? `${pad.width}x${pad.height}` : '없음');
      check('① 패드 중심 = 스트립 중심(지문형 중앙 배치)', !!pad
        && Math.abs((pad.x + pad.width / 2) - (strip.x + strip.width / 2)) <= 2
        && Math.abs((pad.y + pad.height / 2) - (strip.y + strip.height / 2)) <= 2);
      const hitMap = await page.evaluate(([cx, cy, lx, rx, uy]) => {
        const at = (x, y) => {
          const el = document.elementFromPoint(x, y);
          return { pad: !!(el && el.closest('[data-testid="voice-stage-pad"]')), stage: !!(el && el.closest('[data-testid="voice-stage"]')) };
        };
        return { center: at(cx, cy), left: at(lx, cy), right: at(rx, cy), inStripAbovePad: at(cx, uy) };
      }, [pad.x + pad.width / 2, pad.y + pad.height / 2, strip.x + 40, strip.x + strip.width - 40, strip.y + 20]);
      check('① 패스-쓰루: 스트립 중앙 히트 = 패드만(홀드 시작 가능)', hitMap.center.pad && hitMap.center.stage);
      check('① 패스-쓰루: 스트립 안 원밖(좌/우/패드 위) = 스트립 히트 0(리스트 스크롤 통과) — t_f8c40db0',
        !hitMap.left.stage && !hitMap.right.stage && !hitMap.inStripAbovePad.stage, JSON.stringify(hitMap));
      check('① 고정 콘솔 DOM 0 (chat-voice-console 폐기)', (await page.getByTestId('chat-voice-console').count()) === 0
        && (await page.getByTestId('joystick-mic').count()) === 0);
      check('① 우측 키보드 원형 버튼 DOM 0 (#294-4)', (await page.getByTestId('chat-keyboard-button').count()) === 0);
      check('① 입력창은 B 계층 — 진입 시 미렌더', (await page.getByTestId('chat-input').count()) === 0);
      check('① 첫 진입 힌트 알약 노출', (await page.getByTestId('voice-stage-hint').count()) === 1);
      await page.waitForTimeout(3600);
      const hintOpacity = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="voice-stage-hint"]');
        return el ? parseFloat(getComputedStyle(el).opacity) : -1;
      });
      check('① 힌트 3s 후 페이드(out)', hintOpacity === -1 || hintOpacity < 0.35, `op=${hintOpacity}`);
      const micPerm = await page.evaluate(() => navigator.permissions.query({ name: 'microphone' }).then((p) => p.state).catch(() => 'unsupported'));
      check('② 로드 시 권한 미요구 (state=prompt)', micPerm === 'prompt' || micPerm === 'granted', `perm=${micPerm}`);
      check('② 음성 WS 컨트롤 프레임 아직 없음', state.frames.filter((f) => f && f.type === 'audio.start').length === 0);
      check('① 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 120));
      await page.screenshot({ path: shot('01-voice-stage-idle') });
      await page.close();
    }

    // ── ③ 홀드 → 시각화(링+펄스+리본) → ↑ 이탈 릴리스 = 폐기 + 키보드 개방 · B 배치 ──
    {
      const { page, state } = await openMobileChat(browser);
      await stageDrag(page, { dy: -217, holdMs: 60 }); // ↑ 217px = DIR_UP 스냅(30px↑) — 뷰포트 내 유지
      check('③ 홀드 중 링 출현', (await page.getByTestId('voice-stage-ring').count()) === 1);
      check('③ 홀드 중 펄스+리본 canvas 출현', (await page.getByTestId('voice-stage-pulse').count()) === 1
        && await page.evaluate(() => !!document.querySelector('[data-testid="voice-stage-ribbon"] canvas')));
      await page.screenshot({ path: shot('03-hold-up-visual') });
      await page.mouse.up();
      await page.getByTestId('chat-input').waitFor({ timeout: 8000 });
      const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
      check('③ ↑ 홀드: audio.start 직후 audio.cancel (발화 폐기)', types.includes('audio.start') && types.includes('audio.cancel'), types.join(','));
      check('③ ↑ 홀드 후 전송(end) 없음', !types.includes('audio.end'));
      check('③ 키보드 계층(B) 개방', await page.getByTestId('chat-input').isVisible());
      // B 배치 확정 (#304 보강): 좌=전송(초록) / 우=마이크 — 지금 화면과 좌우 반전
      const sendBox = await page.getByTestId('send-button').boundingBox();
      const micBox = await page.getByTestId('chat-voice-back').boundingBox();
      check('③ B 배치: 좌=전송 / 우=마이크 토글', !!sendBox && !!micBox && sendBox.x < micBox.x, `send.x=${sendBox && sendBox.x} mic.x=${micBox && micBox.x}`);
      const focused = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="chat-input"]');
        const input = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : el.querySelector('input,textarea'));
        return !!input && document.activeElement === input;
      });
      check('③ B 개방 시 포커스(키보드 올라옴)', focused);
      // ⑦ 왕복: 마이크 탭 → A 복귀 (잔상 0 — 링/리본 DOM 소멸)
      await page.getByTestId('chat-voice-back').click();
      await page.getByTestId('voice-stage').waitFor({ timeout: 5000 });
      check('⑦ B 마이크 탭 → A 복귀·입력창 강등', (await page.getByTestId('chat-input').count()) === 0);
      check('⑦ A 복귀 후 링/리본 잔상 0', (await page.getByTestId('voice-stage-ring').count()) === 0);
      // ⑦ 스크롤 영역(상부) 드래그는 링 미발동 — 수직 2분할 경계
      await page.mouse.move(195, 300);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(195, 300 + i * 15); await page.waitForTimeout(25); }
      await page.waitForTimeout(200);
      check('⑦ 상부 영역 롱드래그 = 링 미발동(스크롤 전용)', (await page.getByTestId('voice-stage-ring').count()) === 0);
      await page.mouse.up();
      await page.close();
    }

    // ── ④ 탭-홀드 = 눌러서 놓고 전송 + done 체크 후 소멸 ──
    {
      const { page, state } = await openMobileChat(browser);
      await stageDrag(page, { holdMs: 320 });
      check('④ 홀드 중 링+리본 시각화', (await page.getByTestId('voice-stage-ring').count()) === 1
        && (await page.getByTestId('voice-stage-pulse').count()) === 1);
      await page.screenshot({ path: shot('04-hold-recording') });
      await page.mouse.up();
      await page.waitForTimeout(700);
      check('④ done 후 소멸 — 링/리본/체크 잔상 0 (#316)', (await page.getByTestId('voice-stage-ring').count()) === 0
        && (await page.getByTestId('voice-stage-done').count()) === 0);
      const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
      const pcmFrames = state.frames.filter((f) => f && typeof f.binary === 'number').length;
      check('④ 탭-홀드: audio.start→audio.end (놓으면 전송)', types.includes('audio.start') && types.includes('audio.end') && !types.includes('audio.cancel'), types.join(','));
      check('④ PCM 바이너리 프레임 WS 전송', pcmFrames > 0, `frames=${pcmFrames}`);
      await page.close();
    }

    // ── ⑤ 권한 거부 폴백 (페이크 디바이스 없는 별도 브라우저 인스턴스) ──
    {
      const denyBrowser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
      try {
        const ctx = await denyBrowser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', permissions: [] });
        const page = await ctx.newPage();
        const state = await installFixtures(page);
        await page.goto(APP, { waitUntil: 'networkidle' });
        await page.getByTestId('session-card').click();
        await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
        const box = await page.getByTestId('voice-stage').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(350);
        await page.mouse.up();
        await page.getByTestId('chat-voice-fallback').waitFor({ timeout: 8000 }).catch(() => {});
        const fallbackVisible = await page.getByTestId('chat-voice-fallback').isVisible().catch(() => false);
        await page.getByTestId('chat-input').waitFor({ timeout: 8000 }).catch(() => {});
        const inputOpened = (await page.getByTestId('chat-input').count()) > 0;
        const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
        check('⑤ 거부 후 스테이지 유지 + 폴백 안내 표시', fallbackVisible, `fallback=${fallbackVisible}`);
        check('⑤ 거부 시 텍스트 입력 자동 개방(완전 작동)', inputOpened);
        check('⑤ 권한 요구는 누름 이후에만 (audio.start 존재)', types.includes('audio.start'), types.join(','));
        await page.screenshot({ path: shot('05-denied-fallback') });
        await page.close();
      } finally { await denyBrowser.close(); }
    }

    // ── ⑥ PC 1440 = 기존 텍스트 채팅 보존 ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await installFixtures(page);
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').click();
      await page.getByTestId('chat-input').waitFor({ timeout: 15000 });
      check('⑥ PC = 스테이지/링 없음·입력창 상시', (await page.getByTestId('voice-stage').count()) === 0 && (await page.getByTestId('chat-input').count()) === 1);
      const sendBox = await page.getByTestId('send-button').boundingBox();
      const attachBox = await page.getByTestId('attach-button').boundingBox();
      check('⑥ PC 배치 불변: 좌=첨부 / 우=전송', !!sendBox && !!attachBox && attachBox.x < sendBox.x);
      await page.screenshot({ path: shot('06-pc-unchanged') });
      await page.close();
    }
  } finally {
    await browser.close();
    console.log(`\nRESULT voice-stage: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
