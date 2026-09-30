/**
 * t_2eea055a — 텔레그램식 녹음 시간 (대표님 9/30 "음성녹음할때 텔레그램처럼 녹음 시간 보여줘야되")
 * 검증:
 *   ① 홀드 중 'M:SS' 라이브 카운터 (voice-stage-timer) — 1.2초 홀드에서 0:01 이상 실측,
 *      릴리스 후 잔상 0.
 *   ② 발송된 user 음성 카드(message_type='voice' + stt_metadata.duration_ms)의 메타 행에
 *      🎤 + '0:05' 배지 (voice-duration-<id>) 렌더.
 *   ③ duration 결측(구 행) 음성 카드는 아이콘만 — 'M:SS' 텍스트 없음(추측 표기 금지).
 *   ④ 텍스트 user 카드는 배지 없음.
 *   ⑤ 콘솔/런타임 예외 0건.
 * 실행: EXPO_PUBLIC_API_URL=http://localhost:8432 EXPO_PUBLIC_WS_URL=ws://localhost:8432/ws \
 *       node_modules/.bin/expo export --platform web --output-dir dist-t2eea055a --clear
 *       node tests/e2e/fr-serve.cjs dist-t2eea055a 8432 &
 *       APP_URL=http://localhost:8432 node tests/e2e/smoke_voice_duration_t2eea055a.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8432';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'voice-duration');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = process.env.CHROME_PATH || '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
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

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── ① 홀드 중 라이브 카운터 ────────────────────────────────────────────────
    {
      const { page, errors } = await openMobileChat(browser);
      check('① 대기 중 타이머 미렌더', (await page.getByTestId('voice-stage-timer').count()) === 0);
      const box = await page.getByTestId('voice-stage').boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.waitForTimeout(1250); // 텔레그램처럼 초가 차는 것을 실증: >= 1.2s
      const timer = page.getByTestId('voice-stage-timer');
      const visible = await timer.count() === 1 && await timer.isVisible();
      const txt = visible ? (await timer.textContent()).trim() : '';
      check("① 홀드 중 voice-stage-timer 'M:SS' 렌더", visible, `txt=${txt}`);
      check("① 경과 실측 — 1.2s 홀드에서 '0:01' 이상", /^(\d+):([0-5]\d)$/.test(txt) && (Number(RegExp.$1) > 0 || Number(RegExp.$2) >= 1), `txt=${txt}`);
      // 카운터가 자라는지 1.2초 더 관측 (200ms 이하 간격 갱선 보장)
      const t0 = txt;
      await page.waitForTimeout(1200);
      const t1 = (await timer.textContent()).trim();
      check('① 라이브 카운터 — 시간 증가', t1 !== t0, `${t0} → ${t1}`);
      await page.screenshot({ path: shot('10-hold-timer') });
      await page.mouse.up();
      await page.waitForTimeout(600);
      check('① 릴리스 후 타이머 잔상 0', (await page.getByTestId('voice-stage-timer').count()) === 0);
      check('① 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));
      await page.close();
    }

    // ── ②③④ 발송된 음성 카드 길이 배지 (GET messages 픽스처 주입) ───────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const state = await installFixtures(page);
      const NOW = Date.now();
      const ago = (s) => new Date(NOW - s * 1000).toISOString();
      // 백엔드 chatTurn.ts serializeMessage 스프레드 형상: message_type + stt_metadata 실존
      state.messages.source = [
        { id: 'v1', session_id: 'source', role: 'user', turn_index: 0, content: '녹음으로 말한 발화입니다', message_type: 'voice', stt_metadata: { duration_ms: 5400, confidence: 0.9, language: 'ko', service: 'openai' }, created_at: ago(300) },
        { id: 'v2', session_id: 'source', role: 'user', turn_index: 1, content: '길이 없는 옛 음성 행', message_type: 'voice', stt_metadata: null, created_at: ago(200) },
        { id: 't1', session_id: 'source', role: 'user', turn_index: 2, content: '텍스트 발화', message_type: 'text', created_at: ago(100) },
        { id: 'a1', session_id: 'source', role: 'agent', turn_index: 3, content: '답변입니다', message_type: 'text', created_at: ago(99) },
      ];
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.getByTestId('session-card').click();
      await page.waitForTimeout(800);
      const badge = page.getByTestId('voice-duration-v1');
      const badgeVisible = await badge.count() === 1 && await badge.isVisible();
      const badgeTxt = badgeVisible ? (await badge.textContent()).trim() : '';
      check("② 음성 카드 메타 행 '0:05' 배지 (5400ms 절삭)", badgeVisible && badgeTxt === '0:05', `txt=${badgeTxt}`);
      const badge2 = page.getByTestId('voice-duration-v2');
      const badge2Visible = await badge2.count() === 1 && await badge2.isVisible();
      const badge2Txt = badge2Visible ? (await badge2.textContent()).trim() : '';
      check('③ duration 결측 음성 행 = 길이 텍스트 없음(아이콘만)', badge2Visible && badge2Txt === '', `txt='${badge2Txt}'`);
      check('④ 텍스트 user 카드는 배지 없음', (await page.getByTestId('voice-duration-t1').count()) === 0);
      check('④ 에이전트 카드는 배지 없음', (await page.getByTestId('voice-duration-a1').count()) === 0);
      await page.screenshot({ path: shot('20-voice-card-badges'), fullPage: false });
      check('⑤ 런타임 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\nsmoke_voice_duration: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
