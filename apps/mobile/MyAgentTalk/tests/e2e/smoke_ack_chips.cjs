/**
 * 예/아니요 텔레그램식 50/50 대형 버튼 + 조이스틱 홀드-arm e2e 스모크
 * — t_043539ff(소형 척) → t_c62a2eb7(대표님 9/28 "예와 아니요가 반반씩 텔레그램 형태로, 크게")
 * 검증:
 *   ① 발화 후 공감 재질문 카드 하단 버튼 행 노출 — 라벨 고정: 좌 '예'/우 '아니요' (t_1b123e59:
 *      원문① affirmative 좌측 고정 + 원문② "맞아요가 아니고 예/아니요 로만" — template_id 바인딩 폐기),
 *      50/50 폭 분할, 버튼 높이 ≥44px, 구분선 1px, affirmative('예')만 초록 채움
 *   ② 소진 전(≤2.4s) 유지 + 2.5초 경과 미터치 자동 소진(t_64e3edd6 #321 개정 — t_c62a2eb7 '3초+ 무한 유지'
 *      폐기: "안 누르더라도 3초(→2.5s) 후에 그냥 바로 답변"). 실측 소진 2540ms(t_64e3edd6 B2), tick 200ms 유예 포함 3.2s 판정.
 *   ③ '예' 탭 = POST 발화 1회, payload = 라벨과 동일 텍스트(게이트 계약 텍스트) — 2.5s 창 내 재질문 후 즉시 탭
 *   ④ 탭 후 해당 버튼 행 소멸(연속 질문 스팸 방지 — 발화 진행이 수명), 다음 턴은 신규 카드에만
 *   ⑤ 재질문 활성 중 ← 방향 이동 = 즉시 아밍 힌트 → 릴리스 = audio.cancel + '예' POST
 *      (t_64e3edd6 0.8s arm 타이머 폐지 — stageReleaseOutcome ackActive 게이트, 소진 창 내 수행)
 *   ⑥ 소진 후(버튼 행 비활성) 좌 스와이프 = 텍스트 발화 없음 — t_08d671a8 5방향 재매핑: ← = cancel(폐기).
 *      (구 계약 '얕은 좌 스와이프 = audio.end 전송'은 무효 — 70px 드래그는 270° cancel 섹터)
 *      히트 앵커 ⑤⑥/openKeyboard = voice-stage-pad (96px 원, 스트립 상단 55% — t_8dbb1619 하향 개정, t_a827e5ef 하네스 갱신).
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
  await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
  return { page, state, errors, ctx };
}
// t_4758f25d: A→B 전이는 스트립 홀드 후 ↑ 릴리스뿐 (키보드 버튼 폐기)
// t_a827e5ef (t_08d671a8 패드 재설계): 히트 앵커 = voice-stage-pad (스트립 상단 PAD_TOP_PERCENT=55% (t_8dbb1619)
// 인데ント, 96px 원). 구 voice-stage 스트립 중심은 패드 하단 밖 — 홀드 그랜트 자체가 안 잡힌다.
async function openKeyboard(page) {
  const box = await page.getByTestId('voice-stage-pad').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(cx, cy - i * 20); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.getByTestId('chat-input').waitFor({ timeout: 8000 });
}
const sends = (state) => state.calls.filter((c) => c.path.endsWith('/messages') && c.method === 'POST').map((c) => c.body && c.body.content);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── ⑦ 히스토리 재현 = 버튼 없음 (진입 직후 stale empathy 행만 존재) ──
    const { page, state, errors } = await openMobileChat(browser);
    check('⑦ 진입 시점 stale 공감 행에 버튼 행 없음', (await page.getByTestId('ack-chips').count()) === 0);

    // ── ① 발화 → 재질문 카드 하단 50/50 버튼 행 (첫 턴 = eq_analytic → '예'/'아니요') ──
    await openKeyboard(page);
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

    // ── ② 소진 전 유지 + 2.5초 미터치 자동 소진 (t_64e3edd6 #321: '3초+ 무한 유지' 폐기) ──
    // t0 = 행 노출 확인 시점(생성 시각 이후). 실측 소진 2540ms + tick 200ms 유예 → 3.4s엔 확정 소멸.
    const t0 = Date.now();
    await page.waitForTimeout(1200); // 소진 창 내 (t0+1.2s < 2.5s)
    const aliveBeforeBurn = (await page.getByTestId('ack-chips').count()) === 1;
    check('② 소진 전(≤2.4s) 버튼 행 유지', aliveBeforeBurn, `elapsed=${Date.now() - t0}ms`);
    await page.screenshot({ path: shot('02-still-alive-before-burn') });
    await page.waitForTimeout(Math.max(0, 3400 - (Date.now() - t0)));
    const burned = (await page.getByTestId('ack-chips').count()) === 0;
    check('② 2.5초 미터치 자동 소진 — 버튼 행 소멸 (3.4s 실측 유예 내)', burned, `elapsed=${Date.now() - t0}ms`);
    const autoAnswer = await page.getByText('Test reply to 내일 출장 일정 잡아줘', { exact: false }).count();
    check('② 소진 후에도 답변 존재(자동 진행 체감 — 답변은 확인 발화 없이 직결)', autoAnswer >= 1);
    await page.screenshot({ path: shot('02b-gone-after-burn') });

    // ── ③④ '예' 탭 = POST 1회 + 해당 행 소멸 — 2.5s 창 내 즉시 탭 (새 턴) ──
    await page.getByTestId('chat-input').fill('회의실을 잡을까');
    await page.getByTestId('send-button').click();
    const row3 = await page.getByTestId('ack-chips').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
    check('③ 신규 턴 재질문 버튼 행 노출(탭 전제)', row3);
    const before = sends(state).length;
    if (row3) await page.getByTestId('ack-chip-yes').click(); // 노출 직후 — 소진 창(2.5s) 내
    await page.waitForTimeout(400);
    const after = sends(state);
    check('③ 버튼 탭 = POST 발화 1회', row3 && after.length === before + 1, JSON.stringify(after.slice(before)));
    check('③ payload = 라벨과 동일 "예" (고정 라벨 = 게이트 계약 텍스트, t_1b123e59)', after[after.length - 1] === '예');
    await page.waitForTimeout(200);
    const domIds = await page.evaluate(() => document.querySelectorAll('[data-testid="ack-chips"]').length);
    check('④ 탭 후 이전 버튼 행 잔존 없음(≤1 = 다음 턴 신규만)', domIds <= 1, `rows=${domIds}`);

    // ── ③b 두 번째 턴(eq_proceed) — 라벨 고정: 템플릿 무관 동일 '예'/'아니요' ──
    await page.getByTestId('chat-input').fill('예산도 같이 볼까');
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

    // ── ⑤ 재질문 활성 중 ← 방향 = 즉시 아밍 → 릴리스 = '예' 발화 (arm 타이머 폐지, 소진 창 내) ──
    await page.getByTestId('chat-input').fill('조이스틱-프루브 이번 주 보고서 요약해줄래?');
    await page.getByTestId('send-button').click();
    const row5 = await page.getByTestId('ack-chips').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
    check('⑤ 재질문 활성 전제(버튼 행 노출)', row5);
    await page.getByTestId('chat-voice-back').click(); // B→A: 입력바 우측 마이크 탭 (#304)
    await page.getByTestId('voice-stage').waitFor({ timeout: 5000 });
    // t_a827e5ef: 홀드 히트 = voice-stage-pad (96px 원, 스트립 상단 55% 인덴트 — t_f8c40db0/t_08d671a8 계약).
    const box = await page.getByTestId('voice-stage-pad').boundingBox();
    assert.ok(box, 'voice-stage-pad 박스');
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const before4 = sends(state).length;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(cx - 14 * i, cy); await page.waitForTimeout(20); } // 순수 좌방향(escape 임계 미달)
    const armed = await page.getByTestId('joystick-ack-armed').isVisible().catch(() => false);
    check('⑤ ← 방향 이동 = 즉시 아밍 힌트("예 — 놓으면 전송") — 0.8s arm 타이머 폐지', armed);
    await page.screenshot({ path: shot('05-joystick-armed') });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after4 = sends(state);
    const types = state.frames.filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑤ 릴리스 = "예" 텍스트 POST 1회', after4.length === before4 + 1 && after4[after4.length - 1] === '예', JSON.stringify(after4.slice(before4)));
    check('⑤ 음성 발화는 폐기(audio.start→cancel, end 없음)', types.includes('audio.start') && types.includes('audio.cancel') && !types.slice(types.lastIndexOf('audio.start')).includes('audio.end'), types.slice(-8).join(','));
    const bannerGone = (await page.getByTestId('joystick-ack-armed').count()) === 0;
    check('⑤ 릴리스 후 아밍 배너 소멸', bannerGone);

    // ── ⑥ 소진 후(비활성) 좌 스와이프 = 텍스트 발화 없음 — t_08d671a8 5방향 재매핑: ← = cancel(폐기) ──
    // ⑤의 '예' 발화가 만든 신규 재질문 행도 2.5s에 소진 → ackActive=false 상태 확보.
    await page.waitForTimeout(3400);
    const preSwipeRow = (await page.getByTestId('ack-chips').count()) === 0;
    check('⑥ 전제: 스와이프 시점 버튼 행 소진(비활성)', preSwipeRow);
    const before5 = sends(state).length;
    const typesBefore = state.frames.length;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(cx - 14 * i, cy); await page.waitForTimeout(30); }
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(400);
    check('⑥ 비활성 좌 스와이프 = 텍스트 발화 없음(ack 미발동)', sends(state).length === before5);
    const newFrames = state.frames.slice(typesBefore).filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    // t_a827e5ef: 선택 계약 갱신 — ack 소진 후 ←(270° 섹터, 70px ≥ 센터데드존 19.2)는 'cancel' 액션 =
    // 음성 폐기(audio.cancel), 전송(audio.end)도 ack 발화도 아니다 (gesture.ts STAGE_SECTORS).
    check('⑥ 소진 후 좌 스와이프 = cancel 경로(audio.cancel, 발화 없음)', newFrames.includes('audio.cancel') && !newFrames.includes('audio.end'), newFrames.join(','));
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
      check('⑧ PC = 음성 스테이지/디스크 없음', (await page.getByTestId('voice-stage').count()) === 0 && (await page.getByTestId('joystick-mic').count()) === 0);
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
