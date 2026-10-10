/**
 * smoke_compass_t08d671a8.cjs — 5방향 나침반 조이스틱 회귀 (대표님 10/4)
 * 지시 요약:
 *   ↑ (12시): 키보드
 *   ← (9시): 취소
 *   → (3시): 수정
 *   ↓ (6시): 사진
 *   ↗ (1시): 파일
 *   센터: 전송
 *
 * t_55e92e7e (대표님 10/10) 확장 — 방향=동작 인라인 라벨:
 *   ④ 노브를 5방향 각각 진입 시 대응 라벨 textID(compass-label-<action>) 존재 + 인라인 글자,
 *      반대 방향 라벨 미존재. #mat-callout 서브트리 user-select:none 상속 실측.
 *   ⑤ 릴리스 실행 로그 유지 — 센터=audio.start→end(send), ←=audio.cancel, ↑=audio.cancel+B 개방.
 *
 * 검사:
 *   ① 홀드 시 나침반(5방향 화살표) 상단 클러스터 렌더 — rect ∩ 패드+하단 20% = 0
 *   ② 각 방향 드래그 시 해당 화살표 강조 (opacity 상승)
 *   ③ selectAction 단위 로직 — 각도→액션 매핑 경계 (gesture.test.ts 이관)
 *   ④⑤ (t_55e92e7e 라벨·실행)
 */

const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');

