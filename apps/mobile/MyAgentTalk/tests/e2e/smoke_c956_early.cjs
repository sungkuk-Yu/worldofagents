/**
 * t_c956e3ee — 음성 선방송 계약의 프론트 브라우저 실측 (최종단 read-back).
 * 절차는 smoke_t64e3_final.cjs(A파트)를 1:1 답습(증명된 testid 경로)하되, WS 프레임을 계측해
 * "user 발화 카드가 LLM 실행(run.completed)과 무관하게 먼저 뜬다"를 타이밍으로 판정한다.
 *   X1 audio.end 이후 message.new(user) 수신 ≥1
 *   X2 message-user 카드 DOM = 전사문 렌더
 *   X3 user message.new 프레임 시각 < run.completed 시각 (선방송)
 *   X4 user message.new 정확히 1회 (중복 발행 소스 0)
 *   X5 run.completed 이후 에이전트 카드 도착 (턴 정상 종결)
 * 실행: 백엔드 DEV_MODE :3155(STT 사이드카 9833) + node tests/e2e/fr-serve.cjs dist-c956 8195
 *       APP_URL=http://localhost:8195 node tests/e2e/smoke_c956_early.cjs [pcm]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8195';
const PCM = process.argv[2] || path.join(process.env.HOME, '.hermes/profiles/frontdev/cache/scratch/voice_fixture_ko.pcm');
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'c956-early');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
function pcmToWav(pcm, rate = 16000) {
  const n = pcm.length;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(32, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, pcm]);
}

(async () => {
  const stamp = Date.now();
  const email = `c956-${stamp}@myagenttalk.dev`;
  const cred = `c956-${stamp}!A1`;
  const wavB64 = pcmToWav(fs.readFileSync(PCM)).toString('base64');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ws = { audioStart: 0, audioEndAt: 0, userNew: [], runCompletedAt: 0, runStartedAt: 0, finals: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', permissions: ['microphone'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('websocket', (sock) => {
      sock.on('framesent', (f) => {
        const t = String(f.payload);
        if (t.includes('"audio.start"')) ws.audioStart++;
        if (t.includes('"audio.end"') && !ws.audioEndAt) ws.audioEndAt = Date.now();
      });
      sock.on('framereceived', (f) => {
        try {
          const msg = JSON.parse(String(f.payload));
          if (msg.type === 'transcript.final') ws.finals.push({ t: Date.now(), id: msg.message_id, text: msg.text });
          if (msg.type === 'message.new' && msg.message?.role === 'user') ws.userNew.push({ t: Date.now(), id: msg.message.id });
          if (msg.type === 'run.started' && !ws.runStartedAt) ws.runStartedAt = Date.now();
          if ((msg.type === 'run.completed' || msg.type === 'run.failed') && !ws.runCompletedAt) ws.runCompletedAt = Date.now();
        } catch {}
      });
    });

    // 실 발화 주입: getUserMedia → fake wav(mediaElementSource, 16k 컨텍스트) — t64e3 실측본 1:1
    if (wavB64) {
      await page.addInitScript(({ b64 }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (opts) => {
          if (!opts || !opts.audio) return orig(opts);
          const el = document.createElement('audio');
          el.src = blobUrl; el.loop = true;
          await el.play().catch(() => {});
          const Ctor = window.AudioContext || window.webkitAudioContext;
          const actx = new Ctor({ sampleRate: 16000 });
          await actx.resume().catch(() => {});
          const src = actx.createMediaElementSource(el);
          const dest = actx.createMediaStreamDestination();
          src.connect(dest);
          return dest.stream;
        };
      }, { b64: wavB64 });
    }

    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.getByTestId('login-hint').click().catch(async () => { await page.getByTestId('new-chat-button').click(); });
    await page.waitForTimeout(800);
    await page.getByTestId('auth-mode-toggle').click();
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(cred);
    await page.getByTestId('consent-all-required').click();
    await page.getByTestId('signup-submit').click();
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
    await page.getByTestId('new-chat-button').click();
    await page.getByTestId('voice-stage').waitFor({ timeout: 20000 });

    // ── 홀드→릴리스 (PCM 발화 주입) ──
    const box = await page.getByTestId('voice-stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await sleep(4000);
    await page.mouse.up();
    const tRelease = Date.now();

    // user 카드 DOM 등장은 선방송 프레임과 독립적으로 실측 (프론트 최종 렌더가 진짜 기준)
    const userDomShown = await page.waitForFunction(() => document.querySelectorAll('[data-testid="message-user"]').length >= 1, null, { timeout: 120000 }).then(() => true).catch(() => false);
    const tUserDom = Date.now();
    const userTexts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="message-user"]')).map((e) => (e.textContent || '').trim()).join('||'));
    await page.screenshot({ path: path.join(OUT, 'X-early-card-before-completed.png') });

    const agentShown = await page.waitForFunction(() => document.querySelectorAll('[data-testid="message-agent"]').length >= 1, null, { timeout: 120000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: path.join(OUT, 'X-turn-final.png') });

    const rel = (t) => (t ? `${t - tRelease}ms` : '—');
    console.log(`\n  audioEnd=${rel(ws.audioEndAt)} final=${rel(ws.finals[0]?.t)} userWS=${rel(ws.userNew[0]?.t)} runStarted=${rel(ws.runStartedAt)} completed=${rel(ws.runCompletedAt)} userDOM=${rel(userDomShown ? tUserDom : 0)}`);
    check('X1 audio.end 이후 message.new(user) 프론트 수신 ≥1 (선방송)', ws.userNew.length >= 1 && ws.audioEndAt > 0, `frames=${ws.userNew.length}`);
    check('X2 message-user 카드 = 전사문 DOM 렌더', userDomShown && /자료|정리|오후|미팅|회의|해줘|해주세요|일정/.test(userTexts), `texts="${String(userTexts).slice(0, 60)}"`);
    check('X3 user 카드 렌더가 run.completed보다 먼저 (LLM 실행과 무관하게 발화 선시)', !!userDomShown && ws.runCompletedAt > 0 && tUserDom <= ws.runCompletedAt, `userDOM=${rel(userDomShown ? tUserDom : 0)} vs completed=${rel(ws.runCompletedAt)}`);
    check('X4 message.new(user) 정확히 1회 (중복 렌더 소스 0)', ws.userNew.length === 1, `count=${ws.userNew.length}`);
    check('X5 transcript.final.message_id == message.new(user).id (dedup 계약 성립)', ws.finals[0]?.id && ws.userNew[0]?.id === ws.finals[0].id, `final=${String(ws.finals[0]?.id).slice(0, 8)} user=${String(ws.userNew[0]?.id).slice(0, 8)}`);
    check('X6 턴 정상 종결 — 에이전트 카드 도착', agentShown);
    check('Z 페이지 런타임 오류 0', errors.length === 0, errors.slice(0, 2).join('|').slice(0, 150));
  } catch (e) {
    check('실행 완주', false, String(e).slice(0, 200));
  } finally {
    await browser.close();
  }
  console.log(`\nRESULT ${passed} PASS / ${failed} FAIL  (artifacts: ${OUT})`);
  process.exit(failed ? 1 : 0);
})();
