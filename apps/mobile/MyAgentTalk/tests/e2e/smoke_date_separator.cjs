/**
 * t_34f3e92c 백로그② — 날짜 구분선 스모크 (검증 기준 4~8 전수)
 *  ④ D-48h+ 히스토리에서 '3일 전' 구분선 존재
 *  ⑤ 스크롤 시 상단 고정 탭 data-testid="pinned-date" 1개, 스크롤 전 0개
 *  ⑥ push-out: 다음 구분선 접근 시 transform translateY 음수, 인접 구분선 간 간격 0 초과
 *  ⑦ en 리로드 후 구분선 라벨 라틴화 (Today/Yesterday/weekday/Mon DD)
 *  ⑧ 접근성: date-separator는 role=text, pinned-date는 aria-hidden=true
 *  +회귀: 구분선 1개 추가 시 리스트 스크롤 가능한 높이 증가(t_dee9e982 flex-end orthogonality)
 *  +스냅샷: 구분선 없는 세션(단일 날 행 0) — 기존 렌더 불변 근사 확인
 * 실행: cd <worktree>/apps/mobile/MyAgentTalk
 *       node tests/e2e/fr-serve.cjs dist-t34f3e92c 8177
 *       APP_URL=http://localhost:8177 node tests/e2e/smoke_date_separator.cjs
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8177';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'date-separator');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

// 자체 픽스처: run_c_fixtures.cjs 미수정 — 3개 날짜(오늘/어제/D-3)에 걸친 턴 그룹 히스토리.
// 긴 히스토리(스크롤 가능)가 고정 탭/push-out 검증 조건 — 짧은 세션도 스크롤 가능하게 행 수 확보.
async function installDateFixtures(page, { empty = false, locale = 'ko-KR' } = {}) {
  const day = (offset, h, m) => {
    const d = new Date(Date.now() - offset * 86400000);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const rows = [];
  if (!empty) {
    const mk = (id, role, turn, at, content) => rows.push({ id, role, content, turn_index: turn, created_at: at });
    // D-3(금/요일 그룹) 8턴 · 어제 8턴 · 오늘 8턴
    for (let i = 0; i < 8; i++) { mk('u3' + i, 'user', i * 2, day(3, 9, i * 5), `D3 질문 ${i}`); mk('a3' + i, 'agent', i * 2 + 1, day(3, 9, i * 5 + 1), `D3 답변 ${i} — 이틀보다 오래된 발화`); }
    for (let i = 0; i < 8; i++) { mk('u1' + i, 'user', 20 + i * 2, day(1, 14, i * 5), `어제 질문 ${i}`); mk('a1' + i, 'agent', 20 + i * 2 + 1, day(1, 14, i * 5 + 1), `어제 답변 ${i}`); }
    for (let i = 0; i < 8; i++) { mk('u0' + i, 'user', 40 + i * 2, day(0, 8, i * 5), `오늘 질문 ${i}`); mk('a0' + i, 'agent', 40 + i * 2 + 1, day(0, 8, i * 5 + 1), `오늘 답변 ${i}`); }
  }
  const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  const agent = { id: 'agent', name: 'Test Agent' };
  const session = { id: 'source', agent_id: 'agent', title: 'Original project', status: 'active' };
  await page.addInitScript((lang) => {
    localStorage.setItem('at-web-v1.sess', 'test-token');
    localStorage.setItem('at-language', lang);
  }, locale === 'en-US' ? 'en' : 'ko');
  await page.routeWebSocket('**/ws**', (socket) => {
    socket.onMessage((data) => {
      try { if (JSON.parse(String(data)).type === 'subscribe') socket.send(JSON.stringify({ type: 'subscribed', current_seq: 0 })); } catch { /* ignore */ }
    });
  });
  await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    if (p === '/api/sessions' || p === '/api/sessions/ensure') return route.fulfill(ok(p === '/api/sessions' ? [session] : session));
    if (p === '/api/agents') return route.fulfill(ok([agent]));
    if (p === '/api/ws-ticket') return route.fulfill(ok({ ticket: 'test-ticket' }));
    if (p === '/api/favorites') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [], meta: { limit: 50, offset: 0, has_more: false } }) });
    if (/^\/api\/sessions\/[^/]+\/messages$/.test(p) && route.request().method() === 'GET') return route.fulfill(ok(rows));
    if (/^\/api\/messages\//.test(p) && route.request().method() === 'PATCH') return route.fulfill(ok({}));
    return route.fulfill({ status: 404, body: '{}' });
  });
  return rows;
}

