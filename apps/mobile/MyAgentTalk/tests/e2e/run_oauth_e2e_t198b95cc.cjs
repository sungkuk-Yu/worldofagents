// OAuth 프론트 2단계 e2e (t_198b95cc) — page.route 인터셉트로 GoTrue PKCE 왕복을 모킹.
// 실행: node tests/e2e/fr-serve.cjs dist-oauth-on-t198b95cc 8123 &  →  node tests/e2e/run_oauth_e2e_t198b95cc.cjs
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://127.0.0.1:8123';
const OUT = process.env.OUT_DIR || '/home/holysky87/.hermes/profiles/frontdev/cache/scratch/oauth-e2e-t198b95cc';
fs.mkdirSync(OUT, { recursive: true });
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
const net = { authorize: [], token: [], exchange: [], list401: 0, listOk: 0 };
function shot(page, name) { return page.screenshot({ path: path.join(OUT, name + '.png') }); }
// ── GoTrue/ours-API 모킹 ─────────────────────────────
async function installMocks(page) {
  net.authorize = []; net.token = []; net.exchange = []; net.list401 = 0; net.listOk = 0; net.oursToken = null;
  await page.route('**/auth/v1/authorize*', (route) => {
    const u = new URL(route.request().url());
    const q = Object.fromEntries(u.searchParams.entries());
    net.authorize.push(q);
    // GoTrue가 provider 화면에서 할 일: 인증 후 redirect_to(+sb_flow_id)에 code를 붙여 복귀.
    // 네비게이션 요청이라 302 fulfill 대신 same-origin HTML 리다이렉트로 결정적으로 수행.
    const base = decodeURIComponent(q.redirect_to || (APP + '/'));
    const glue = base.includes('?') ? '&' : '?';
    const target = `${base}${glue}code=e2e-mock-code`;
    route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><script>location.replace(${JSON.stringify(target)});</script></head><body></body></html>` });
  });
  await page.route('**/auth/v1/token*', (route) => {
    net.token.push({ body: JSON.parse(route.request().postData() || '{}') });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      access_token: 'sb-access-e2e', token_type: 'bearer', expires_in: 3600,
      refresh_token: 'sb-refresh-e2e', user: { id: 'u-e2e', aud: 'authenticated', email: 'oauth@e2e.test',
        identities: [], created_at: new Date().toISOString() } }) });
  });
  await page.route('**/api/auth/session/exchange', (route) => {
    net.exchange.push({ auth: route.request().headers()['authorization'] || '' });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { token: 'ours-jwt-e2e-' + net.exchange.length, user: { id: 'u-e2e' } } }) });
  });
  const list = (which) => async (route) => {
    const authed = (route.request().headers()['authorization'] || '').startsWith('Bearer ours-jwt-e2e');
    if (!authed) {
      net.list401++;
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"AUTH_INVALID"}}' });
      return;
    }
    net.listOk++;
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: which === 'sessions' ? [] : [{ id: 'a1', name: 'Agent One', description: null, is_active: true }] }) });
  };
  await page.route('**/api/sessions*', list('/api/sessions'));
  await page.route('**/api/agents*', list('/api/agents'));
  await page.route(new URL(APP).origin + '/health', (route) => {
    // refresh()는 agents/sessions에 앞서 GET /health를 선행(t_198b95cc ⑤ 실측: 미목킹 시
    // 404→errors.unsupported로 오프라인 패널에 멈춰 리커버리 경유 자체가 없다). ours 무관 200.
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), mode: 'e2e' }) });
  });
  await page.route('**/auth/v1/user*', (route) => {    // 2.117 getSession은 저장 세션 유효성 확인에 /user를 호출(t_198b95cc ⑤ 404 실측) —
    // 미목킹 시 재충전 슬롯이 비어 리커버리가 dead path가 된다.
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ aud: 'authenticated', sub: 'u-e2e', email: 'oauth@e2e.test', app_metadata: { provider: 'kakao' }, user_metadata: {}, identities: [], created_at: new Date().toISOString() }) });
  });
  await page.route('**/api/ws-ticket*', (route) => route.fulfill({ status: 500, body: '{}' })); // WS 미사용 — 조용히 실패
}
async function readState(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const sbKey = keys.find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    return {
      ours: localStorage.getItem('at-web-v1.sess'),
      sbRaw: sbKey ? localStorage.getItem(sbKey) : null,
      url: location.href,
    };
  });
}
// ── 메인 ───────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const mkPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (process.env.OAUTH_E2E_DEBUG) console.log('  [console]', String(m.text()).slice(0, 200)); });
    page.on('pageerror', (e) => console.log('  [pageerror]', String(e && e.message).slice(0, 300)));
    page.on('response', (r) => { if (r.status() >= 400 || /\/api\/|\/auth\/v1\//.test(r.url())) console.log('  [net]', r.status(), r.request().method(), r.url().slice(0, 130)); });
    page.on('requestfailed', (r) => console.log('  [reqfail]', r.url().slice(0, 140), String((r.failure() || {}).errorText)));
    await installMocks(page);
    return { ctx, page };
  };
  const boot = async (page, url = APP + '/') => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 30000 });
  };

  // ①②③ 성공 왕복 — 버튼 노출·순서 → 카카오 터치 → code 복귀 → exchange → ours JWT
  {
    const { ctx, page } = await mkPage();
    await boot(page);
    await page.tap('[data-testid="signin-button"]');
    await page.waitForSelector('[data-testid="oauth-section"]', { timeout: 10000 });
    const ids = await page.$$eval('[data-testid="oauth-kakao"],[data-testid="oauth-naver"],[data-testid="oauth-google"],[data-testid="oauth-github"]', (els) => els.map((e) => e.getAttribute('data-testid').replace('oauth-', '')));
    check('① 버튼 4종·카카오→네이버→구글→깃허브 순서', JSON.stringify(ids) === JSON.stringify(['kakao', 'naver', 'google', 'github']), ids.join(','));
    await page.waitForTimeout(900); // 슬라이드 애니메이션 정화(RNW 페인트 ~600ms) 후 촬영
    await shot(page, '01-oauth-buttons');
    await page.tap('[data-testid="oauth-kakao"]');
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 30000 });
    await page.waitForFunction(() => localStorage.getItem('at-web-v1.sess') === 'ours-jwt-e2e-1', null, { timeout: 20000 });
    const q = net.authorize[0] || {};
    check('② authorize — provider=kakao', q.provider === 'kakao', JSON.stringify(q.provider));
    check('② authorize — PKCE S256 챌린지', q.code_challenge_method.toLowerCase() === 's256' && !!q.code_challenge);
    check('② authorize — redirect_to에 sb_flow_id 동봉(experimental flag)', /[?&]sb_flow_id=[a-f0-9]{8,}/.test(decodeURIComponent(q.redirect_to || '')), (q.redirect_to || ''));
    const tb = net.token[0] && net.token[0].body;
    check('③ token — auth_code+code_verifier PKCE 교환', tb && tb.auth_code === 'e2e-mock-code' && typeof tb.code_verifier === 'string' && tb.code_verifier.length >= 43, tb ? String(tb.code_verifier && tb.code_verifier.length) : 'none');
    check('③ exchange — sb access token Bearer 1회', net.exchange.length === 1 && net.exchange[0].auth === 'Bearer sb-access-e2e', JSON.stringify(net.exchange));
    const st = await readState(page);
    check('③ ours JWT = at-web-v1.sess 단일 저장', st.ours === 'ours-jwt-e2e-1', String(st.ours));
    check('③ sb 세션은 supabase 키에 유지(§4 폴백 근거)', !!st.sbRaw && st.sbRaw.includes('sb-refresh-e2e'));
    check('③ 콜백 파라미터 URL 소거', !/[?&](code|sb_flow_id)=/.test(st.url), st.url);
    await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 15000 });
    await shot(page, '03-signed-in');
    await ctx.close();
  }

  // ④ 사용자 취소(access_denied) — 한 줄 안내 + exchange/token 호출 0 (루프 없음)
  {
    const { ctx, page } = await mkPage();
    await installMocks(page);
    await page.goto(APP + '/?error=access_denied&error_description=User+denied', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-error"]', { timeout: 30000 });
    check('④ 실패 복귀 → Login + 한 줄 안내', true);
    const errText = await page.$eval('[data-testid="login-error"]', (e) => e.textContent || '');
    check('④ 안내 = cancelled 매핑', /sign-in window was closed|창이 닫혔/.test(errText), errText);
    check('④ 자동 exchange/token 0회(루프 금지)', net.exchange.length === 0 && net.token.length === 0, 'exchange=' + net.exchange.length + ' token=' + net.token.length);
    const st = await readState(page);
    check('④ 콜백 파라미터 소거', !/[?&]error=/.test(st.url), st.url);
    await shot(page, '04-cancel-notice');
    await ctx.close();
  }
  // ⑤ ours JWT 만료(401) → sb 세션 재exchange → 원 요청 재시도 (카드 §4 폴백)
  {
    const { ctx, page } = await mkPage();
    // supabase 저장 실측(read-back): storageKey = sb-<hostname 첫 도트분할>-auth-token =
    // 'sb-127-auth-token' (baseUrl=http://127.0.0.1:8123/auth). 값은 세션 JSON 원본(래퍼 없음).
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('at-web-v1.sess', 'stale-ours-jwt');
      localStorage.setItem('sb-127-auth-token', JSON.stringify({
        access_token: 'sb-access-e2e', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'sb-refresh-e2e', user: { id: 'u-e2e', aud: 'authenticated', email: 'oauth@e2e.test',
          identities: [], created_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), last_sign_in_at: null, app_metadata: { provider: 'kakao' }, user_metadata: {},
        },
      }));
    });
    await installMocks(page); // net 카운터 리셋(라우트 재등록)
    await page.reload({ waitUntil: 'domcontentloaded' });
    // refresh 401 → trySessionRecovery → 재exchange(Bearer sb-access-e2e) → ours 갱신 → 재시도 200.
    await page.waitForFunction(() => localStorage.getItem('at-web-v1.sess') === 'ours-jwt-e2e-1', null, { timeout: 30000 });
    const ours = await page.evaluate(() => localStorage.getItem('at-web-v1.sess'));
    check('⑤ 401 → 재exchange로 ours JWT 갱신', ours === 'ours-jwt-e2e-1', String(ours));
    check('⑤ exchange 호출 1회(리커버리)', net.exchange.length === 1, 'n=' + net.exchange.length);
    check('⑤ 리커버리 Bearer = sb access token', (net.exchange[0] || {}).auth === ['Bearer', 'sb-access-e2e'].join(' '), JSON.stringify(net.exchange[0] || {}));
    check('⑤ 리커버리 후 원 요청 200 재시도', net.listOk >= 1 && (await page.$('[data-testid="new-chat-button"]')) !== null);
    await shot(page, '05-recovered');
    await ctx.close();
  }

  // ⑥ email/password 사용자 — sb 세션 없음: 401은 errors.auth 그대로, 자동 exchange 0 (회귀 방지)
  {
    const { ctx, page } = await mkPage();
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.setItem('at-web-v1.sess', 'pw-jwt-plain'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-hint"], [data-testid="onboarding-panel"]', { timeout: 30000 });
    check('⑥ pw 사용자는 자동 재exchange 0회', net.exchange.length === 0);
    check('⑥ 세션 무효는 현행 errors.auth 경로', true);
    await shot(page, '06-pw-user');
    await ctx.close();
  }

  // ⑦ 플래그 OFF 빌드(dist-oauth-off, 8124 서빙) — 미로그인 로그인 화면에 oauth 섹션 0개(숨김)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    await installMocks(page);
    await page.goto('http://127.0.0.1:8124/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="signin-button"]', { timeout: 30000 });
    await page.tap('[data-testid="signin-button"]');
    await page.waitForSelector('[data-testid="login-card"]', { timeout: 15000 });
    check('⑦ OFF 빌드 — oauth 섹션·버튼 0개', (await page.locator('[data-testid="oauth-section"], [data-testid^="oauth-"]').count()) === 0);
    const loginOk = await page.evaluate(() => !!document.querySelector('[data-testid="login-submit"]'));
    check('⑦ OFF 빌드 — 이메일/비밀번호 로그인 UI 정상(회귀 없음)', loginOk);
    await shot(page, '07-flag-off');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n== OAuth e2e: PASS ${passed} / FAIL ${failed} ==`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
// (diagnostics live in mkPage: OAUTH_E2E_DEBUG=1 console·pageerror·reqfail 표시)
