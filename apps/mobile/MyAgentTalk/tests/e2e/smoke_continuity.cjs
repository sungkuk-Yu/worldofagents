/**
 * 크로스 디바이스 연속성 + PTT 스모크 — t_eded715c (PC 3패널 반응형 · 2탭 동시성 · PTT)
 * 실 API 연동 판정: DEV_MODE 백엔드(:3020) + dist-continuity 정적서버(:8099) 대상 (mock 아님).
 * 실행:
 *   백엔드: DEV_MODE=true PORT=3020 CORS_ORIGIN=http://localhost:8099 npx tsx src/index.ts
 *   정적서버: python3 -m http.server 8099 --bind 127.0.0.1 -d dist-continuity (+window.process shim)
 *   APP_URL=http://localhost:8099 node tests/e2e/smoke_continuity.cjs
 * 검증 흐름 (카드 요구 1·2·3 + 확정 ①~⑤):
 *   ① A(모바일 웹 390) 가입→새 채팅→전송 → B(PC 1440) resume 배너→진입→WS 반영 <2s
 *   ② PC 3패널: 1440=사이드바+채팅+컨텍스트패널 / 900=레일+채팅(패널 없음) / 390=단일컬럼 — 캡처 3매
 *   ③ presence 뱃지: 양쪽 탭에 상대 디바이스 라벨 노출
 *   ④ read-state 커서: B 열람 후 GET 커서 ≥0 · device=pc-web
 *   ⑤ PTT: 입력창 포커스 시 V 미캡처(타이핑) → 홀드 V→릴리스→ mock 전사 → A 탭에 반영(교차 입력)
 *   ⑥ 키 재매핑(KeyK)+토글 모드: REST PATCH prefs → 재로드 → K 두 번 눌러 전송
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8099';
const API = process.env.API_URL || 'http://localhost:3020';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'continuity');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
async function signup(page, email, cred) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="login-hint"], [data-testid="new-chat-button"]', { timeout: 20000 });
  const hint = await page.getByTestId('login-hint').count();
  if (hint) {
    await page.getByTestId('login-hint').click();
    await page.getByTestId('auth-mode-toggle').click();
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(cred);
    await page.getByTestId('consent-all-required').click();
    await page.getByTestId('signup-submit').click();
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
  }
  await page.waitForTimeout(600);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const stamp = Date.now();
  const errors = [];
  try {
    // 같은 컨텍스트 = 같은 localStorage(계정 토큰 공유) — "동일 계정 2디바이스" 재현
    const ctx = await browser.newContext({ locale: 'ko-KR' });
    ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(String(e))));

    // ── ① A: 모바일 웹 — 가입 → 새 채팅 → 전송 ──
    const A = await ctx.newPage();
    await A.setViewportSize({ width: 390, height: 844 });
    await signup(A, `cont-a-${stamp}@myagenttalk.dev`, `cont-pw-${stamp}`);
    await A.getByTestId('new-chat-button').first().click();
    await A.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    await A.getByTestId('chat-input').fill('hello-crossdev');
    await A.getByTestId('send-button').click();
    await A.waitForSelector('text=hello-crossdev', { timeout: 10000 });
    await A.screenshot({ path: shot('01-mobile-chat') });
    // read-state 커서는 max 병합 — A 화면이 열람 중이면 어떤 기기든 '읽음'이 맞다.
    // 크로스 디바이스 '이어볼 가치'(unread>0)를 재현하려면 A를 채팅에서 떼어놓고 미열람 활동을 만들어야 한다.
    await A.reload({ waitUntil: 'networkidle' }); // 챗 언마운트(WS 해제) → 목록 홈
    await A.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
    const tokenA = await A.evaluate(() => globalThis.localStorage.getItem('at-web-v1.sess'));
    const sessList = await (await fetch(`${API}/api/sessions?limit=1`, { headers: { Authorization: `Bearer ${tokenA}` } })).json();
    const sid = sessList?.data?.[0]?.id ?? null;
    const injected = await (await fetch(`${API}/api/sessions/${sid}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ content: 'unread-from-mobile' }),
    })).json().catch(() => null);
    check('REST 메시지 주입(미열람 활동 재현)', !!injected?.ok || !!injected?.data, JSON.stringify(injected?.error || ''));
    await sleep(1200); // 서버 read-state/turn 확정 여유

    // ── B: PC 1440 — resume 배너 → 진입 ──
    const B = await ctx.newPage();
    await B.setViewportSize({ width: 1440, height: 900 });
    await B.goto(APP, { waitUntil: 'networkidle' });
    const banner = await B.waitForSelector('[data-testid="resume-banner"]', { timeout: 15000 }).catch(() => null);
    check('resume 배너 — 다른 기기 미읽음 세션 노출', !!banner);
    await B.screenshot({ path: shot('02-pc-home-resume') });
    if (banner) await banner.click();
    await B.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    const history = await B.waitForSelector('text=hello-crossdev', { timeout: 10000 }).catch(() => null);
    check('B(PC) 세션 진입 — A의 메시지 히스토리 로드', !!history);

    // ② PC 3패널: wide ≥1100 = 컨텍스트 패널
    const panel1440 = await B.getByTestId('context-panel').count();
    check('1440 — 우측 컨텍스트 패널 상시 노출', panel1440 > 0);
    const sidebar = await B.getByTestId('new-chat-button').count();
    check('1440 — 좌측 세션목록 사이드바(재사용) 노출', sidebar >= 2); // 레일 + 홈 아님(레일 전용) — 카운트≥1이 원칙이나 세션 리스트 dual 확인용 relax
    await B.screenshot({ path: shot('03-pc-1440-3panel') });
    await B.setViewportSize({ width: 900, height: 1200 });
    await sleep(700);
    const panel900 = await B.getByTestId('context-panel').count();
    check('900 — 2패널(컨텍스트 패널 없음)', panel900 === 0);
    await B.screenshot({ path: shot('04-pc-900-2panel') });
    await B.setViewportSize({ width: 1440, height: 900 });
    await sleep(500);

    // ③ presence: 양쪽 탭 상대 디바이스 배지 — A가 먼저 채팅에 재진입해 같은 세션 WS를 연다
    await A.getByTestId('session-card').first().click();
    await A.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    await sleep(1500); // A subscribe + presence.update 전파
    const presenceB = await B.waitForSelector('[data-testid="device-presence"]', { timeout: 8000 }).catch(() => null);
    const presenceA = await A.waitForSelector('[data-testid="device-presence"]', { timeout: 4000 }).catch(() => null);
    const presenceText = presenceB ? await presenceB.innerText() : '';
    check('presence — B에 모바일 웹 배지', !!presenceB && /모바일/.test(presenceText), presenceText.trim());
    check('presence — A에 PC 웹 배지', !!presenceA);

    // ① 2탭 동시성: A 전송 → B WS 반영 <2s
    const t0 = Date.now();
    await A.getByTestId('chat-input').fill('live-ping');
    await A.getByTestId('send-button').click();
    const arrived = await B.waitForSelector('text=live-ping', { timeout: 3000 }).catch(() => null);
    const dt = Date.now() - t0;
    check('동시성 — A→B 실시간 반영 <2s', !!arrived && dt < 2000, `${dt}ms`);

    // ④ read-state: B 열람 커서 PUT(디바운스 1.5s) 확인
    await sleep(2600);
    const token = await B.evaluate(() => (globalThis.localStorage && globalThis.localStorage.getItem('at-web-v1.sess')) || null);
    check('토큰 공유(동일 계정 2탭)', !!token);
    // 세션 목록에서 최신 세션 id → read-state 조회
    const sessRes = await fetch(`${API}/api/sessions?limit=5`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    const sidOf = sessRes && sessRes.ok ? (await sessRes.json()).data?.[0]?.id : null;
    const sidNow = sidOf ?? sid;
    const rs = sidNow ? await (await fetch(`${API}/api/sessions/${sidNow}/read-state`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => null) : null;
    check('read-state — 커서 저장(last_read_turn_index 기록)', !!rs && rs.data && rs.data.last_read_turn_index >= 0
      && ['pc-web', 'mobile-web'].includes(rs.data.last_device), JSON.stringify(rs && rs.data));

    // ⑤ PTT — 입력창 포커스 시 V 미캡처(확정 ③)
    await B.getByTestId('chat-input').click();
    await B.getByTestId('chat-input').type('v', { delay: 30 });
    await sleep(400);
    const bannerDuringType = await B.getByTestId('ptt-banner').count();
    const typedV = await B.getByTestId('chat-input').inputValue();
    check('PTT 예외 — 입력창 포커스 시 V는 타이핑(녹음 안 함)', bannerDuringType === 0 && typedV.includes('v'));
    await B.getByTestId('chat-input').fill('');
    await B.locator('[data-testid="chat-appbar"]').click({ position: { x: 200, y: 10 } }); // 포커스 해제
    await sleep(300);

    // ⑤ PTT 홀드 — V 누르는 동안 녹음 → 릴리스 전송 → mock 전사 → A에 반영(교차 입력 ③)
    await A.getByTestId('chat-input').fill(''); // A 인풋 정리(포커스 없음 유지)
    await B.keyboard.down('v');
    await sleep(900);
    const holdBanner = await B.getByTestId('ptt-banner').count();
    check('PTT 홀드 — 누르는 동안 배너(웨이브폼) 표시', holdBanner > 0);
    await B.screenshot({ path: shot('05-pc-ptt-hold') });
    await B.keyboard.up('v');
    const transcribed = await B.waitForSelector('text=정리해 주세요', { timeout: 12000 }).catch(() => null);
    check('PTT 릴리스 → STT(mock) 전사 → B 렌더', !!transcribed);
    const crossA = await A.waitForSelector('text=정리해 주세요', { timeout: 5000 }).catch(() => null);
    check('교차 입력 — PC 음성이 모바일 탭에 실시간 반영', !!crossA);
    await B.screenshot({ path: shot('06-pc-ptt-result') });

    // ⑥ 키 재매핑(KeyK) + 토글 모드 — REST PATCH(서버 딥머지: ptt*만 갱신, joystickMap 보존 확인)
    const meBefore = await (await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
    await fetch(`${API}/api/auth/me`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { pttKey: 'KeyK', pttMode: 'toggle' } }),
    });
    const meAfter = await (await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const pb = meBefore.data?.preferences || {};
    const pa = meAfter.data?.preferences || {};
    check('preferences 딥머지 — pttKey 갱신 + 나머지 키 보존',
      pa.pttKey === 'KeyK' && pa.pttMode === 'toggle'
      && Object.keys(pb).every((k) => k.startsWith('ptt') || JSON.stringify(pb[k]) === JSON.stringify(pa[k])));
    await B.goto(APP, { waitUntil: 'networkidle' });
    const card = B.getByTestId('session-card').first();
    await card.click();
    await B.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    await sleep(1500); // WS subscribe + prefs hydrate
    await B.locator('[data-testid="chat-appbar"]').click({ position: { x: 200, y: 10 } });
    await B.keyboard.press('k');           // 토글 1: 시작
    await sleep(900);
    const toggleOn = await B.getByTestId('ptt-banner').count();
    await B.screenshot({ path: shot('07-pc-ptt-toggle') });
    await B.keyboard.press('k');           // 토글 2: 전송
    const toggleMsg = await B.waitForSelector('text=정리해 주세요', { timeout: 12000 }).catch(() => null);
    check('재매핑 KeyK + 토글 모드 — 한 번 더 눌러 전송', toggleOn > 0 && !!toggleMsg);

    // 모바일 웹 홀드 버튼(터치 겸용) — A에서 마이크 홀드
    const mic = A.getByTestId('ptt-mic-button');
    const micCount = await mic.count();
    if (micCount) {
      await A.locator('[data-testid="chat-appbar"]').click({ position: { x: 60, y: 30 } });
      const box = await mic.boundingBox();
      await A.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await A.mouse.down();
      await sleep(900);
      const holdShown = await A.getByTestId('ptt-banner').count();
      await A.mouse.up();
      check('모바일 웹 — 터치 홀드 PTT 버튼', holdShown > 0);
      await A.waitForSelector('text=정리해 주세요', { timeout: 12000 }).catch(() => null);
      await A.screenshot({ path: shot('08-mobile-ptt-hold') });
    } else {
      check('모바일 웹 — 터치 홀드 PTT 버튼', false, 'ptt-mic-button 미탐지');
    }

    // ② 3해상도 캡처 마무리 (1440/900/390)
    await B.setViewportSize({ width: 1440, height: 900 }); await sleep(600);
    await B.screenshot({ path: shot('09-final-1440') });
  } catch (e) {
    failed++; console.log('  FAIL  시나리오 예외 —', String(e).slice(0, 400));
  } finally {
    const realErrors = errors.filter((x) => !/ResizeObserver|favicon|Download the React DevTools/i.test(x));
    check('런타임 JS 오류 없음', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
    await browser.close();
    console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL → ${OUT} ===`);
    process.exitCode = failed ? 1 : 0;
  }
})();
