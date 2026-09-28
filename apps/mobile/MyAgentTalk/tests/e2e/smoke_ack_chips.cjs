/**
 * 예/아니요 텔레그램식 50/50 대형 버튼 + 조이스틱 홀드-arm e2e 스모크
 * — t_043539ff(소형 척) → t_c62a2eb7(대표님 9/28 "예와 아니요가 반반씩 텔레그램 형태로, 크게")
 * 검증:
 *   ① 발화 후 공감 재질문 카드 하단 버튼 행 노출 — 라벨 고정: 좌 '예'/우 '아니요' (t_1b123e59:
 *      원문① affirmative 좌측 고정 + 원문② "맞아요가 아니고 예/아니요 로만" — template_id 바인딩 폐기),
 *      50/50 폭 분할, 버튼 높이 ≥44px, 구분선 1px, affirmative('예')만 초록 채움
 *   ② 3초 후에도 버튼 행 유지(t_c62a2eb7 #2: 소형 척 3초 소멸 폐기 — 상시 확인 가능)
 *   ③ '예' 탭 = POST 발화 1회, payload = 라벨과 동일 텍스트(게이트 계약 텍스트)
 *   ④ 탭 후 해당 버튼 행 소멸(연속 질문 스팸 방지 — 발화 진행이 수명), 다음 턴은 신규 카드에만
 *   ⑤ 조이스틱 ← 900ms 홀드 → 아밍 배너 → 릴리스 = audio.cancel + '예' POST (녹음 폐기·텍스트 발화)
 *   ⑥ 얕은 좌 스와이프(<0.8s) = 텍스트 발화 없음 — 기존 매핑 경로(전송) 보존
 *   ⑦ 히스토리 재현(stale empathy 행) = 버튼 없음
 *   ⑧ PC 1440 = 버튼 행 정상(카드 폭 동일 비율), 조이스틱/홀드 없음(음성 콘솔 미렌더)
 * 실행: node tests/e2e/fr-serve.cjs dist-tc62a2eb7 8114 &
 *       APP_URL=http://localhost:8114 node tests/e2e/smoke_ack_chips.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8114';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'ack-chips');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 버튼 행 기하 측정: 50/50 분할·높이·구분선·배색 (row 하위 두 자식 버튼 rect/style) */
async function measureRow(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-testid="ack-chips"]');
    if (!row) return null;
    const kids = Array.from(row.children);
    const rr = row.getBoundingClientRect();
    const cs = getComputedStyle(row);
    const btns = kids.map((k) => {
      const r = k.getBoundingClientRect();
      const s = getComputedStyle(k);
      return { w: r.width, h: r.height, x: r.x, bg: s.backgroundColor, divider: s.borderRightWidth, color: getComputedStyle(k.firstElementChild).color };
    });
    return { rowW: rr.width, rowBorder: cs.borderTopWidth, radius: cs.borderRadius, btns, texts: kids.map((k) => k.textContent.trim()) };
  });
}

