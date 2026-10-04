// t_8917ca0d ② pre-fix 재현 — 백엔드 실 응답 형태({session,copied} 래퍼)로 fork를 목업하면
// 현행 ForkDialog가 '갈라내기에 실패했어요'를出し 새 방에 진입하지 못함을 브라우저에서 실증한다.
// 실행: node tests/e2e/fr-serve.cjs dist-t8917ca0d-pre 8178 (백엔드 불요 — 전 API 라우트 인터셉트)
//       APP_URL=http://localhost:8178 node tests/e2e/repro_fork_wrapper_t8917ca0d.cjs
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8178';
const OUT = path.join(__dirname, 'artifacts', 'fork-title-t8917ca0d');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const state = await installFixtures(page, { rich: true, chief: true });
  // 백엔드 main(f7e0fcf9)의 실 계약으로 덮어씀: data = { session, copied } (curl 실측본과 동일 구조)
  await page.route('**/api/sessions/**/fork', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const session = { id: 'wrapped', user_id: 'u', agent_id: 'agent', status: 'active',
      title: body.new_session_title, metadata: { title: body.new_session_title },
      forked_from: { session_id: 'source', message_id: body.from_message_id, turn_index: 3, forked_at: new Date().toISOString() } };
    state.sessions.push(session); state.messages.wrapped = [...state.messages.source];
    await route.fulfill({ status: 201, json: { ok: true, data: { session, copied: { messages: 4, memories: 0, transcripts: 0, context_patches: 0 } } } });
  });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByText('Server value', { exact: true }).waitFor({ timeout: 20000 });
  await page.getByTestId('card-fork').first().click();
  await page.getByTestId('fork-title').waitFor({ timeout: 10000 });
  await page.getByTestId('fork-title').fill('복제된 방');
  await page.getByTestId('fork-submit').click();
  await page.waitForTimeout(1500);
  const toast = await page.getByText('갈라내기에 실패했어요', { exact: false }).count();
  const stillHere = await page.getByText('Server value', { exact: true }).count();
  await page.screenshot({ path: path.join(OUT, 'repro-prefix-fail-toast.png') });
  assert.ok(toast > 0, `pre-fix 실패 토스트 재현 실패 (toast=${toast})`);
  assert.ok(stillHere > 0, '실패 후 원본 방에 남아야 한다(진입 실패)');
  console.log('PASS repro: 백엔드 {session,copied} 래퍼 → forkTitle parse 실패 → 실패 토스트 + 미진입 (서버 세션은 생성됨 = 사이드이펙트 잔존)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
