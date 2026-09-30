/**
 * t_5058e15f — 9/30 라이브 레이시 2건 회귀 스모크 (로컬 재현: 프록시 지연 주입)
 *  ① signup → 대화목록 첫 refresh(GET health/agents/sessions ×2.5s 지연) 창 안에
 *     '새 대화' 1회 탭 → 조용 흡수 금지: 로딩 해지 후 자동 실행 → 채팅 진입(voice-stage),
 *     POST /api/agents 정확히 1회(이중 발차 없음), 탭 재시도 없음.
 *  ② WS /ws 업그레이드 주차(talk.ready=false 창 형성) 중 voice-stage 홀드 →
 *     '연결 중' 실측 신호(voice-stage-connecting) + audio.start 미전송(조용한 스킵/전송 위장 금지),
 *     릴리스 = 조용한 폐기(✓ 배너·폴백 토스트 없음), 재홀드 중 /release-ws → ready 전환 →
 *     캡처 자동 시작(voice-stage-recording + audio.start≥1) → 릴리스 → audio.end.
 * 실행:
 *   백엔드: DEV_MODE=true PORT=3079 CORS_ORIGIN=http://localhost:8147 node dist/index.js
 *   빌드:   EXPO_PUBLIC_API_URL=http://localhost:8147 npx expo export --platform web --output-dir dist-t5058e15f --clear
 *   프록시: node tests/e2e/racey_proxy_t5058e15f.cjs   (정적 서빙+포워드+주차, :8147)
 *   스모크: node tests/e2e/smoke_racey_lag_t5058e15f.cjs
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8147';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'racey-lag-t5058e15f');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const getState = async () => fetch(`${APP}/state`).then((r) => r.json());

(async () => {
  const stamp = Date.now();
  const email = `t5058e15f-${stamp}@myagenttalk.dev`;
  const cred = `t5058e15f-${stamp}!A1`;
  const wsCtl = { audioStart: 0, audioEnd: 0, audioCancel: 0, opened: 0 };
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', permissions: ['microphone'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('websocket', (ws) => {
      ws.on('open', () => { wsCtl.opened++; });
      ws.on('framesent', (f) => {
        const t = String(f.payload ?? '');
        if (t.includes('"audio.start"')) wsCtl.audioStart++;
        if (t.includes('"audio.end"')) wsCtl.audioEnd++;
        if (t.includes('"audio.cancel"')) wsCtl.audioCancel++;
      });
    });

    // ── signup ──
    await fetch(`${APP}/reset`, { method: 'POST' }); // 프록시 재시작 불필요: 지연 창·카운터 초기화
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.getByTestId('login-hint').click().catch(async () => { await page.getByTestId('new-chat-button').click(); });
    await page.waitForTimeout(800);
    await page.getByTestId('auth-mode-toggle').click();
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(cred);
    await page.getByTestId('consent-all-required').click();
    await page.getByTestId('signup-submit').click();
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 30000 });

    // ── ① 첫 탭 1회 — 로딩(지연 refresh) 창 안 ──
    const tapAt = Date.now();
    await page.getByTestId('new-chat-button').click(); // 지연 창 안 = 큐잉 경로 (실패 시 'disabled' 토áss throw)
    await page.getByTestId('voice-stage').waitFor({ timeout: 25000 });
    const enterAt = Date.now();
    const st1 = await getState();
    check('①-A signup 직후 첫 탭 1회로 채팅 진입(voice-stage 도달)', enterAt - tapAt < 25000, `탭→진입 ${((enterAt - tapAt) / 1000).toFixed(1)}s (재탭 없음)`);
    check('①-B POST /api/agents 정확히 1회 (이중 발차/재탭 중복 없음)', st1.postAgents === 1, `postAgents=${st1.postAgents}`);
    check('①-C 지연 refresh(health/agents/sessions) 실주입 하에서 재현', st1.delayed >= 2, `delayed=${st1.delayed} (GET 지연 횟수)`);
    await page.screenshot({ path: path.join(OUT, '1-chat-entered.png') });

    // ── ② WS 주차(연결 보류) 중 voice 홀드 ──
    // 주차 후 새로고침 → 목록의 이어보기 세션 카드로 진입(신규 생성 없이) → WS 업그레이드 주차 = talk.ready false 창
    await fetch(`${APP}/park-ws`, { method: 'POST' }); // 이후 /ws 업그레이드 15s 주차
    await page.reload({ waitUntil: 'load' });
    await page.getByTestId('new-chat-button').waitFor({ timeout: 20000 });
    await page.getByTestId('session-card').first().click();
    await page.getByTestId('voice-stage').waitFor({ timeout: 30000 });

    const box = await page.getByTestId('voice-stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down(); // 그랜트 — WS 주차 중 = talk.ready false
    const connectingShown = await page.getByTestId('voice-stage-connecting').waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: path.join(OUT, '2a-hold-connecting.png') });
    check('②-A 연결 대기 중 홀드 = 사용자 인식 가능 신호 (voice-stage-connecting 노출)', connectingShown);
    check('②-B 주차 구간 audio.start 미전송 (조용한 스킵도, 위장 전송도 없음)', wsCtl.audioStart === 0, `audioStart=${wsCtl.audioStart}`);
    const recDuringPark = await page.getByTestId('voice-stage-recording').count();
    check('②-C 주차 중 녹음 문구 미노출 (캡처 미시작 정합성)', recDuringPark === 0);

    // 릴리스 = 조용한 폐기
    await page.mouse.up();
    await sleep(800);
    const goneConnecting = (await page.getByTestId('voice-stage-connecting').count()) === 0;
    const doneBadge = await page.getByTestId('voice-stage-done').count();
    const fallback = await page.getByTestId('chat-voice-fallback').count();
    check('②-D 대기 중 릴리스 = 안내 종료 + ✓ 전송 위장 없음·토스트 없음', goneConnecting && doneBadge === 0 && fallback === 0, `done=${doneBadge} fallback=${fallback}`);
    check('②-E 폐기 후 audio.* 미전송', wsCtl.audioStart === 0 && wsCtl.audioEnd === 0 && wsCtl.audioCancel === 0);

    // 재홀드 → /release-ws = ready 전환 → 캡처 자동 시작
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.getByTestId('voice-stage-connecting').waitFor({ state: 'visible', timeout: 5000 });
    await fetch(`${APP}/release-ws`, { method: 'POST' });
    const autoStart = await page.getByTestId('voice-stage-recording').waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: path.join(OUT, '2b-ready-autostart.png') });
    check('②-F 홀드 중 연결 완료 = 캡처 자동 시작 (voice-stage-recording)', autoStart);
    await sleep(2500); // PCM 프레임 흐름 확인
    await page.mouse.up();
    await sleep(1500);
    check('②-G 자동 시작 후 왕복: audio.start≥1 → 릴리스 audio.end≥1', wsCtl.audioStart >= 1 && wsCtl.audioEnd >= 1, `start=${wsCtl.audioStart} end=${wsCtl.audioEnd}`);

    check('Z 런타임 페이지 오류 0건', errors.length === 0, errors.join('|').slice(0, 200));

    // 후속 검증: 연결 후 정상 홀드는 즉시 캡처(레그레이션 회귀 방지) — 1회 추가 홀드
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const fastCapture = await page.getByTestId('voice-stage-recording').waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    await page.mouse.up();
    check('H 연결 이후 홀드 = 즉시 캡처 (지연 시작 경로 무침범)', fastCapture);

    const st2 = await getState();
    console.log('\n[프록시 state] ' + JSON.stringify(st2));
    console.log('[WS 카운터] ' + JSON.stringify(wsCtl));
  } finally {
    await browser.close();
    console.log(`\nRESULT racey-lag-t5058e15f: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exit(1);
  }
})();
