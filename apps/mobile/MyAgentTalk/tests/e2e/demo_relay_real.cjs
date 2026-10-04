/**
 * 실데모 — 비서실 릴레이 자막 (t_961ca593 검증 기준)
 * 비서 페르소나(시드 '세심' 역할 = relationship_type secretary 승격 — 백엔드 smoke_relay 관례와 동일 API 경로)로
 * 질문을 보내면 자막이 배정→자료→초안→마무리→통합 순서로 표시되고 최종 답변은 단일 메시지로 착지한다.
 * 대상: 백엔드 = t_961ca593 worktree 코드(:3026, relay 포함), 앱 = dist-relay-demo(:3026 베이크).
 * 실행: node tests/e2e/demo_relay_real.cjs  (OUT_DIR, LOGIN_EMAIL/LOGIN_PW 환경변수 가능)
 */
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const APP = process.env.APP_URL || 'http://localhost:8127';
const API = process.env.API_URL || 'http://localhost:3026';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'relay-real-demo');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

async function api(pathname, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + pathname, { method: body === undefined && !token ? 'GET' : 'POST', headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* void */ }
  return { status: res.status, json };
}

(async () => {
  // ── 0) 시드: signup → 김비서 에이전트 + secretary 페르소나 승격 → 세션 (백엔드 스모크와 동일 REST 경로) ──
  const stamp = Date.now();
  const s = await api('/api/auth/signup', { body: {
    email: `relay_demo_${stamp}@test.io`, password: 'password123', display_name: '릴레이데모', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ],
  } });
  if (s.status !== 201 || !s.json?.data?.token) { console.error('signup 실패', s.status, JSON.stringify(s.json).slice(0, 200)); process.exit(1); }
  const token = s.json.data.token;
  const a = await api('/api/agents', { token, body: { name: '김비서', agent_type: 'assistant' } });
  const agentId = a.json?.data?.id;
  if (!agentId) { console.error('agent 생성 실패', a.status); process.exit(1); }
  const p = await api(`/api/agents/${agentId}/personas`, { token, body: {
    name: '김비서', relationship_type: 'secretary',
    tone_config: { formality: 'formal', emoji_usage: 'never', sentence_length: 'short', honorific_level: 5, quip_tone: 'adjutant' },
  } });
  if (p.status !== 201) { console.error('secretary 승격 실패', p.status, JSON.stringify(p.json).slice(0, 200)); process.exit(1); }
  const sess = await api('/api/sessions/ensure', { token, body: { agent_id: agentId } });
  const sessionId = sess.json?.data?.id;
  if (!sessionId) { console.error('세션 ensure 실패', sess.status); process.exit(1); }
  console.log(`\n=== 실데모 — secretary=${p.json.data.id?.slice(0, 8)} session=${sessionId.slice(0, 8)} ===\n`);

  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((tok) => {
      localStorage.setItem('at-web-v1.sess', tok);
      localStorage.setItem('at-language', 'ko');
    }, token);
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').first().click();
    await page.getByTestId('message-list').waitFor({ timeout: 10000 });
    // 입력창 준비 (A 계층이면 홀드→↑로 키보드 계층 개방 — voice_helper.t_4758f25d)
    const { openKeyboardIfVoice } = require('./voice_helper.cjs');
    await openKeyboardIfVoice(page);

    // 타임랩스: MutationObserver로 자막 문구 전 변화 궤적 페이지측 기록 (폴링 누락 제거)
    await page.evaluate(() => {
      window.__relaySeen = window.__relaySeen || [];
      const rec = () => {
        const el = document.querySelector('[data-testid="relay-caption"]');
        const txt = el && el.textContent ? el.textContent.trim() : '';
        const seen = window.__relaySeen;
        if (txt && seen[seen.length - 1] !== txt) seen.push(txt);
      };
      const mo = new MutationObserver(rec);
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      rec();
    });
    await page.getByTestId('chat-input').fill('주간 회의 일정 정리하고 우선순위 알려줘');
    await page.getByTestId('send-button').click();

    const t0 = Date.now();
    let firstCaption = null, captionGone = false, answerLanded = false, seen = [];
    while (Date.now() - t0 < 120000) {
      seen = await page.evaluate(() => (window.__relaySeen || []).slice());
      const txt = await page.getByTestId('relay-caption').innerText().catch(() => null);
      if (txt && !firstCaption) { firstCaption = txt; await page.screenshot({ path: shot('cap-01-briefing') }); }
      if (firstCaption && !txt) captionGone = true;
      // 최종 답변 = 카드 2장 이상(user+answer) + 질문 원문 착지
      const bodyText = await page.evaluate(() => document.body.textContent || '');
      const agentCards = await page.locator('[data-testid^="card"]').count().catch(() => 0);
      if (firstCaption && bodyText.includes('주간 회의 일정') && agentCards >= 2) answerLanded = true;
      if (answerLanded && (captionGone || seen.length >= 2)) break;
      await page.waitForTimeout(200);
    }
    for (const t of seen) console.log(`  자막 궤적 — ${t}`);
    await page.screenshot({ path: shot('cap-final') });
    // 제로잔류 확인: 루프 종료 시점에 아직 떠 있으면 홀드+페이드(≈1.5s) 후 재확인
    if (!captionGone) {
      for (let i = 0; i < 20 && !captionGone; i++) {
        await page.waitForTimeout(200);
        if (!(await page.getByTestId('relay-caption').count())) captionGone = true;
      }
    }

    // 검증: 배정→자료→초안→마무리→통합 부분순서(단조 — 서버 커튼 보증) + 궤적 비어있지 않음
    const stageOf = (t) => {
      if (t.includes('담당 팀에 바로 전달')) return 'briefing';
      if (t.includes('자료 팀이 지금 찾고')) return 'research';
      if (t.includes('초안이 올라와서')) return 'drafting';
      if (t.includes('답변 마무리 중')) return 'wrapping';
      if (t.includes('마무리됐어요')) return 'done';
      return '?';
    };
    const order = seen.map(stageOf);
    const REL = ['briefing', 'research', 'drafting', 'wrapping', 'done'];
    let mono = true; let idx = -1;
    for (const st of order) { const j = REL.indexOf(st); if (j < 0 || j < idx) { mono = false; break; } idx = j; }
    check('실데모: 자막 1줄 이상 표시 (secretary 턴)', seen.length >= 1, `궤적=${order.join('→')}`);
    check('실데모: stage 순서 단조 (배정→…→통합)', mono, order.join('→'));
    check('실데모: 자막은 1줄 — 궤적 문구에 줄바꿈 없음', seen.every((t) => !t.includes('\n')), `${seen.length}문구`);
    check('실데모: 답변 착지 후 자막 제로잔류', captionGone, `마지막=${seen[seen.length - 1] ?? 'none'}`);
    check('실데모: 최종 답변 단일 메시지 (사용자+에이전트 카드)', answerLanded);
    check('실데모: JS 예외 0', errors.length === 0, errors.slice(0, 2).join(' | '));

    // 캡처 회귀 증거 (390 실데모 전 구간)
    console.log(`\n${passed} PASS / ${failed} FAIL — 캡처: ${OUT}`);
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