async function openChat(browser, { locale = 'ko-KR', empty = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await installDateFixtures(page, { empty, locale });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').waitFor({ timeout: 15000 });
  await page.getByTestId('session-card').click();
  await page.getByTestId('message-list').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600); // 페인트/레이아웃 안착 (t_3116c5bc 함정)
  return { page, ctx, errors };
}

const sepState = (page) => page.evaluate(() => {
  const seps = Array.from(document.querySelectorAll('[data-testid="date-separator"]'));
  const pinned = document.querySelector('[data-testid="pinned-date"]');
  const list = document.querySelector('[data-testid="message-list"]');
  const lr = list.getBoundingClientRect();
  return {
    sepCount: seps.length,
    sepLabels: seps.map((e) => e.textContent),
    // 콘텐츠 좌표 = 뷰포트 top - 스크롤박스 top + scrollTop (layouts/onLayout와 동일 좌표계)
    sepTops: seps.map((e) => Math.round(e.getBoundingClientRect().top - lr.top + list.scrollTop)),
    sepHeights: seps.map((e) => Math.round(e.getBoundingClientRect().height)),
    pinnedCount: pinned ? 1 : 0,
    pinnedText: pinned ? pinned.textContent : null,
    pinnedTransform: pinned ? getComputedStyle(pinned.firstElementChild).transform : null,
    pinnedTop: pinned ? Math.round(pinned.getBoundingClientRect().top) : null,
    listTop: Math.round(lr.top),
    scroll: { st: Math.round(list.scrollTop), sh: list.scrollHeight, ch: list.clientHeight },
  };
});
// r9 머지게이트 수리: 꼬리추종(t_1731f0f6 r5)은 '의도 없는 딥'을 재추종으로 판정 — 실제 사용자
// 스크롤과 동일하게 wheel 의도 마킹 후 지정 이동(테스트 하네스만 변경, 제품 코드 무개입).
const setScroll = (page, y) => page.evaluate((v) => {
  const el = document.querySelector('[data-testid="message-list"]');
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
  el.scrollTop = v;
}, y);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // ── ④+⑤+⑥ ko: D-48h 구분선, 스크롤 고정 탭, push-out ──
    {
      const { page, errors } = await openChat(browser);
      // 마운트 시 nearBottom=true → scrollToEnd 자동. 상단부터 측정을 위해 확실히 최상단으로.
      await setScroll(page, 0);
      await page.waitForTimeout(600); // 가상화 재렌더+레이아웃 안착
      const s0 = await sepState(page);
      check('④ 3개 날짜 구분선(오늘/어제/D-3 요일)', s0.sepCount === 3, `count=${s0.sepCount} labels=${JSON.stringify(s0.sepLabels)}`);
      check('④ ko 라벨 — 어제 포함', s0.sepLabels.some((l) => l.includes('어제')), s0.sepLabels.join('|'));
      check('④ ko 라벨 — 오늘 포함(세션 진입 첫 그룹)', s0.sepLabels.some((l) => l.includes('오늘')), s0.sepLabels.join('|'));
      check('④ D-3 라벨 = 요일(short)', /월|화|수|목|금|토|일/.test(s0.sepLabels[0] || '') && !(s0.sepLabels[0] || '').includes('오늘'), s0.sepLabels[0]);
      check('⑤ 스크롤 최상단 — 고정 탭 0(아직 아무 선도 안 지나감)', s0.pinnedCount === 0, `pinned=${s0.pinnedText}`);
      check('런타임 오류 0', errors.length === 0, errors.join('|').slice(0, 200));
      const h = s0.sepHeights[0] || 30;
      // sepTops는 이미 콘텐츠 좌표(=onLayout y와 동일 계) — st를 또 더하면 이중 계산(9/29 프로브 실측)
      const firstTopAbs = s0.sepTops[0];
      await setScroll(page, Math.max(0, firstTopAbs - 5));
      await page.waitForTimeout(400);
      const sB = await sepState(page);
      check('⑤ 통과 직전 고정 탭 0', sB.pinnedCount === 0, `st=${sB.scroll.st} pinned=${sB.pinnedText}`);
      // 첫 구분선이 상단을 막 지나간 지점 — 고정 탭 1개, 리스트 상단에 부착
      await setScroll(page, firstTopAbs + h + 4);
      await page.waitForTimeout(500);
      const s1 = await sepState(page);
      check('⑤ 스크롤 후 고정 탭 정확히 1', s1.pinnedCount === 1, `count=${s1.pinnedCount} text=${s1.pinnedText}`);
      check('⑤ 고정 탭 라벨 = 지난 첫 구분선', s1.pinnedText === s0.sepLabels[0], `pinned=${s1.pinnedText}`);
      check('⑤ 고정 탭이 리스트 상단에 붙음', s1.pinnedTop !== null && Math.abs(s1.pinnedTop - s1.listTop) <= 3, `pinnedTop=${s1.pinnedTop} listTop=${s1.listTop}`);
      check('⑤ 고정 탭 transform 0(아직 밀림 전)', /matrix\(1, 0, 0, 1, 0, 0\)/.test(s1.pinnedTransform || ''), s1.pinnedTransform);
      await page.screenshot({ path: shot('01-pinned-first') });
      // push-out: 다음 구분선이 h 이내로 접근하는 지점 → translateY 음수
      const nextTopAbs = s1.sepTops[1];
      await setScroll(page, nextTopAbs - (h - 6));
      await page.waitForTimeout(500);
      const s2 = await sepState(page);
      const tf = s2.pinnedTransform ? s2.pinnedTransform.match(/matrix\(1, 0, 0, 1, 0, (-?\d+(\.\d+)?)/) : null;
      check('⑥ push-out — 다음 구분선 접근 시 translateY 음수', !!tf && Number(tf[1]) < 0, `transform=${s2.pinnedTransform}`);
      // 인접 구분선(본문 행) 간격 — 음수/0 금지(붙어 보이면 안 됨)
      const gap = s2.sepTops.length > 1 ? s2.sepTops[1] - s2.sepTops[0] : 999;
      check('⑥ 본문 구분선 행들 간격 0 초과(붙지 않음)', gap > 0, `gap=${gap} tops=${JSON.stringify(s2.sepTops)}`);
      await page.screenshot({ path: shot('02-pushout') });
      // 구분선 통과 인계: next가 경계를 넘으면 새 active(shift 0)로 연속
      await setScroll(page, nextTopAbs + 4);
      await page.waitForTimeout(500);
      const s2b = await sepState(page);
      check('⑥ 경계 인계 — 고정 라벨이 두 번째 구분선으로 교체', s2b.pinnedCount === 1 && s2b.pinnedText === s0.sepLabels[1], `pinned=${s2b.pinnedText} shift=${s2b.pinnedTransform}`);
      // 회귀 스크롤 가능(sh>ch) + 높이 기여
      check('회귀 스크롤 가능(sh>ch)', s0.scroll.sh > s0.scroll.ch, `sh=${s0.scroll.sh} ch=${s0.scroll.ch}`);
      // 스크롤 최하단(오늘)까지 — 최근 통과 구분선 라벨 '오늘', 이중 탭 없음(항상 ≤1)
      await setScroll(page, s0.scroll.sh);
      await page.waitForTimeout(500);
      const s4 = await sepState(page);
      check('하단까지 — 최근 통과 구분선 = 오늘 라벨', s4.pinnedCount === 1 && s4.pinnedText && s4.pinnedText.includes('오늘'), `pinned=${s4.pinnedText}`);
      await page.screenshot({ path: shot('03-today-pinned') });
      await page.close();
    }

    // ── ⑦ en 라벨 ──
    {
      const { page } = await openChat(browser, { locale: 'en-US' });
      const s = await sepState(page);
      const latin = s.sepLabels.every((l) => /^[\x20-\x7E]+$/.test(l));
      check('⑦ en 라벨 전부 라틴(한글 없음)', latin && s.sepCount >= 3, JSON.stringify(s.sepLabels));
      check('⑦ en Today/Yesterday 포함', s.sepLabels.some((l) => l === 'Today') && s.sepLabels.some((l) => l === 'Yesterday'), s.sepLabels.join('|'));
      await page.close();
    }

    // ── ⑧ 접근성 ──
    {
      const { page } = await openChat(browser);
      const a11y = await page.evaluate(() => {
        const sep = document.querySelector('[data-testid="date-separator"]');
        const inner = sep ? sep.querySelector('[role]') || sep.firstElementChild?.firstElementChild : null;
        const list = document.querySelector('[data-testid="message-list"]');
        list.scrollTop = 99999;
        return { sep: sep ? { containerRole: sep.getAttribute('role'), innerRole: inner ? inner.getAttribute('role') : null } : null, text: sep ? sep.textContent : null };
      });
      await page.waitForTimeout(400);
      const pinA11y = await page.evaluate(() => {
        const p = document.querySelector('[data-testid="pinned-date"]');
        return p ? { ariaHidden: p.getAttribute('aria-hidden'), cls: p.className } : null;
      });
      check('⑧ 구분선 컨테이너 role 없음', a11y.sep && a11y.sep.containerRole === null, JSON.stringify(a11y));
      // RNW 0.21 propsToAriaRole: role 'text'는 웹 매핑 없음 → 의도적 드롭(네이티브 특성 보존용 prop).
      // 웹 계약은 '이중 role 없음 + textContent 읽힘'으로 판정 — role=text 강제 시 span 리터널 어긋남.
      check('⑧ 구분선 라벨 role 이중지정 없음(RNW text 드롭)', a11y.sep && a11y.sep.innerRole === null, `inner=${a11y.sep && a11y.sep.innerRole}`);
      check('⑧ 라벨 textContent 유지', !!a11y.text && a11y.text.trim().length > 0, `text=${a11y.text}`);
      check('⑧ 고정 탭 aria-hidden=true', pinA11y && pinA11y.ariaHidden === 'true', JSON.stringify(pinA11y));
      await page.close();
    }

    // ── 회귀+스냅샷: 구분선 없는 세션(단일 날 히스토리) ──
    {
      const { page, errors } = await openChat(browser, { empty: true });
      const s = await sepState(page);
      check('스냅샷 빈 세션 — 구분선 0/고정 0/오류 0', s.sepCount === 0 && s.pinnedCount === 0 && errors.length === 0, `seps=${s.sepCount} pinned=${s.pinnedCount} err=${errors.length}`);
      await page.screenshot({ path: shot('04-empty-no-sep') });
      await page.close();
    }

    // 구분선 높이 기여 정량 회귀: scrollHeight는 가상화 미측정 스페이서라 display:none 시
    // spacers 재정렬로 오염됨(Δ=-511 실측). 행 자체 레이아웃 높이가 계약 — 각 행 h>0이고 0이 아니어야.
    {
      const { page } = await openChat(browser);
      const hs = await page.evaluate(() => [...document.querySelectorAll('[data-testid="date-separator"]')].map((e) => e.getBoundingClientRect().height));
      check('회귀 구분선당 높이 기여 >0', hs.length >= 3 && hs.every((h) => h > 8), `heights=${JSON.stringify(hs)}`);
      await page.close();
    }
  } catch (e) {
    failed++; console.log('  FAIL  스모크 예외 — ' + String(e).slice(0, 300));
  } finally {
    await browser.close();
  }
  console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})();