async function openMobileChat(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, { ack: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByTestId('chat-voice-console').waitFor({ timeout: 15000 });
  return { page, state, errors, ctx };
}
const sends = (state) => state.calls.filter((c) => c.path.endsWith('/messages') && c.method === 'POST').map((c) => c.body && c.body.content);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── ⑦ 히스토리 재현 = 버튼 없음 (진입 직후 stale empathy 행만 존재) ──
    const { page, state, errors } = await openMobileChat(browser);
    check('⑦ 진입 시점 stale 공감 행에 버튼 행 없음', (await page.getByTestId('ack-chips').count()) === 0);

    // ── ① 발화 → 재질문 카드 하단 50/50 버튼 행 (첫 턴 = eq_confirm → '아니에오'/'예') ──
    await page.getByTestId('chat-keyboard-button').click();
    await page.getByTestId('chat-input').waitFor({ timeout: 8000 });
    await page.getByTestId('chat-input').fill('내일 출장 일정 잡아줘');
    await page.getByTestId('send-button').click();
    const visible = await page.getByTestId('ack-chips').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
    check('① 재질문 카드 하단 예/아니요 버튼 행 노출', visible);
    const m1 = visible ? await measureRow(page) : null;
    check('① 구성: affirmative+부정계 2개 버튼', !!m1 && m1.btns.length === 2 && m1.texts[0] !== m1.texts[1],
      m1 ? JSON.stringify(m1.texts) : 'no row');
    check('① 라벨 고정: 좌 예/우 아니요 — eq_confirm이어도 맞아요 폐기 (t_1b123e59)', !!m1 && m1.texts[0] === '예' && m1.texts[1] === '아니요',
      m1 ? `labels=${JSON.stringify(m1.texts)}` : '');
    if (m1) {
      const [yes, no] = m1.btns; // t_1b123e59: 좌 affirmative / 우 부정계
      const split5050 = Math.abs(no.w - yes.w) <= 1.5 && Math.abs(no.w + yes.w - m1.rowW) <= 2;
      check('① 카드 폭 50/50 분할 (텔레그램 reply keyboard)', split5050, `yes=${yes.w.toFixed(1)} no=${no.w.toFixed(1)} row=${m1.rowW.toFixed(1)}`);
      check('① 버튼 높이 ≥44px', no.h >= 44 && yes.h >= 44, `h=${yes.h.toFixed(0)}/${no.h.toFixed(0)}`);
      check('① 테두리/구분선 1px', m1.rowBorder === '1px' && yes.divider === '1px', `borderTop=${m1.rowBorder} divider=${yes.divider}`);
      check("① 채움은 좌측 '예'만 초록(affirmative 강조), 우측 '아니요'는 극회색 테두리형",
        yes.bg === 'rgb(0, 168, 107)' && no.bg === 'rgb(255, 255, 255)', `yesBg=${yes.bg} noBg=${no.bg}`);
      check("① 텍스트 배색: 예=onPrimary 화이트, 아니요=text2", yes.color === 'rgb(255, 255, 255)' && no.color === 'rgb(90, 100, 114)',
        `yesColor=${yes.color} noColor=${no.color}`);
    }
    await page.screenshot({ path: shot('01-buttons-visible') });

    // ── ② 3초 후에도 유지 (소형 척 3초 소멸 폐기) ──
    await page.waitForTimeout(4200);
    const still = (await page.getByTestId('ack-chips').count()) === 1;
    check('② 3초+ 경과 후 버튼 행 유지 (발화 진행 전 — 상시 확인 가능)', still);
    await page.screenshot({ path: shot('02-still-alive-after-4s') });

    // ── ③④ '예' 탭 = POST 1회 + 해당 행 소멸 ──
    const before = sends(state).length;
    await page.getByTestId('ack-chip-yes').click();
    await page.waitForTimeout(400);
    const after = sends(state);
    check('③ 버튼 탭 = POST 발화 1회', after.length === before + 1, JSON.stringify(after.slice(before)));
    check('③ payload = 라벨과 동일 "예" (고정 라벨 = 게이트 계약 텍스트, t_1b123e59)', after[after.length - 1] === '예');
    await page.waitForTimeout(200);
    const domIds = await page.evaluate(() => document.querySelectorAll('[data-testid="ack-chips"]').length);
    check('④ 탭 후 이전 버튼 행 잔존 없음(≤1 = 다음 턴 신규만)', domIds <= 1, `rows=${domIds}`);

    // ── ③b 두 번째 턴(eq_proceed) — 라벨 고정: 템플릿 무관 동일 '예'/'아니요' ──
    await page.getByTestId('chat-input').fill('회의실을 잡을까');
    await page.getByTestId('send-button').click();
    const row2 = await page.getByTestId('ack-chips').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
    check('③b 다음 턴 재질문(eq_proceed)에도 버튼 행', row2);
    const m2 = row2 ? await measureRow(page) : null;
    check('③b 라벨 고정: eq_proceed에서도 좌 예/우 아니요 (#4 바인딩 폐기)', !!m2 && m2.texts[0] === '예' && m2.texts[1] === '아니요',
      m2 ? `labels=${JSON.stringify(m2.texts)}` : '');
    if (row2) {
      const b2 = sends(state).length;
      await page.getByTestId('ack-chip-no').click();
      await page.waitForTimeout(400);
      const a2 = sends(state);
      check('③b 부정 탭 payload = "아니요" 정확히 1회', a2.length === b2 + 1 && a2[a2.length - 1] === '아니요', JSON.stringify(a2.slice(b2)));
    }
    await page.screenshot({ path: shot('03-after-tap') });

    // ── ⑤ 조이스틱 ← 홀드 900ms → arm → 릴리스 = '예' 텍스트 발화 (음성 폐기) ──
    await page.getByTestId('chat-voice-back').click();
    await page.getByTestId('chat-voice-console').waitFor({ timeout: 5000 });
    const box = await page.getByTestId('joystick-mic').boundingBox();
    assert.ok(box, 'joystick-mic 박스');
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const before4 = sends(state).length;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(cx - 14 * i, cy); await page.waitForTimeout(30); }
    await page.waitForTimeout(950); // 0.8s arm 유지
    const armed = await page.getByTestId('joystick-ack-armed').isVisible().catch(() => false);
    check('⑤ ← 0.8s 홀드 = 아밍 배너("예 — 놓으면 전송")', armed);
    await page.screenshot({ path: shot('05-joystick-armed') });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after4 = sends(state);
    const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑤ 릴리스 = "예" 텍스트 POST 1회', after4.length === before4 + 1 && after4[after4.length - 1] === '예', JSON.stringify(after4.slice(before4)));
    check('⑤ 음성 발화는 폐기(audio.start→cancel, end 없음)', types.includes('audio.start') && types.includes('audio.cancel') && !types.slice(types.lastIndexOf('audio.start')).includes('audio.end'), types.slice(-8).join(','));
    const bannerGone = (await page.getByTestId('joystick-ack-armed').count()) === 0;
    check('⑤ 릴리스 후 아밍 배너 소멸', bannerGone);

    // ── ⑥ 얕은 좌 스와이프(<0.8s) = 홀드-arm 미발동, 텍스트 발화 없음 ──
    const before5 = sends(state).length;
    const typesBefore = state.frames.length;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(cx - 14 * i, cy); await page.waitForTimeout(30); }
    await page.waitForTimeout(200); // arm 임계 미달
    await page.mouse.up();
    await page.waitForTimeout(400);
    check('⑥ 얕은 스와이프(<0.8s) = 텍스트 발화 없음(홀드-arm 미발동)', sends(state).length === before5);
    const newFrames = state.frames.slice(typesBefore).filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑥ 얕은 스와이프 = 기존 audio 경로(end) 유지', newFrames.includes('audio.end') && !newFrames.includes('audio.cancel'), newFrames.join(','));
    check('런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));
    await page.close();

    // ── ⑧ PC 1440 = 버튼 행 정상(카드 폭 동일 비율)·조이스틱 없음 ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const state = await installFixtures(page, { ack: true });
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').click();
      await page.getByTestId('chat-input').waitFor({ timeout: 15000 });
      check('⑧ PC = 음성 콘솔/조이스틱 없음', (await page.getByTestId('chat-voice-console').count()) === 0 && (await page.getByTestId('joystick-mic').count()) === 0);
      await page.getByTestId('chat-input').fill('PC 발화');
      await page.getByTestId('send-button').click();
      const pcRow = await page.getByTestId('ack-chips').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
      check('⑧ PC 버튼 행 노출(카드 귀속 — 디바이스 무관)', pcRow);
      const mp = pcRow ? await measureRow(page) : null;
      check('⑧ PC 50/50 분할 동일', !!mp && Math.abs(mp.btns[0].w - mp.btns[1].w) <= 1.5, mp ? `${mp.btns[0].w.toFixed(1)}/${mp.btns[1].w.toFixed(1)}` : '');
      await page.screenshot({ path: shot('08-pc-buttons') });
      await page.close();
    }
  } finally {
    await browser.close();
    console.log(`\nRESULT ack-chips: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
