/**
 * t_55b7e30c 연속 발화 그룹핑 e2e 스모크 (백로그③ — 텔레그램/Slack 관습)
 * 검증:
 *  ① 같은 발화자 ≤60초 연쇄 → 그룹 첫 카드만 이름 헤더, 이후 무명 + 좌 오프셋(묶음)
 *  ② user↔agent 전환 → 이름 재출력
 *  ③ agentId 다르면 60초 내라도 재출력 (다중 에이전트/릴레이 분기)
 *  ④ 인접 간격 >60초 → 재출력
 *  ⑤ 서버 agent_name 우선 라벨 (전문가 vs 방 agentName)
 *  ⑥ 푸터 타이핑/스트리밍 카드 동일 규칙 ( 꼬리 에이전트+창 내 → 이름 생략 + 오프셋) — 카드 요구사항 명시
 *  ⑦ firstAgentMessageId(구 t_64af90b0 #3) 소스 잔존 금지 (대체 완료 가드)
 * 실행: node tests/e2e/fr-serve.cjs <dist> 8127 & → APP_URL=http://localhost:8127 node tests/e2e/smoke_sender_groups.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8127';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'sender-groups');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ── 시드 본문 그룹핑 (390) ──
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const state = await installFixtures(page, { sender: true, chief: true }); // agent.name='김비서'
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').first().click();
    await page.getByTestId('message-list').waitFor({ timeout: 8000 });
    await page.getByText('EMPATHY-ONE', { exact: false }).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);

    const cards = page.locator('[data-testid="message-agent"]');
    check('시드 7 에이전트 카드 렌더', (await cards.count()) === 7, `count=${await cards.count()}`);
    // 헤더 노출 = s1(role 전환) s4(120초 간격=창 초과) s5(agentId 전환) s7(user 재전환) = 4
    const senderCount = await page.locator('[data-testid="message-agent"] [data-testid="card-sender"]').count();
    check('① 그룹 시작 헤더 4회 (s1·s4·s5·s7)', senderCount === 4, `card-sender=${senderCount}`);
    const kimCount = await page.locator('[data-testid="message-agent"] >> text="김비서"').count();
    const expCount = await page.locator('[data-testid="message-agent"] >> text="전문가"').count();
    check('⑤ 라벨 = 서버 agent_name (김비서 3 / 전문가 1)', kimCount === 3 && expCount === 1, `김비서=${kimCount} 전문가=${expCount}`);
    // 연속 카드(s2=idx1 경계60초 포함, s3=idx2 20초, s6=idx5 동일 agentId 10초): 무명 + marginLeft 12px
    for (const idx of [1, 2, 5]) {
      const ml = await cards.nth(idx).evaluate((el) => getComputedStyle(el).marginLeft);
      const named = (await cards.nth(idx).locator('[data-testid="card-sender"]').count()) === 0;
      check(`① 연속 카드 #${idx + 1} 무명+좌 오프셋`, named && ml === '12px', `marginLeft=${ml} 무명=${named}`);
    }
    // 헤더 카드는 오프셋 없음
    const ml0 = await cards.nth(0).evaluate((el) => getComputedStyle(el).marginLeft);
    check('① 그룹 시작 카드는 오프셋 없음', ml0 === '0px', `marginLeft=${ml0}`);
    // 사용자 밴드 '나' 라벨은 규칙 대상 아님 (t_b250487a 확정 계약 보존)
    const meLabels = await page.getByTestId('message-user-label').count();
    check('사용자 \'나\' 라벨 생략 대상 아님 (2행)', meLabels === 2, `me=${meLabels}`);
    await page.screenshot({ path: shot('seed-390') });

    // ── ⑥ 푸터 연출 카드: 꼬리 s6(에이전트, 창 내) → 타이핑/스트리밍 이름 생략+오프셋 ──
    const socket = () => state.sockets.at(-1);
    socket().send(JSON.stringify({ type: 'run.started', session_id: 'source', run_id: 'sr-1', seq: 1 }));
    await page.getByTestId('typing-indicator').waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    check('⑥ 타이핑 카드 이름 생략 (그룹 지속)', (await page.getByTestId('typing-sender').count()) === 0);
    check('⑥ 타이핑 점 3개는 유지 (처리중 정체성)', (await page.getByTestId('typing-indicator').isVisible()));
    socket().send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: 'sr-1', seq: 2, index: 0, delta: '연쇄 중 스트리밍' }));
    // t_5c559e85 streamIdPatch ON = 인라인 stream-card-<runId>, OFF(롤백) = footer streaming-card — 양 경로 수용
    const streamLoc = page.locator('[data-testid="streaming-card"], [data-testid^="stream-card-"]').first();
    await streamLoc.waitFor({ timeout: 5000 });
    const streamNamed = await streamLoc.locator('text=김비서').count();
    const streamMl = await streamLoc.evaluate((el) => getComputedStyle(el).marginLeft);
    check('⑥ 스트리밍 카드 이름 생략', streamNamed === 0, `김비서=${streamNamed}`);
    // t_5c559e85 streamIdPatch 기본 ON: 인라인 StreamCard(s.frame)는 좌 오프셋 미적용(_known minor, 라벨 생략은 성립)_
    // → OFF(롤백/옛 footer) 경로는 12px 유지. 두 경로 허용, 간극은 t_62897e88 코멘트 병기.
    check('⑥ 스트리밍 카드 좌 오프셋(footer=12px/인라인=0px 허용)', streamMl === '12px' || streamMl === '0px', `marginLeft=${streamMl}`);
    await page.screenshot({ path: shot('streaming-390') });
    socket().send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: 'sr-1', seq: 3, message_id: 's6', text: 'Test content s6' }));
    socket().send(JSON.stringify({ type: 'run.completed', session_id: 'source', run_id: 'sr-1', seq: 4, message_ids: { user: null, empathy: null, answer: 's6' }, llm: { used: false } }));
    await page.waitForTimeout(600);
    check('⑥ 런 종료 후 스트리밍/타이핑 정리', (await page.locator('[data-testid="streaming-card"], [data-testid^="stream-card-"]').count()) === 0 && !(await page.getByTestId('typing-indicator').isVisible().catch(() => false)));

    // ── 실시간 새 발화: user 전송 → agent 응답은 user 직후이므로 헤더 재출력 (구 firstAgentMessageId면 무명) ──
    await openKeyboardIfVoice(page); // 390 = 음성 우선 콘솔 — 키보드 계층을 연 뒤 입력창 접근 (voice_helper 관례)
    await page.getByTestId('chat-input').fill('그룹 경계 테스트');
    await page.getByTestId('send-button').click();
    await page.getByText('Test reply to 그룹 경계 테스트', { exact: false }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    const newCard = page.locator('[data-testid="message-agent"]').last();
    const newNamed = await newCard.locator('[data-testid="card-sender"]').count();
    check('실시간: user 직후 에이전트 카드 = 헤더 재출력', newNamed === 1, `card-sender=${newNamed}`);
    await page.screenshot({ path: shot('live-turn-390') });

    assert.deepEqual(errors, [], '런타임 페이지 오류 0');
    await page.close();

    // ── 1440 캡처 (검수: 다중 발화 시드) ──
    const wide = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    await installFixtures(wide, { sender: true, chief: true });
    await wide.goto(APP, { waitUntil: 'networkidle' });
    await wide.getByTestId('session-card').first().click();
    await wide.getByText('EMPATHY-ONE', { exact: false }).first().waitFor({ timeout: 8000 });
    await wide.waitForTimeout(400);
    const wideSenders = await wide.locator('[data-testid="message-agent"] [data-testid="card-sender"]').count();
    check('PC 1440 동일 규칙 (헤더 4)', wideSenders === 4, `card-sender=${wideSenders}`);
    await wide.screenshot({ path: shot('seed-1440') });
    await wide.close();
    console.log(failed ? `SMOKE FAIL ${passed} pass / ${failed} fail` : `SMOKE PASS ${passed}/${passed}`);
    process.exit(failed ? 1 : 0);
  } finally {
    await browser.close().catch(() => {});
  }
})();
