// t_8917ca0d 스모크 — ① 라벨(쓰레드/새프로젝트 — t_7f86eefb 승계) ② 새프로젝트(포크) 왕복 성공 회귀(pre-fix 재현은 repro_fork_wrapper_t8917ca0d.cjs) ③ 대화 제목 수정
// 실행: expo export -p web --output-dir dist-t8917ca0d --clear
//       node tests/e2e/fr-serve.cjs dist-t8917ca0d 8178
//       APP_URL=http://localhost:8178 node tests/e2e/smoke_fork_title_t8917ca0d.cjs
// 전 API는 run_c_fixtures 인터셉트(백엔드 불요) — fork 응답은 백엔드 실 계약 {session,copied} 래퍼 미러.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8178';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'fork-title-t8917ca0d');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; failures.push(name); console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
// 웹 마우스 홀드 = 롱프레스 (rnw PressResponder 450ms + 여유 — smoke_reply_quote longPress 관례 1:1,
// r9 머지게이트: 홀드 전 리스트 중앙 이동+상방 휠로 tail-follow 이탈 확정)
async function hold(page, locator, { scrollList = true } = {}) {
  if (scrollList) {
    const lb = await page.getByTestId('message-list').boundingBox();
    if (lb) { await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await page.mouse.wheel(0, -800); await page.waitForTimeout(150); }
  }
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await locator.boundingBox();
  assert.ok(box, 'hold target has no bounding box');
  // t_7f86eefb: 홀드 지점 = 좌측 1/4 (우측 상단 액션 클러스터(thread/fork/export/star) 회피 —
  // 센터 x가 카드 본문의 '쓰레드' 키에 떨어져 롱프레스 대신 시트 오픈됐음. 레퍼런스: 텔레그램 홀드)
  await page.mouse.move(box.x + box.width * 0.25, box.y + Math.min(40, box.height / 2));
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(200);
}
const appbarTitle = (page) => page.getByTestId('chat-appbar-title').innerText();
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const forkResponses = [];
  page.on('response', async (res) => {
    if (/\/api\/sessions\/[^/]+\/fork$/.test(res.url())) {
      try { forkResponses.push(await res.json()); } catch { /* ignore */ }
    }
  });
  const state = await installFixtures(page, { rich: true, chief: true, longCard: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').click();
  await page.getByText('Server value', { exact: true }).waitFor({ timeout: 20000 });

  // ── ① 라벨 (t_7f86eefb 승계: 답글→'쓰레드'·갈라내기→'새프로젝트') ──
  // 1a. 롱프레스 시트 행 = '쓰레드'(action-reply)·'새프로젝트'(action-fork) (testID 계약 불변)
  await hold(page, page.getByTestId('message-agent').first());
  await page.getByTestId('msg-action-sheet').waitFor({ state: 'visible', timeout: 5000 });
  check('① 시트 action-fork 김비서 room 노출', await page.getByTestId('action-fork').isVisible());
  const sheetText = await page.getByTestId('action-fork').innerText();
  check('① 시트 라벨 = 새프로젝트', sheetText.includes('새프로젝트'), `text=${sheetText}`);
  check('① 시트 라벨 = 갈라내기·쓰레드 생성 잔존 금지', !sheetText.includes('갈라내기') && !sheetText.includes('쓰레드 생성'), `text=${sheetText}`);
  check('① 시트 답글 행 라벨 = 쓰레드', (await page.getByTestId('action-reply').innerText()).includes('쓰레드'));
  await page.getByTestId('msg-action-backdrop').click();
  await page.waitForSelector('[data-testid="msg-action-sheet"]', { state: 'detached' });
  // 1b. 카드 우상단 키 = fork.action '새프로젝트' / thread 키 '쓰레드 (N)' (t_7f86eefb ①)
  const cardForkText = await page.getByTestId('card-fork').first().innerText();
  check('① 카드 버튼 = 새프로젝트(fork.action)', cardForkText.includes('새프로젝트'), `text=${cardForkText}`);
  // 1d. (t_7f86eefb ② 요구 케이스) 긴 답변(10줄) 카드에서 우측 상단 키 rect = 카드 상단 20px 이내 + 뷰포트 수납
  const longCard = page.getByTestId('message-agent').filter({ hasText: '긴 답변 1번째 줄' }).first();
  await longCard.waitFor({ timeout: 10000 });
  const cardBox = await longCard.boundingBox();
  const threadLoc = longCard.locator('[data-testid="card-thread-start"]');
  const forkLoc = longCard.locator('[data-testid="card-fork"]');
  check('② 10줄 카드: 상단 클러스터에 쓰레드(1)·새프로젝트 키 존재', (await threadLoc.count()) === 1 && (await forkLoc.count()) === 1);
  const threadBox = await threadLoc.first().boundingBox();
  const forkBox = await forkLoc.first().boundingBox();
  check('② 10줄 카드: thread 키 = 카드 상단 20px 이내·우측', !!cardBox && !!threadBox && threadBox.y - cardBox.y <= 20 && threadBox.x + threadBox.width <= cardBox.x + cardBox.width && threadBox.x + threadBox.width > cardBox.x + cardBox.width / 2, JSON.stringify({ card: cardBox && Math.round(cardBox.y), thread: threadBox && Math.round([threadBox.x, threadBox.y]) }));
  check('② 10줄 카드: fork 키 = 카드 상단 20px 이내', !!cardBox && !!forkBox && forkBox.y - cardBox.y <= 20);
  check('② 10줄 카드: 키 최소 32px 타깃', !!threadBox && threadBox.width >= 32 && threadBox.height >= 32 && !!forkBox && forkBox.width >= 32 && forkBox.height >= 32);
  check('② 10줄 카드: 키 = 첫 답변줄보다 위(밀림 없음)', !!threadBox && !!cardBox && threadBox.y < cardBox.y + 120);
  await longCard.scrollIntoViewIfNeeded();
  const vp = page.viewportSize();
  const threadBox2 = await threadLoc.first().boundingBox();
  check('② 10줄 카드: 스크롤 후 키 = 뷰포트 수납', !!threadBox2 && threadBox2.y >= 0 && threadBox2.y + threadBox2.height <= (vp ? vp.height : 844), `y=${threadBox2 && Math.round(threadBox2.y)}`);
  await page.screenshot({ path: shot('01b-longcard-top-actions') });
  // 1c. (t_3c882443 ③ 후속 정합) 상단 큐 스트립 폐기 — 칩 DOM 0 + 스트립 라벨 이관 확인.
  //     (구 하네스는 queue-chip 전개로 queue-fork 라벨을 검증했으나, 대표님 10/4 "오른쪽 트래커
  //     있으면 상단 큐스트립 빼도 돼" 지시로 스트립 자체가 삭제됨 — 라벨 계약 ①은 카드 버튼·시트로 충분.)
  await openKeyboardIfVoice(page);
  await page.getByTestId('chat-input').fill('스트립 질문');
  await page.getByTestId('send-button').click();
  await page.waitForTimeout(600);
  check('①c 스트립 폐기: queue-chip DOM 0 (트래커 이관)', (await page.locator('[data-testid^="queue-chip-"]').count()) === 0);
  await page.screenshot({ path: shot('01-labels') });

  // ── ② 갈라내기 왕복 성공 (root cause fix 회귀) ─────────────
  await page.getByTestId('card-fork').first().click();
  await page.getByTestId('fork-title').waitFor({ timeout: 10000 });
  check('② 포크 다이얼로그 표시', true);
  await page.screenshot({ path: shot('02-fork-dialog') });
  await page.getByTestId('fork-title').fill('복제된 방');
  await page.getByTestId('fork-submit').click();
  await page.waitForTimeout(1500);
  const wrapped = forkResponses.at(-1);
  check('② 백엔드 실 계약 {session,copied} 래퍼 수신', !!wrapped && !!wrapped.data && !!wrapped.data.session && !!wrapped.data.copied, JSON.stringify(wrapped && wrapped.data && Object.keys(wrapped.data)));
  const failToast = await page.getByText('새프로젝트 만들기에 실패했어요', { exact: false }).count();
  check('② 실패 토스트 없음 (pre-fix 재현 대비)', failToast === 0);
  const newHeader = await appbarTitle(page);
  check('② 새 방 진입 — 헤더 = 복제된 방', newHeader.includes('복제된 방'), `header=${newHeader}`);
  check('② 계보 배너(fork.lineage)', (await page.getByText('에서 시작', { exact: false }).count()) > 0);
  await page.screenshot({ path: shot('03-forked-room') });
  // 새 방 발화 독립성 (기존 Run C 계약과 동일 경로)
  await openKeyboardIfVoice(page);
  await page.getByTestId('chat-input').fill('forked-room-only');
  await page.getByTestId('send-button').click();
  await page.waitForTimeout(400);
  const lastPost = state.calls.filter((c) => c.method === 'POST' && /\/messages$/.test(c.path)).at(-1);
  check('② 발화 = 새 세션 경로(forked)', lastPost && lastPost.path === '/api/sessions/forked/messages', lastPost && lastPost.path);

  // ── ③ 제목 수정: 채팅방 헤더 탭 경로 ──────────────────────
  await page.getByTestId('rename-session-open').click();
  await page.getByTestId('rename-dialog').waitFor({ timeout: 5000 });
  check('③ 헤더 탭 → 제목 수정 다이얼로그', true);
  await page.getByTestId('rename-title').fill('복제된 방 리네임');
  await page.getByTestId('rename-save').click();
  await page.waitForTimeout(800);
  const renamedHeader = await appbarTitle(page);
  check('③ 헤더 즉시 반영', renamedHeader.includes('복제된 방 리네임'), `header=${renamedHeader}`);
  const renameCall = state.calls.find((c) => c.method === 'PATCH' && /\/title$/.test(c.path));
  check('③ PATCH /api/sessions/:id/title 전송', !!renameCall, renameCall && `${renameCall.method} ${renameCall.path} ${JSON.stringify(renameCall.body)}`);
  await page.screenshot({ path: shot('04-header-renamed') });
  // 목록으로 → 리네임/포크 제목 반영(focus refetch) — 앱바 ← 텍스트 (smoke_wave2 관례)
  await page.getByTestId('chat-appbar').getByText('←', { exact: true }).click();
  await page.getByTestId('session-list').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  const listText = (await page.locator('[data-testid^="session-card"]').allInnerTexts()).join(' | ');
  check('③ 목록 = 리네임 제목 (서버 상태)', listText.includes('복제된 방 리네임'), listText.slice(0, 160));
  check('③ 목록 = 포크 생성 세션 존재', listText.includes('복제된 방') || listText.includes('forked'));

  // ── ③b 목록 행 롱프레스 경로 + 빈 제목/취소 가드 ──────────
  await hold(page, page.getByTestId('session-card').first(), { scrollList: false });
  await page.getByTestId('rename-dialog').waitFor({ timeout: 5000 });
  check('③b 목록 롱프레스 → 다이얼로그 (현재 제목 prefill)', (await page.getByTestId('rename-title').inputValue()).length > 0);
  // 상한 경계 (t_0da93d18): 백엔드 SESSION_TITLE_EDIT_MAX=120 정합 — maxLength가 클라이언트에서 절단.
  await page.getByTestId('rename-title').fill('가'.repeat(130));
  const clipped = await page.getByTestId('rename-title').inputValue();
  check('③c 130자 입력 = 120자 절단 (maxLength 정합)', clipped.length === 120, `len=${clipped.length}`);
  check('③c 근접 카운터 노출 120/120', (await page.getByTestId('rename-counter').innerText()).includes('120'));
  check('③c 120자 = 저장 활성 (서버 400 회피)', !(await page.getByTestId('rename-save').isDisabled()));
  await page.screenshot({ path: shot('06-title-limit-counter') });
  await page.getByTestId('rename-title').fill('   ');
  check('③b 공백 제목 = 저장 비활성', await page.getByTestId('rename-save').isDisabled());
  await page.getByTestId('rename-title').fill('원본 이름');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.waitForSelector('[data-testid="rename-dialog"]', { state: 'detached' });
  const afterCancel = (await page.locator('[data-testid^="session-card"]').allInnerTexts()).join(' | ');
  check('③b 취소 = 제목 불변', !afterCancel.includes('원본 이름'), afterCancel.slice(0, 120));
  await page.screenshot({ path: shot('05-list-rename') });

  // ── 게이트: 타 room = action-fork/queue-fork 비노출, 답글·선택 유지 ──
  const page2 = await ctx.newPage();
  const errors2 = [];
  page2.on('pageerror', (e) => errors2.push(String(e)));
  await installFixtures(page2, { rich: true, chief: false });
  await page2.goto(APP, { waitUntil: 'networkidle' });
  await page2.getByTestId('session-card').click();
  await page2.getByText('Server value', { exact: true }).waitFor({ timeout: 20000 });
  await hold(page2, page2.getByTestId('message-agent').first());
  await page2.getByTestId('msg-action-sheet').waitFor({ state: 'visible', timeout: 5000 });
  check('게이트: Test Agent room action-fork 비노출', (await page2.getByTestId('action-fork').count()) === 0);
  check('게이트: 답글/선택 행 유지', await page2.getByTestId('action-reply').isVisible() && await page2.getByTestId('action-select').isVisible());
  // (t_3c882443 ③) 스트립 폐기로 queue-fork 칩 경로 소멸 — 칩 게이트는 위 DOM-0 검사로 대체.
  await page2.getByTestId('msg-action-backdrop').click();

  assert.deepEqual(errors, [], `런타임 오류 0 — got ${errors.length}: ${errors.slice(0, 3).join(' / ')}`);
  assert.deepEqual(errors2, [], `page2 런타임 오류 0 — got ${errors2.length}`);
  console.log(`\nRESULT passed=${passed} failed=${failed}${failed ? ' failures=' + JSON.stringify(failures) : ''}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
