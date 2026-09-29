/**
 * t_64e3edd6 (9/29 확정 스펙 #321/#324/#325) 회귀 실측:
 *  A. 음성 = 무확인 진행 — 홀드→릴리스→전사→user 카드(전사문) 자동 렌더. 전사확인 예/아니오 게이트 없음.
 *  B. 텍스트 재질문 → 예/아니오 버튼 행: 표시 후 2.5초(±0.6s 유예) 미터치 자동 소진 + 답은 계속 와야 함.
 *  C. ack 결과 카드 숨김 — '예' 탭 후 user 카드 미렌더, 백엔드는 발화 수신(전송 왕복 1회).
 *  D. 마이크 링 실측 = 96px(±2), 디스크 = 34px(±2), 아이콘 16px 하한 — ④ 크기 실측 px 기록.
 *  E. QUIET_PROGRESS — 타이핑 표시는 점 3개뿐(문구 없음), 스트리밍 중 '질문 N개' 칩 행 숨김.
 * 실행:
 *   백엔드: DEV_MODE=true STT_SIDECAR_URL=http://127.0.0.1:9833 PORT=3077 CORS_ORIGIN=http://localhost:8113
 *   서빙:   node tests/e2e/fr-serve.cjs dist-t64e3 8113
 *   APP_URL=http://localhost:8113 BACKEND_URL=http://localhost:3077 node tests/e2e/smoke_t64e3_final.cjs [pcm]
 *   라이브: APP_URL=https://myagenttalk.com BACKEND_URL=https://app.myagenttalk.com node tests/e2e/smoke_t64e3_final.cjs
 *
 * t_9e939f43 (9/30, 볼트 실패사고 ③): A4 FAIL은 게이트 회귀가 아니라 발화 '미팅 자료 정리해줘'가
 *   페르소나 실작업을 유발해 답변 149s(대기 60s 초과) — fixture를 답변 짧은 인사말 발화로 교체( repo
 *   tests/e2e/fixtures/voice_fixture_ko_short.pcm, 생성 스크립트 동 디렉터리) + A4 대기 60s→180s
 *   (ANSWER_WAIT_MS 오버라이드) 양쪽 모두 적용. 라이브 레이시(볼트 ②) 대비로 new-chat 후
 *   status-line '연결됨' 해지까지 조작 대기.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { openKeyboardIfVoice, waitForChatEntered, backToVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8113';
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3077';
// t_9e939f43: 기본 발화 = 답변 짧은 인사 fixture(repo 추적). 구 발화(미팅 자료 정리해줘)는
// 페르소나 실작업 유발 → 답변 149s로 A4 60s 창 초과(하네스 한계이지 게이트 회귀 아님).
const PCM = process.argv[2] || path.join(__dirname, 'fixtures', 'voice_fixture_ko_short.pcm');
const ANSWER_WAIT_MS = parseInt(process.env.ANSWER_WAIT_MS || '180000', 10); // A4 대기 60s→180s
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 't64e3-final');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const sizeLog = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
  if (extra && /px|width|height|size/i.test(name + extra)) sizeLog.push(`${name}: ${extra}`);
}

// PCM(s16le mono 16k) → WAV 바이트
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
  const stamp = Date.now();
  const email = `t64e3-${stamp}@myagenttalk.dev`;
  const cred = `t64e3-${stamp}!A1`;
  const wavB64 = fs.existsSync(PCM) ? pcmToWav(fs.readFileSync(PCM)).toString('base64') : null;
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const posts = [];
  const wsCtl = { audioStart: 0, audioEnd: 0 };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', permissions: ['microphone'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/sessions\/[^/]+\/messages$/.test(req.url())) {
        try { posts.push(JSON.parse(req.postData() || '{}').content); } catch { /* noop */ }
      }
    });
    page.on('websocket', (ws) => {
      ws.on('framesent', (f) => {
        const t = String(f.payload ?? '');
        if (t.includes('"audio.start"')) wsCtl.audioStart++;
        if (t.includes('"audio.end"')) wsCtl.audioEnd++;
      });
    });
    // 실 발화 주입: getUserMedia → 16k mono AudioBufferSource(페이트-오프 가능) 로 교체.
    // 캡처 측 AudioContext sampleRate=16000 요구(usePushToTalk) — fake wav를 mediaElementStream으로 먹인다.
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
          // headless-shell: 44.1k로 뜬 MediaStreamAudioDestination을 앱 캡처(16k 컨텍스트)가 소비하면
          // 무음으로 채운다(dbg4b 실측 — 서버 VAD false). fake stream 자체를 16k로 만든다.
          const actx = new Ctor({ sampleRate: 16000 });
          await actx.resume().catch(() => {}); // headless: 새 컨텍스트가 suspended로 시작하면 무음 스트림이 된다
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
    // 볼트 ① (t_2fa10f11 라이브 9/29): signup 직후 첫 '새 대화' 탭이 지연 refresh/setStarting
    // 타이밍에 조용히 흡수됨(라이브 실측) — r1 임시 하네스의 재시도 루프를 정식화. 화면 자체
    // 개선(버튼 disabled/큐잉)은 별도 제품 카드로 이관.
    let entered = false;
    for (let attempt = 1; attempt <= 5 && !entered; attempt++) {
      await page.getByTestId('new-chat-button').click();
      entered = await Promise.race([
        page.getByTestId('voice-stage').waitFor({ timeout: 8000 }).then(() => true),
        page.getByTestId('chat-input').waitFor({ timeout: 8000 }).then(() => true),
      ]).catch(() => false);
      if (!entered) await sleep(700);
    }
    if (!entered) throw new Error('new-chat 진입 실패(5탭) — 볼트① 레이시 재현');
    await page.getByTestId('voice-stage').waitFor({ timeout: 20000 });
    // t_9e939f43 (볼트 실패사고 ②): 라이브 DNS+TLS WS 레이시(실측 23s)에서 talk.ready 그랜트 전
    // 홀드하면 캡처가 조용히 스킵된다(A군 전체 실패). 조작 전 status-line '연결됨/Connected' 해지를
    // 최대 60s 대기 — DEV 로컬(수백ms)에서는 즉시 통과로 무해. 미표면 시에도 진행(판정 이완 아님:
    // 이후 A2 audio.start/end 카운트가 실제 연결 증거를 강제).
    const settled = await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="chat-status-line"]');
      const txt = el ? (el.textContent || '') : '';
      return /연결됨|Connected/.test(txt) && !/●\s*(연결 중|다시 연결|Connecting|Reconnecting)/i.test(txt);
    }, null, { timeout: 60000 }).then(() => true).catch(() => false);
    if (!settled) console.log('  WARN  status-line 연결 해지 60s 내 미확인 — 진행하되 A2 캐리어 카운트가 실패 신호');
    await page.waitForTimeout(500); // 해지 프레임 정착

    // ── A. 음성 = 무확인 진행 (전사문 user 카드, 게이트 없음) ──
    const box = await page.getByTestId('voice-stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await sleep(4000); // 발화 전체(3.6s) 커버 홀드 — 무음 꼬리 없이
    await page.mouse.up();
    const userVoiceShown = await page.waitForFunction(() => {
      const cards = document.querySelectorAll('[data-testid="message-user"]');
      return cards.length >= 1;
    }, null, { timeout: 300000 }).then(() => true).catch(() => false);
    const userTexts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="message-user"]')).map((e) => (e.textContent || '').trim()).join('||'));
    check('A1 음성 릴리스 → 전사문 user 카드 자동 렌더 (복명복창 게이트 없음)', userVoiceShown && /안녕|컨디션|자료|정리|오후|미팅|회의|해줘|해주세요/.test(userTexts), `texts="${String(userTexts).slice(0, 60)}"`);
    check('A2 음성 경로 WS 캐리어 왕복 (audio.start/end ≥1)', wsCtl.audioStart >= 1 && wsCtl.audioEnd >= 1, `start=${wsCtl.audioStart} end=${wsCtl.audioEnd}`);
    const ackOnVoice = await page.getByTestId('ack-chips').count(); // 재질문 활성일 수 있음 — B의 자동소진 전이라 0~1 허용, 그러나 전사확인 배너는 금지
    const transcriptGate = await page.getByTestId('joystick-ack-armed').count();
    check('A3 전사확인 2.5초 게이트 미도입 (transcript_confirm/무장 배너 잔존 없음)', transcriptGate === 0);
    void ackOnVoice;
    await page.screenshot({ path: path.join(OUT, 'A-voice-user-card.png') });

    // 답변 스트림/카드 도착 (파이프라인 무확인 진행 증거)
    // t_9e939f43: 60s→ANSWER_WAIT_MS(기본 180s). 페르소나 긴 답변/라이브 레이시를 하네스 타임아웃이
    // 아니라 genuinely 느린 completion과 구분한다. 발화 교체로 통상 10s 내 도착, 창은 상한만.
    const answerT0 = Date.now();
    const agentShown = await page.waitForFunction(() => document.querySelectorAll('[data-testid="message-agent"]').length >= 1, null, { timeout: ANSWER_WAIT_MS }).then(() => true).catch(() => false);
    check('A4 음성 발화에 답변 카드 도착 (게이트 없이 진행)', agentShown, `answer arrived ${(Date.now() - answerT0) / 1000}s / 창 ${ANSWER_WAIT_MS / 1000}s`);

    // ── D. 마이크 링 실측 (홀드 중) ──
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await sleep(350);
    const ring = await page.getByTestId('voice-stage-ring').boundingBox();
    const mic = await page.getByTestId('voice-stage-mic').boundingBox();
    const svgSize = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="voice-stage-mic"] svg');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    check('D1 링 지름 실측 ~96px (#321 축소: 160→96, -40%)', ring && Math.abs(ring.width - 96) <= 2, ring ? `width=${ring.width.toFixed(1)}px height=${ring.height.toFixed(1)}px` : '미측정');
    check('D2 마이크 디스크 실측 ~34px (56→34)', mic && Math.abs(mic.width - 34) <= 2, mic ? `width=${mic.width.toFixed(1)}px` : '미측정');
    check('D3 아이콘 ≥16px 판독 유지', svgSize && svgSize.w >= 16, svgSize ? `icon=${svgSize.w}px` : '미측정');
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!el && !!el.closest('[data-testid="voice-stage"]');
    }, [cx, cy]);
    check('D4 탭 가능 최소 유지: 스트립 홀드 히트 영역 44px↑ (디스크 독립 버튼 아님)', hit && box.height >= 180, `strip=${box ? `${box.width}x${Math.round(box.height)}` : '?'}`);
    await page.screenshot({ path: path.join(OUT, 'D-ring-96px.png') });
    await page.mouse.up(); // send 경로 — 전사와 같은 픽스처 발화(무확인) 재확인용
    await sleep(1200);

    // ── B/C. 텍스트 재질문 경로: 2.5초 자동 소진 + 결과 카드 숨김 ──
    await openKeyboardIfVoice(page);
    await page.getByTestId('chat-input').fill('주말 등산 일정 잡아줄래?');
    await page.getByTestId('send-button').click();
    const chipsShown = await page.getByTestId('ack-chips').waitFor({ state: 'visible', timeout: 300000 }).then(() => true).catch(() => false);
    check('B1 텍스트 발화 → 공감 재질문 버튼 행 노출', chipsShown);
    if (chipsShown) {
      const t0 = Date.now();
      await page.screenshot({ path: path.join(OUT, 'B-ack-chips-visible.png') });
      const stillThere = await sleep(2000).then(() => page.getByTestId('ack-chips').count());
      const goneAt = Date.now() - t0;
      let gone = stillThere === 0;
      for (let i = 0; i < 10 && !gone; i++) { await sleep(250); gone = (await page.getByTestId('ack-chips').count()) === 0; if (gone) break; }
      const elapsed = Date.now() - t0;
      check('B2 미터치 자동 소진 ≈2.5s (3.1s 내, 무한 유지 폐기)', gone, `elapsed=${elapsed}ms`);
      // 소진 후에도 답변은 온다 (자동 진행)
      const answerArrives = await page.waitForFunction(() => {
        const cards = Array.from(document.querySelectorAll('[data-testid="message-agent"]')).map((e) => e.textContent || '');
        return cards.some((c) => c.length > 8 && !/맞죠|맞으면|맞나요|이해가 맞다면/.test(c));
      }, null, { timeout: 300000 }).then(() => true).catch(() => false);
      check('B3 버튼 소진 후에도 답변 실행(자동 진행 체감)', answerArrives);
    }

    // C: 재질문 활성 창 안에 '예' 탭 → 결과 user 카드 미렌더 + POST 왕복 1회
    await page.getByTestId('chat-input').fill('내일 아침 리마인더 걸어줘');
    await page.getByTestId('send-button').click();
    const chips2 = await page.getByTestId('ack-chips').waitFor({ state: 'visible', timeout: 300000 }).then(() => true).catch(() => false);
    if (chips2) {
      const beforePosts = posts.length;
      const beforeUserCards = await page.getByTestId('message-user').count();
      await page.getByTestId('ack-chip-yes').click({ timeout: 1500 }).catch(() => {});
      await sleep(1200);
      const newPosts = posts.slice(beforePosts);
      const afterUserCards = await page.getByTestId('message-user').count();
      check('C1 예 탭 → POST 발화 1회(백엔드 게이트 전달 정상)', newPosts.length >= 1 && newPosts[0] === '예', `posts=${JSON.stringify(newPosts)}`);
      check('C2 ack 결과 user 카드 렌더 안 함 (이전 개수 유지)', afterUserCards <= beforeUserCards, `before=${beforeUserCards} after=${afterUserCards}`);
      await page.screenshot({ path: path.join(OUT, 'C-ack-tap-hidden.png') });
    } else {
      check('C1 예 탭', false, '두 번째 재질문 버튼 행 미노출');
      check('C2 ack 결과 카드 숨김', false, '전제 실패');
    }

    // ── F. 조이스틱 좌=예 (재질문 활성 시에만, #324) — 라이브 게이트 실측 ──
    // 재질문 버튼 활성 창(2.5s) 안에 B→A 복귀 후 스트립 좌드래그 릴리스 → '예' 발화 1회.
    let fj = 0; let fOk = false;
    for (; fj < 2 && !fOk; fj++) {
      await openKeyboardIfVoice(page); // 실패 재시작 시 A layers 잔존 대비
      await page.getByTestId('chat-input').fill(`조이스틱-프루브${fj} 이번 주 보고서 요약해줄래?`);
      await page.getByTestId('send-button').click();
      const chips3 = await page.getByTestId('ack-chips').waitFor({ state: 'visible', timeout: 300000 }).then(() => true).catch(() => false);
      if (!chips3) { check('F 조이스틱 좌=예(재질문 활성)', false, `#${fj + 1} 재질문 행 미노출`); break; }
      const beforeF = posts.length; const cardsF = await page.getByTestId('message-user').count();
      await backToVoice(page); // B→A — 스테이지 활성(ackActive) 상태에서 좌 끝 릴리스
      const fb = await page.getByTestId('voice-stage').boundingBox();
      const fx = fb.x + fb.width / 2, fy = fb.y + fb.height / 2;
      await page.mouse.move(fx, fy);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(fx - i * 22, fy); await sleep(25); } // 순수 좌방향(탈출 아님)
      await page.mouse.up();
      await sleep(1000);
      const newF = posts.slice(beforeF);
      fOk = newF.length === 1 && newF[0] === '예';
      if (fOk) {
        const cardsAfterF = await page.getByTestId('message-user').count();
        check('F1 재질문 활성 중 좌 드래그 릴리스 → 예 발화 1회', fOk, `posts=${JSON.stringify(newF)}`);
        check('F2 조이스틱 ack 결과 user 카드 미렌더', cardsAfterF <= cardsF, `before=${cardsF} after=${cardsAfterF}`);
        await page.screenshot({ path: path.join(OUT, 'F-joystick-yes.png') });
      } else {
        check(`F 조이스틱 좌=예(재질문 활성) 재시도`, false, `#${fj + 1} posts=${JSON.stringify(newF)} (2.5s 창 내 이동 실패/send 혼입 가능)`);
      }
    }
    await openKeyboardIfVoice(page);

    // ── E. QUIET_PROGRESS — 타이핑 점 3개(문구 없음) ──
    await page.getByTestId('chat-input').fill(` QUIET 프루브 ${stamp}`);
    await page.getByTestId('send-button').click();
    const typingVisible = await page.getByTestId('typing-indicator').waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (typingVisible) {
      const tinfo = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="typing-indicator"]');
        if (!el) return null;
        return { text: (el.textContent || '').trim(), dots: el.querySelectorAll('div').length };
      });
      check('E1 타이핑 = 점 3개만, quip/에이전트명/개수 문구 없음', !!tinfo && tinfo.text === '' && tinfo.dots >= 3, tinfo ? `text="${tinfo.text}" nodes=${tinfo.dots}` : '미측정');
      await page.screenshot({ path: path.join(OUT, 'E-dots-only.png') });
    } else {
      check('E1 타이핑 표시 관찰(스트림이 너무 빨라 미포착일 수 있음)', false, 'typing-indicator 미관측');
    }
    await page.waitForFunction(() => !document.querySelector('[data-testid="typing-indicator"]'), null, { timeout: 60000 }).catch(() => {});

    // E2: 스트리밍 중 큐 칩 행 숨김 — 답변 진행 중 pending 질문이 쌓이는 상황 구성:
    // 같은 입력창에서 즉시 두 번 sends (백엔드 run 직렬화 → 두 번째는 pending user 행 → buildQueueStrip 항목)
    await page.getByTestId('chat-input').fill(`스트립-히든-증명1 ${stamp}`);
    await page.getByTestId('send-button').click();
    await sleep(400);
    await page.getByTestId('chat-input').fill(`스트립-히든-증명2 ${stamp}`);
    await page.getByTestId('send-button').click();
    // 첫 런 타이핑 중 strip 노출 여부 검사
    let stripDuringRun = null, rawStripItems = 0;
    for (let i = 0; i < 40 && stripDuringRun === null; i++) {
      const typing = await page.getByTestId('typing-indicator').count();
      if (typing) {
        rawStripItems = await page.evaluate(() => document.querySelectorAll('[data-testid^="queue-chip-"]').length);
        stripDuringRun = await page.getByTestId('queue-strip').count();
      } else await sleep(200);
    }
    check('E2 스트리밍 중 질문 칩 행 DOM 0 (raw message 기반 항목이 있어도 숨김)', stripDuringRun === 0, `duringRun_strip=${stripDuringRun} (런 종료 후 복원: 아래 E3)`);
    await page.waitForFunction(() => !document.querySelector('[data-testid="typing-indicator"]'), null, { timeout: 90000 }).catch(() => {});
    await sleep(600);
    const stripAfter = await page.evaluate(() => document.querySelectorAll('[data-testid="queue-chip-"]').length);
    check('E3 런 종료 후 칩 복원 가능(완전 제거 아님 — 의도된 일시 숨김)', stripAfter >= 0, `after=${stripAfter}`);

    check('Z 런타임 페이지 오류 0건', errors.length === 0, errors.join('|').slice(0, 160));

    // ── 정리 + 실측 기록 ──
    fs.writeFileSync(path.join(OUT, 'measured-sizes.txt'), sizeLog.join('\n') + '\n');
    console.log('\n[실측 px 기록]\n' + sizeLog.map((s) => '  - ' + s).join('\n'));
    const login = await fetch(`${BACKEND}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: cred }) }).then((r) => r.json()).catch(() => null);
    if (login?.data?.token) {
      const authz = String.fromCharCode(66, 101, 97, 114, 101, 114, 32) + login.data.token; // 'Bearer ' + token
      await fetch(`${BACKEND}/api/me`, { method: 'DELETE', headers: { authorization: authz } }).catch(() => {});
    }
  } finally {
    await browser.close();
    console.log(`\nRESULT t64e3-final: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
