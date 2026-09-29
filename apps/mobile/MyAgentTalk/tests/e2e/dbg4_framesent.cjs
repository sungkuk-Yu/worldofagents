/**
 * dbg4 — 앱 비파괴 계측: Playwright framesent로 음성 바이너리 프레임 수/바이트 합 + audio.start/end TXT 확인.
 * 실패 가설 검증: (a) fake-mic 오디오가 실제로 캡처되어 전송되는가 (bin 바이트>0),
 *                  (b) 서버 응답 transcript.final 도착 여부(page WS event log).
 * 실행: APP_URL=http://localhost:8113 node tests/e2e/dbg4_framesent.cjs
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');

const APP = process.env.APP_URL || 'http://localhost:8113';
const PCM = process.env.PCM || '/home/holysky87/.hermes/profiles/frontdev/cache/scratch/voice_fixture_ko.pcm';
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pcmToWav(pcm, rate = 16000) {
  const n = pcm.length;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, pcm]);
}

(async () => {
  const wavB64 = pcmToWav(fs.readFileSync(PCM)).toString('base64');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', permissions: ['microphone'] });
  const page = await ctx.newPage();
  const micCalls = [];
  page.on('console', (m) => { const t = m.text(); if (/__MIC__/.test(t)) micCalls.push(t); });

  const sent = { bin: 0, binBytes: 0, audioStart: 0, audioEnd: 0 };
  const recvLog = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => {
      const p = f.payload;
      if (typeof p === 'string') {
        if (p.includes('"audio.start"')) sent.audioStart++;
        if (p.includes('"audio.end"')) sent.audioEnd++;
      } else {
        sent.bin++;
        sent.binBytes += (p && (p.byteLength ?? p.length)) || 0;
      }
    });
    ws.on('framereceived', (f) => {
      const t = typeof f.payload === 'string' ? f.payload : '';
      const m = /"type":"([^"]+)"/.exec(t);
      const ty = m?.[1];
      if (ty && /transcript|audio|vad/.test(ty)) recvLog.push(t.slice(0, 240));
    });
  });

  await page.addInitScript(({ b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (opts) => {
      if (!opts || !opts.audio) return orig(opts);
      const log = (s) => { try { console.log('__MIC__ ' + s); } catch { /* noop */ } };
      try {
        const el = document.createElement('audio');
        el.src = blobUrl; el.loop = true; el.muted = false;
        const playErr = await el.play().then(() => null, (e) => String(e && e.name));
        log('play=' + (playErr || 'ok'));
        const Ctor = window.AudioContext || window.webkitAudioContext;
        // 캡처 측(usePushToTalk)이 여는 16k 컨텍스트와 같은 rates로 stream을 내보낸다 —
        // headless-shell은 44.1k MediaStreamAudioDestination을 16k 컨텍스트가 소비하면 무음으로 채운다(VAD false).
        const actx = new Ctor({ sampleRate: 16000 });
        log('state0=' + actx.state + ' sr0=' + actx.sampleRate);
        if (actx.state === 'suspended') await actx.resume().catch(() => {});
        log('state1=' + actx.state + ' sr1=' + actx.sampleRate);
        const srcNode = actx.createMediaElementSource(el);
        const dest = actx.createMediaStreamDestination();
        srcNode.connect(dest);
        // 앱 캡처(scriptProcessor)와 독립적으로 진폭 프로브: 900ms 후 peak 보고
        const an = actx.createAnalyser(); an.fftSize = 2048;
        srcNode.connect(an);
        const buf = new Float32Array(an.fftSize);
        setTimeout(() => { an.getFloatTimeDomainData(buf); let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i])); log('peak900=' + pk.toFixed(4) + ' ct=' + Math.round(el.currentTime * 100) / 100); }, 900);
        log('track=' + dest.stream.getAudioTracks().map((t) => t.label + '/' + t.readyState).join(','));
        return dest.stream;
      } catch (e) {
        log('inject-ERR ' + String(e));
        return orig(opts);
      }
    };
  }, { b64: wavB64 });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByTestId('login-hint').click().catch(async () => { await page.getByTestId('new-chat-button').click(); });
  await page.waitForTimeout(800);
  const cred = 'Dbg4!' + Math.random().toString(36).slice(2, 8);
  await page.getByTestId('auth-mode-toggle').click();
  await page.getByTestId('login-email').fill(`dbg4-${Date.now()}@probe.dev`);
  await page.getByTestId('login-password').fill(cred);
  await page.getByTestId('consent-all-required').click();
  await page.getByTestId('signup-submit').click();
  await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('voice-stage').waitFor({ timeout: 25000 });

  const box = await page.getByTestId('voice-stage').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await sleep(4500); // 발화 3.6s + 헤드룸
  await page.mouse.up();
  await sleep(25000); // 전사/턴 대기

  console.log('SENT:', JSON.stringify(sent));
  console.log('MIC LOGS:', JSON.stringify(micCalls, null, 1));
  console.log('RECV(audio/transcript):', JSON.stringify(recvLog, null, 1));
  const userCards = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="message-user"]')).map((e) => (e.textContent || '').trim()));
  console.log('USER CARDS:', JSON.stringify(userCards));
  await page.screenshot({ path: path.join(__dirname, 'artifacts', 'dbg4.png') });
  await browser.close();
})().catch((e) => { console.error('DBG4-ERR', e); process.exit(1); });