const APP_URL = process.env.APP_URL || 'http://localhost:8080';
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const results = [];
function check(label, pass, info = '') { results.push({ label, pass }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${info ? ' — ' + info : ''}`); }

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── 모바일 390x844 ──
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const ws = await installFixtures(page, { reader: true });
    const state = ws;
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
    await page.waitForSelector('[data-testid="voice-stage-pad"]', { timeout: 8000 });

    // ① 나침반 비가시 (idle)
    const compassIdle = await page.getByTestId('voice-compass-row').boundingBox().catch(() => null);
    check('① idle 상태 나침반 미표시', compassIdle === null);

    // 홀드 시작 — 나침반 표시 확인
    const pad = await page.getByTestId('voice-stage-pad').boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);

    const compass = await page.getByTestId('voice-compass-row').boundingBox().catch(() => null);
    check('① 홀드 중 나침반 표시', !!compass, compass ? `y=${compass.y.toFixed(0)}` : '없음');

    // 나침반이 패드+하단 20% 영역과 겹치지 않는지
    if (compass && pad) {
      const bottom20 = 844 * 0.8; // 하단 20% 시작
      const compassBottom = compass.y + compass.height;
      const padTop = pad.y;
      const noOverlap = compassBottom < Math.min(padTop, bottom20);
      check('① 나침반 rect ∩ (패드+하단20%) = 0', noOverlap, `compass.bottom=${compassBottom.toFixed(0)} padTop=${padTop.toFixed(0)} h80%=${bottom20.toFixed(0)}`);
    }

    // ② 방향 드래그 시 강조 확인 (↑ 키보드)
    const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2;
    const dragTo = async (dx, dy) => {
      await page.mouse.move(cx, cy);
      await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
      await page.waitForTimeout(120);
    };
    await dragTo(0, -40); // ↑ 40px: 거리 40 > 센터데드존 19.2 (48*0.4), 각도 0° = keyboard
    const kbdEl = page.getByTestId('compass-keyboard');
    const kbdStyle = await kbdEl.evaluate((el) => getComputedStyle(el).opacity).catch(() => '0');
    check('② ↑ 드래그 시 키보드 강조', parseFloat(kbdStyle) > 0.7, `opacity=${kbdStyle}`);

    // ④ t_55e92e7e: 5방향 진입 → 대응 라벨 존재 + 반대 라벨 미존재 + 인라인 글자 + arm 배너
    const DIRS = [
      { action: 'keyboard', dx: 0, dy: -40, text: '키보드 열기', opposite: 'cancel' },
      { action: 'file', dx: 23, dy: -33, text: '파일', opposite: 'cancel' },   // ↗ ~35° (keyboard 30° 초과, file 15~45 내)
      { action: 'edit', dx: 40, dy: 0, text: '편집', opposite: 'cancel' },
      { action: 'photo', dx: 0, dy: 40, text: '사진', opposite: 'keyboard' },
      { action: 'cancel', dx: -40, dy: 0, text: '취소', opposite: 'edit' },
    ];
    for (const d of DIRS) {
      await dragTo(d.dx, d.dy);
      const entryText = (await page.getByTestId(`compass-${d.action}`).innerText().catch(() => '')).trim();
      const armLabel = page.getByTestId(`compass-label-${d.action}`);
      const armCount = await armLabel.count();
      const armText = armCount ? (await armLabel.innerText()).trim() : '';
      const oppText = (await page.getByTestId(`compass-${d.opposite}`).innerText().catch(() => '')).trim();
      const oppArm = await page.getByTestId(`compass-label-${d.opposite}`).count();
      check(`④ ${d.action} 진입 시 인라인 라벨 '${d.text}'`, entryText.includes(d.text), JSON.stringify(entryText));
      check(`④ ${d.action} arm 배너(compass-label-${d.action}) 존재+'놓으면 실행'`, armCount === 1 && armText.includes(d.text) && armText.includes('놓으면 실행'), JSON.stringify(armText));
      check(`④ ${d.action} 진입 시 반대(${d.opposite}) 라벨 미존재`, !oppText.includes('파일') && !oppText.includes('편집') && !oppText.includes('취소') && !oppText.includes('사진') && !oppText.includes('키보드') && oppArm === 0, JSON.stringify({ oppText, oppArm }));
    }
    // ④ t_5131cb09 봉인 상속: 라벨 Text는 #mat-callout 서브트리 — user-select:none 실측
    const sealCheck = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="compass-label-cancel"]');
      if (!el) return { ok: false, why: 'no-el' };
      const cs = getComputedStyle(el);
      return { ok: cs.userSelect === 'none', why: `userSelect=${cs.userSelect}` };
    });
    check('④ arm 라벨 user-select:none 상속 (#mat-callout 봉인)', sealCheck.ok, sealCheck.why);

    // ④ 센터(deadzone) 귀환 = 라벨 소멸 (send = 기본 동작, 라벨 없음)
    await dragTo(0, 0);
    const centerArms = await page.evaluate(() => document.querySelectorAll('[data-testid^="compass-label-"]').length);
    check('④ 센터 귀환 = arm 라벨 0건 (send 라벨 없음 계약)', centerArms === 0, `count=${centerArms}`);

    // ⑤ t_55e92e7e 게이트: 릴리스 동작 실행 로그 유지 — 센터 릴리스 = audio.start→audio.end (send)
    const frameBase = state.frames.length;
    await page.mouse.up();
    await page.waitForTimeout(500);
    const typesAfter = state.frames.slice(frameBase).filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑤ 센터 릴리스 실행 로그: audio.end (send) — start 포함', typesAfter.includes('audio.end') && !typesAfter.includes('audio.cancel'), typesAfter.join(','));

    // ⑤ ← 릴리스 = cancel: audio.cancel 로그 + 라벨 소멸
    const pad2 = await page.getByTestId('voice-stage-pad').boundingBox();
    const cx2 = pad2.x + pad2.width / 2, cy2 = pad2.y + pad2.height / 2;
    await page.mouse.move(cx2, cy2);
    await page.mouse.down();
    await page.mouse.move(cx2 - 40, cy2, { steps: 4 });
    await page.waitForTimeout(150);
    const armBeforeCancel = await page.getByTestId('compass-label-cancel').count();
    const frameBase2 = state.frames.length;
    await page.mouse.up();
    await page.waitForTimeout(400);
    const typesCancel = state.frames.slice(frameBase2).filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑤ ← 진입 중 arm 배너 노출 후 릴리스 = audio.cancel 실행 로그', armBeforeCancel === 1 && typesCancel.includes('audio.cancel') && !typesCancel.includes('audio.end'), `arm=${armBeforeCancel} ${typesCancel.join(',')}`);
    const labelsGone = await page.evaluate(() => document.querySelectorAll('[data-testid^="compass-label-"]').length);
    check('⑤ 릴리스 후 라벨 소멸 (잔상 0)', labelsGone === 0, `count=${labelsGone}`);

    // ⑤ ↑ 릴리스 = keyboard: audio.cancel + B 계층(chat-input) 개방 로그
    const pad3 = await page.getByTestId('voice-stage-pad').boundingBox();
    const cx3 = pad3.x + pad3.width / 2, cy3 = pad3.y + pad3.height / 2;
    await page.mouse.move(cx3, cy3);
    await page.mouse.down();
    await page.mouse.move(cx3, cy3 - 40, { steps: 4 });
    await page.waitForTimeout(150);
    const frameBase3 = state.frames.length;
    await page.mouse.up();
    await page.getByTestId('chat-input').waitFor({ timeout: 8000 }).catch(() => {});
    const typesKbd = state.frames.slice(frameBase3).filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑤ ↑ 릴리스 실행 로그: audio.cancel + 키보드(B) 개방', typesKbd.includes('audio.cancel') && await page.getByTestId('chat-input').isVisible(), typesKbd.join(','));

    // 릴리스 정리
    await page.waitForTimeout(200);

    // ③ selectAction 단위 로직 검증 — 브라우저에서 모듈 로드 불가하므로 스킵
    // (실제 단위테스트는 별도 mocha/jest로)

    check('Z 런타임 오류 0', errs.length === 0, errs.join('; '));

    await ctx.close();

    // 결과 출력
    const pass = results.filter((r) => r.pass).length;
    const fail = results.filter((r) => !r.pass).length;
    console.log(`\n== compass t_08d671a8: ${pass} PASS / ${fail} FAIL ==`);
    process.exit(fail > 0 ? 1 : 0);
  } finally {
    await browser.close();
  }
})();
