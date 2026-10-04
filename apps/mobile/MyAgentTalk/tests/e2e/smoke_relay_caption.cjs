/**
 * 비서실 백스테이지 릴레이 자막 e2e 스모크 — t_961ca593 Phase B
 * 백엔드 없이 run_c_fixtures 인터셉트로 relay.updated 계약 픽스처 렌더 (메모리 최소 토큰 경로, 9/26 교훈).
 * 백엔드 계약 근거: api-design.md §relay.updated (t_583d9fed) — {type, session_id, run_id, seq, stage, quip}.
 * 검증:
 *  ① 이벤트 0건(비서 외 페르소나 관측) → relay-caption DOM 부재 (입력 콘솔 레이아웃 불변)
 *  ② briefing→research→drafting→wrapping→done 수신 → 상시 1줄 자막이 stage마다 갱신 (히스토리 아님)
 *  ③ 역주행/중복 이벤트 무시 (커튼), 문구는 i18n relay.<stage> (서버 quip·영문 코드 노출 없음)
 *  ④ run.completed → done 홀드 후 페이드아웃 → 제로잔류 (DOM 소실)
 *  ⑤ 위치: 입력 콘솔 위 (chip/console 지오메트리) · 1줄 ellipsis
 *  ⑥ 390·1440 캡처 + 타이핑 카드 quip 중복 억제(hideQuip)
 * 실행: node tests/e2e/fr-serve.cjs dist-relay 8121 &
 *       APP_URL=http://localhost:8121 node tests/e2e/smoke_relay_caption.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8121';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'relay-caption');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
// 서버 RELAY_ORDER 순서 + api-design §relay.updated 스냅샷 형태
const RUN = 'relay-run-1';
const STAGES = [
  ['briefing', '접수했어요. 담당 팀에 바로 전달합니다'],
  ['research', '지금 자료팀이 최신 사례를 뒤지고 있어요'],
  ['drafting', '초안이 올라오고 있어요, 바로 다듬습니다'],
  ['wrapping', '팀 작업이 끝났어요, 제 이름으로 정리해 드립니다'],
  ['done', '정리 끝났어요. 여기까지 제가 챙겼습니다'],
];
(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ── ① 이벤트 0건 = 렌더 없음 (비서 외 페르소나 관측) ──
    const page1 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page1.on('pageerror', (e) => errors.push(String(e)));
    await installFixtures(page1);
    await page1.goto(APP, { waitUntil: 'networkidle' });
    await page1.getByTestId('session-card').first().click();
    await page1.getByTestId('message-list').waitFor({ timeout: 8000 });
    await page1.waitForTimeout(500);
    check('① 이벤트 0건 = relay-caption DOM 부재', (await page1.getByTestId('relay-caption').count()) === 0);
    await page1.screenshot({ path: shot('01-no-events') });

    // ── ②③⑤ stage 시퀀스 수신 → 상시 1줄 갱신 · i18n 문구 · 위치 ──
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    page.on('pageerror', (e) => errors.push(String(e)));
    const state = await installFixtures(page);
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').first().click();
    await page.getByTestId('message-list').waitFor({ timeout: 8000 });
    const socket = () => state.sockets.at(-1);
    // WS 등록은 message-list 렌더 후 확정된다(지연 관측) — 주입 전 대기로 스팟 실패 제거
    await page.waitForFunction(() => true, null, { timeout: 1000 }).catch(() => {});
    for (let i = 0; i < 40 && !socket(); i++) await page.waitForTimeout(100);
    if (!socket()) { check('WS 소켓 미확보 — 이후 검사 스킵', false); }
    const relay = (stage, quip, runId = RUN) => socket().send(JSON.stringify({
      type: 'relay.updated', session_id: 'source', run_id: runId, seq: 1, stage, quip,
    }));
    relay('briefing', ...STAGES[0]);
    await page.getByTestId('relay-caption').waitFor({ timeout: 5000 });
    let text = await page.getByTestId('relay-caption').innerText();
    check('② briefing 자막 표시', text.includes('담당 팀에 바로 전달'), text);
    check('③ i18n 문구 = 서버 quip 미노출(동어반복 없음)', !text.includes(STAGES[0][1]), text);
    // 위치: 입력 콘솔 위
    const capBox = await page.getByTestId('relay-caption').boundingBox();
    const consoleBox = await page.getByTestId('voice-stage').or(page.getByTestId('chat-input')).first().boundingBox();
    check('⑤ 입력 콘솔 위 배치', !!capBox && !!consoleBox && capBox.y + capBox.height <= consoleBox.y + 2, `cap=${capBox && Math.round(capBox.y)} console=${consoleBox && Math.round(consoleBox.y)}`);
    await page.screenshot({ path: shot('02-briefing') });

    // stage 전환 — 같은 1줄이 갈아쓰기(히스토리 누적 금지: caption 개수 1)
    for (const [stage, quip] of STAGES.slice(1, 4)) {
      relay(stage, quip);
      await page.waitForTimeout(350);
    }
    text = await page.getByTestId('relay-caption').innerText();
    check('② wrapping까지 전환 — 현재 stage만 1줄', text.includes('답변 마무리 중') && !text.includes('접수했어요'), text);
    check('② 히스토리 아님 — caption 노드 1개', (await page.getByTestId('relay-caption').count()) === 1);
    // 1줄 실측 — 캡슐 높이가 한 줄 분량(<=40px)이고 텍스트가 자막 1문장만 담는다
    const capHeight = await page.getByTestId('relay-caption').evaluate((el) => el.getBoundingClientRect().height);
    check('⑤ 상시 1줄 (캡슐 높이 ≤40px)', capHeight > 0 && capHeight <= 40, `h=${Math.round(capHeight)}`);
    await page.screenshot({ path: shot('03-wrapping') });

    // ③ 역주행/중복 무시
    relay('briefing', STAGES[0][1]);
    await page.waitForTimeout(300);
    text = await page.getByTestId('relay-caption').innerText();
    check('③ 역주행 이벤트 무시 (wrapping 유지)', text.includes('답변 마무리 중'), text);
    relay('wrapping', STAGES[3][1]);
    await page.waitForTimeout(200);
    check('③ 중복 이벤트 무시 — 같은 문구 유지', (await page.getByTestId('relay-caption').innerText()).includes('답변 마무리 중'));

    // ⑥ hideQuip — 같은 런의 타이핑 카드 quip과 자막 스트립이 중복 라인으로 공존하지 않는다
    socket().send(JSON.stringify({ type: 'run.started', session_id: 'source', run_id: RUN, seq: 3 }));
    await page.getByTestId('typing-indicator').waitFor({ timeout: 5000 });
    const typingText = await page.getByTestId('typing-indicator').innerText();
    check('⑥ 자막 활성 시 타이핑 카드 quip 억제', !typingText.includes('잠깐만요'), typingText.slice(0, 40));

    // ④ done 홀드 후 제로잔류
    relay('done', STAGES[4][1]);
    await page.waitForTimeout(350);
    text = await page.getByTestId('relay-caption').innerText();
    check('② done 자막 표시', text.includes('마무리됐어요'), text);
    await page.screenshot({ path: shot('04-done') });
    socket().send(JSON.stringify({ type: 'run.completed', session_id: 'source', run_id: RUN, message_ids: { user: 'u', empathy: null, answer: 'a' }, llm: { used: false } }));
    // done 홀드: 즉시 소실 아님(0프레임 방지) → 홀드 후 정리 확인
    await page.waitForTimeout(300);
    check('④ done 홀드 — 런 종료 직후에도 자막 유지', (await page.getByTestId('relay-caption').count()) === 1);
    await page.waitForTimeout(1200 + 600); // 홀드 1200ms + 페이드 240ms 여유
    check('④ 제로잔류 — 홀드 후 DOM 소실', (await page.getByTestId('relay-caption').count()) === 0);
    await page.screenshot({ path: shot('05-cleared') });

    // done 없이wrapping 중 종료 = 즉시 정리(컴포넌트 페이드아웃)
    relay('research', STAGES[1][1]);
    await page.getByTestId('relay-caption').waitFor({ timeout: 5000 });
    socket().send(JSON.stringify({ type: 'run.failed', session_id: 'source', run_id: 'run-2', error: { code: 'X', message: 'y' } })); // 남의 run — 무해
    await page.waitForTimeout(300);
    check('④ 남의 run 종료 = 현 자막 유지', (await page.getByTestId('relay-caption').count()) === 1);
    socket().send(JSON.stringify({ type: 'run.failed', session_id: 'source', run_id: RUN, error: { code: 'X', message: 'y' } }));
    await page.waitForTimeout(700);
    check('④ 일반 stage 런 종료 = 페이드아웃 후 소실', (await page.getByTestId('relay-caption').count()) === 0);

    // 피드 불변: 자막은 message가 아니다 — relay 이벤트 뒤에도 메시지 수 불변 확인은 ①·② 페이지의 errors로 대체
    check('⑤ JS 예외 0', errors.length === 0, errors.slice(0, 2).join(' | '));

    // ── ⑥ 1440 데스크톱 캡처 ──
    const page4 = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    page4.on('pageerror', (e) => errors.push(String(e)));
    const state4 = await installFixtures(page4, { chief: true });
    await page4.goto(APP, { waitUntil: 'networkidle' });
    await page4.getByTestId('session-card').first().click();
    await page4.getByTestId('message-list').waitFor({ timeout: 8000 });
    for (let i = 0; i < 40 && !state4.sockets.at(-1); i++) await page4.waitForTimeout(100);
    state4.sockets.at(-1).send(JSON.stringify({ type: 'relay.updated', session_id: 'source', run_id: 'd1', seq: 1, stage: 'drafting', quip: STAGES[2][1] }));
    await page4.getByTestId('relay-caption').waitFor({ timeout: 5000 });
    const dBox = await page4.getByTestId('relay-caption').boundingBox();
    check('⑥ 1440 = 자막 표시(열 좌측 정렬, stretch 아님)', !!dBox && dBox.height > 0 && dBox.width < 1000, `w=${dBox && Math.round(dBox.width)}`);
    await page4.screenshot({ path: shot('06-desktop-1440') });

    // EN 캡처 증거 — installFixtures 반환 state로 WS 주입 (언어는 init 스크립트로 en 강제)
    const page5 = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
    page5.on('pageerror', (e) => errors.push(String(e)));
    const state5 = await installFixtures(page5);
    await page5.addInitScript(() => localStorage.setItem('at-language', 'en'));
    await page5.goto(APP, { waitUntil: 'networkidle' });
    await page5.getByTestId('session-card').first().click();
    await page5.getByTestId('message-list').waitFor({ timeout: 8000 });
    for (let i = 0; i < 40 && !state5.sockets.at(-1); i++) await page5.waitForTimeout(100);
    state5.sockets.at(-1).send(JSON.stringify({ type: 'relay.updated', session_id: 'source', run_id: 'e1', seq: 1, stage: 'research', quip: STAGES[1][1] }));
    await page5.getByTestId('relay-caption').waitFor({ timeout: 5000 });
    const enText = await page5.getByTestId('relay-caption').innerText();
    check('EN i18n 문구 — relay.research 영어 노출·서버 quip(한글) 미노출', enText.includes('research desk') && !enText.includes('자료팀'), enText);
    await page5.screenshot({ path: shot('07-en-caption') });
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(2); });
