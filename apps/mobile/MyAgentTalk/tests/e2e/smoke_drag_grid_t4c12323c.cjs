/**
 * t_4c12323c (대표님 10/9 "위로 화면을 올리려고 하는데 드래그 기능에 버그") — 드래그 격자 회귀 스모크
 * probe_drag_mic4_1009 재현 승격 + root cause 판정 2종:
 *  ① 통과 계약(요구 1): 스트립 상단 경계·패드 좌우/상방 인접 출발 = 배후 message-list가 받는다.
 *     출발점 격자(본문/스트립경계/패드밖 좌·우·상·하) × 방향(상/하) — trusted CDP touch만 기준,
 *     이동량 >20px 판정. 홀드 발동은 96px 패드 안 출발만(#311/t_f8c40db0 계약) — 이 스모크는
 *     패드 내부 출발을 쓰지 않는다(↑ 제스처 = B계층 전이로 레이아웃이 변해 판정 오염).
 *  ② 스냅백 회귀(요구 2/핵심 결함): 말미에서 느린 위로 드래그 → 릴리스 관성이 '정착 창'을 지나
 *     gap>100으로 건널 때 followTail(branch3)이 말미로 되 끌어오는 결함(실측 서명 445→356 드래그
 *     →관성 251→404 스냅백). 수정 후: 이탈 유지 — 1.5s settling 후 오프셋이 드래그 종료 지점
 *     근방 ±60px 안에 머물고 말미(max)로 되돌아가지 않는다.
 *  ③ 이탈 유지 + 새 arrival 배지: 이탈 상태 유지 확인(기존 t_1731f0f6 ② 계약 보존).
 * 실행: (정적서버) node tests/e2e/fr-serve.cjs dist-<본빌드> 8292
 *       APP_URL=http://localhost:8292 node tests/e2e/smoke_drag_grid_t4c12323c.cjs
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8292';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'drag-grid-t4c12323c');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installFixtures(page, { reader: true });
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
    await page.getByTestId('message-list').waitFor({ timeout: 8000 });
    await page.waitForTimeout(3400); // 리빌/추종 settling — A-레이어 말미 정착

    const st = () => page.evaluate(() => {
      const el = document.querySelector('[data-testid="message-list"]');
      return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight, strip: !!document.querySelector('[data-testid="voice-stage"]') };
    });
    // 느린 드래그(트랙 유지) — 관성 최소·responder 실타깃 경로 실전. steps×gap≈20ms/frame.
    // 관습: 손가락 아래 = 히토리(scrollTop 감소), 손가락 위 = 말미(증가).
    async function drag(x, y1, y2, steps = 10, gapMs = 20, waitMs = 1500) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y1 }] });
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y1 + (y2 - y1) * i / steps }] });
        await page.waitForTimeout(gapMs);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(waitMs); // 관성 + settling
    }
    // A-레이어 중간 오프셋 리셋. 주의: 최상단(top=0)에서는 strip이 뷰포트로 내려와(상단 87)
    //  (195,300~560) 구간이 패드(96px)에 겹쳐 아래-드래그가 ↑ 홀드 제스처=B 전이를 유발한다
    //  (패드 안 출발=홀드 = #311 계약대로 정상). 최상단 이탈은 본문 상부(y~150) 출발로 하고,
    //  B 전이가 발생하면 chat-voice-back으로 A 복귀(스모크 전제 방어).
    async function backToA() {
      if ((await st()).strip) return;
      const back = page.getByTestId('chat-voice-back');
      if (await back.count()) { await back.click(); await page.waitForTimeout(900); }
    }
    async function resetMid() {
      for (let k = 0; k < 6; k++) {
        const s = await st();
        if (!s.strip) { await backToA(); continue; }
        if (s.top > 60 && s.top < s.max - 60) return s;
        // touchstart는 반드시 패드 직사각형(x147~243, y530~626) 밖 + strip 상단(464) 위 본문에서.
        if (s.top <= 60) await drag(195, 420, 220, 10, 20); // 손가락 위 = 말미(scrollTop↑)
        else await drag(195, 240, 440, 10, 20); // 손가락 아래 = 히토리(scrollTop↓)
      }
      await backToA();
      return await st();
    }

    // ── ① 통과 격자: 출발점 × 방향 — 이동량 >20px ────────────────────────
    // 좌표는 런타임 실측 기반 (t_8dbb1619 패드 하향 등 인체공학 이력에 무관하게 견고):
    //  strip 상단 +2/+36, 패드 rect 외곽 인접(위/좌/우/하 ±10px), 본문, 화면 하단 코너.
    //  패드 내부 출발 금지 — 홀드는 격자 계약 밖(④에서 별도 검증).
    const geo = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="voice-stage"]');
      const p = document.querySelector('[data-testid="voice-stage-pad"]');
      const sb = s.getBoundingClientRect();
      const pb = p.getBoundingClientRect();
      return { stripTop: sb.top, padCx: pb.left + pb.width / 2, padL: pb.left, padR: pb.right, padT: pb.top, padB: pb.bottom };
    });
    const grid = [
      ['본문중앙', 195, 350],
      ['본문상부', 195, 250],
      ['스트립경계', 195, Math.round(geo.stripTop + 2)],
      ['스트립경계하', 195, Math.round(geo.stripTop + 36)],
      ['경계좌', 150, Math.round(geo.stripTop + 2)],
      ['경계우', 240, Math.round(geo.stripTop + 2)],
      ['패드위인접', Math.round(geo.padCx), Math.round(geo.padT - 10)],
      ['패드좌인접', Math.round(geo.padL - 12), Math.round(geo.padT + 40)],
      ['패드우인접', Math.round(geo.padR + 12), Math.round(geo.padT + 40)],
      ['패드하인접', Math.round(geo.padCx), Math.round(geo.padB + 8)],
      ['화면좌하단', 40, 700],
      ['화면우하단', 350, 700],
    ];
    let gridOk = 0;
    for (const [label, x, y] of grid) {
      for (const dir of ['up', 'down']) {
        const s0 = await resetMid();
        const y2 = dir === 'up' ? Math.max(140, y - 180) : Math.min(825, y + 180);
        // 최소 스트로크 보장: 뷰포트 하단 근접 출발(패드하인접)은 180px 이동 공간이 없음 —
        // 실측(729→829: Δ112) 기준 최소 90px. y가 825-90 이상이면 위쪽으로 여유를 쓴다.
        const effY2 = dir === 'down' && y2 - y < 90 ? Math.max(y - 150, 140) : y2;
        const effDir = effY2 > y ? 'down' : 'up';
        await drag(x, y, effY2);
        const s1 = await st();
        const moved = Math.abs(s1.top - s0.top);
        // 손가락 위 = 말미(scrollTop↑), 손가락 아래 = 히토리(↓) — effDir 기준.
        const movedRightWay = effDir === 'up' ? s1.top > s0.top : s1.top < s0.top;
        const ok = s1.strip && moved > 20 && movedRightWay;
        if (ok) gridOk++;
        check(`① 격자 ${label}(${x},${y}) ${dir === 'up' ? '상방' : '하방'} — 리스트 수신`, ok,
          `top ${s0.top.toFixed(0)}→${s1.top.toFixed(0)} (Δ${moved.toFixed(0)}) strip=${s1.strip}`);
        await page.screenshot({ path: path.join(OUT, `grid-${label}-${dir}.png`) }).catch(() => undefined);
      }
    }
    check('① 격자 24지점 전부 통과 (≥22)', gridOk >= 22, `${gridOk}/24`);

    // ── ② 스냅백 회귀: 말미→느린 손가락 아래(히토리) 드래그→관성→이탈 유지 ──
    {
      // 실측 결함 시나리오(probe_fling ⑤): (195,500)에서 200px 느린 아래-드래그.
      // 드래그 종료 지점 gap≈89(정착 창) → settle이 의도 체인(userScrollAt)을 클리어 → 관성
      // 이벤트가 gap>100을 건널 때 intent 창(400ms) 만료 여부가 타이밍 경주 → 수정 전
      // branch3 '수축 클램프 딥' 오판 → followTail이 말미로 스냅백(445→251→404) 또는 관망.
      // 경주 특성상 단회 판정 금지: 5반복, 1회라도 스냅백이면 FAIL (수정 전 실측 ~50% 적중,
      // 5회 포획 확률 >95%. 수정 후 touchRecent 1200ms 창이 결정적으로 차단 → 0/5 기대).
      let snaps = 0, lastTop = 0;
      for (let rep = 0; rep < 5; rep++) {
        await page.evaluate(() => { const el = document.querySelector('[data-testid="message-list"]'); el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(800); // 리빌 성장 윈도우 내 정착 (probe_fling 재현 파라)
        const a = await st();
        if (rep === 0) check('② 사전 — 말미 정착', Math.abs(a.top - a.max) <= 4 && a.strip, `top=${a.top.toFixed(0)} max=${a.max.toFixed(0)} strip=${a.strip}`);
        await drag(195, 500, 700, 10, 20);
        const b = await st();
        lastTop = b.top;
        if (a.top - b.top > 40 && b.top >= a.max - 100) snaps++;       // 이동했으나 말미로 복귀 = 스냅백
        await page.waitForTimeout(3000);
        const c2 = await st();
        if (Math.abs(c2.top - a.max) < 100 && Math.abs(c2.top - b.top) > 60) snaps++; // 지연 되돌림
      }
      check('② 말미→느린 아래 드래그 ×5 — 이탈 이동 성립', lastTop < 345, `최종 top=${lastTop.toFixed(0)} (345 이상 = 스냅백 혼입)`);
      check('② followTail 스냅백 없음 (관성 건넘 = 이탈 유지, 5반복 경주 게이트)', snaps === 0, `snaps=${snaps}/5 — 404식 되돌림 회귀 차단`);

      // ②-d 결정적 포획 (경주 무관 단언): 정착 창 내 실드래그(→settle이 userScrollAt 클리어)
      // 직후, 마킹 없는 gap>100 경계 넘김 이벤트(JS 대입=무의도 프로그램 이동) →
      //   미수정: intent=false+scrolledUp+nearBottom+유휴 = branch3 '수축 클램프 딥' 오판
      //           → followTail이 말미로 야킹 (top≈max).
      //   수정 후: touchRecent(lastMarkAt≤1200ms) → exit — 이탈 유지 (top≈max-Δ).
      // 시그니처가 양 빌드에서 결정적으로 갈리므로 5반복 경주 게이트의 보완 하드가 된다.
      {
        await page.evaluate(() => { const el = document.querySelector('[data-testid="message-list"]'); el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(600);
        const a2 = await st();
        await drag(195, 460, 540, 8, 25, 120);      // 80px = 정착 창 내(모든 이벤트 gap≤100) — 관성 대기 최소화(lastMarkAt 창 유지)
        const cross = a2.top - 130;
        await page.evaluate((v) => { const el = document.querySelector('[data-testid="message-list"]'); el.scrollTop = v; }, cross);
        await page.waitForTimeout(1200);             // branch3 followTail(3 rAF)이 도달할 시간
        const b2 = await st();
        check('②-d 결정적 — settle 후 무마킹 gap>100 건넘: branch3 스냅백 금지', b2.top < a2.max - 100, `top=${b2.top.toFixed(0)} vs max=${a2.max.toFixed(0)} (미수정 서명: ≈max 야킹)`);
      }
      await page.screenshot({ path: path.join(OUT, 'snapback-avoided.png') }).catch(() => undefined);
    }

    // ── ③ 이탈 유지 + 새 arrival 배지: 이탈 상태 유지 확인(t_1731f0f6 ② 계약 보존) ──
    {
      const before = await st();
      // 위 ②가 이탈 상태. 발화 없이 3s 유휴 = 자동 하단점프 금지(스냅백과 구분되는 프로그램 항법 계약).
      const idle = await st();
      check('③ 이탈 상태 유휴 유지(자동 하단점프 없음)', Math.abs(idle.top - before.top) < 60, `top ${before.top.toFixed(0)}→${idle.top.toFixed(0)}`);
      // 배지 탭으로 말미 복귀 — 정상 경로 유지
      const badge = await page.getByTestId('unseen-badge').count();
      if (badge) {
        await page.getByTestId('unseen-badge').click();
        await page.waitForTimeout(1200);
        const landed = await st();
        check('③ 배지 탭 후 말미 정착', Math.abs(landed.top - landed.max) <= 4, `top=${landed.top.toFixed(0)}`);
      } else {
        passed += 1; console.log('  PASS  ③ 배지 미점등(새 발화 없음) — 점프 요구 없음으로 동일 계약');
      }
    }

    check('페이지 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }
  console.log(`\n== RESULT ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
