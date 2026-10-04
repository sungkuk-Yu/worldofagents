// t_55f9ed57 검증 캡처 (t_7f86eefb 라벨 승계: 답글→'쓰레드'·갈라내기→'새프로젝트') — 카드 액션 라벨 (ko/en) + 김비서 게이트
// 실행: (dist-t55f9ed57 정적서버 :8081) → APP_URL=http://localhost:8081 node tests/e2e/shot_labels_t55f9ed57.cjs
// 픽스처 출처: run_c_fixtures.cjs (API/WS 전량 모의, 백엔드 불요) — chief 플래그로 에이전트명만 스위치
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8081';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'labels-t55f9ed57');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);

// 한 화면: 김비서 room → 쓰레드+새프로젝트 모두 노출
async function chiefRoom(browser, lang) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await installFixtures(page, { rich: true, chief: true });
  await page.addInitScript((l) => localStorage.setItem('at-language', l), lang);
  await page.goto(APP);
  await page.getByTestId('session-card').click();
  await page.getByText(lang === 'ko' ? 'Server value' : 'Server value', { exact: true }).waitFor();
  const ko = lang === 'ko';
  // t_7f86eefb 라벨: 쓰레드(답글 열기, 답글 수 배지 '(N)') / 새프로젝트 = card-fork 버튼 (우상단 클러스터)
  assert.ok((await page.getByTestId('card-thread-start').count()) > 0, '쓰레드 액션 노출');
  assert.ok((await page.getByText(ko ? '쓰레드 (1)' : 'Thread (1)', { exact: true }).count()) > 0, '쓰레드 라벨 텍스트');
  const forkButtons = page.getByTestId('card-fork');
  assert.ok((await forkButtons.count()) > 0, '김비서 room — 새프로젝트 노출');
  assert.ok((await page.getByText(ko ? '새프로젝트' : 'New project', { exact: true }).first().count()) > 0, '새프로젝트 라벨 텍스트');
  assert.ok((await page.getByText(ko ? '스레드' : 'Start a thread', { exact: false }).count()) === 0, '구 라벨 잔존 없음');
  assert.ok((await page.getByText('갈라내기', { exact: false }).count()) === 0, '구 라벨(갈라내기) 잔존 없음');
  await page.screenshot({ path: shot(`chief-${lang}-cards`) });
  // 쓰레드 시트 열기 → 헤더 '쓰레드' (cards.threadFrom)
  await page.getByTestId('card-thread-start').first().click();
  await page.getByTestId('thread-sheet').waitFor({ timeout: 10000 });
  await page.getByText(ko ? '쓰레드' : 'Thread', { exact: true }).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(900); // 시트 디텐트 애니메이션 정착 (#52 규칙 7)
  await page.screenshot({ path: shot(`chief-${lang}-thread-sheet`) });
  await page.getByText(ko ? '뒤로 가기' : 'Go back', { exact: true }).click();
  await page.waitForSelector('[data-testid="thread-sheet"]', { state: 'detached' });
  // 새프로젝트 다이얼로그
  await forkButtons.first().click();
  await page.getByTestId('fork-title').waitFor({ timeout: 10000 });
  await page.getByText(ko ? '이 대화 갈래를' : 'Bring this conversation branch', { exact: false }).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  assert.ok((await page.getByText(ko ? '새 프로젝트 제목' : 'New project title', { exact: false }).count()) > 0, '포크 제목 라벨');
  await page.screenshot({ path: shot(`chief-${lang}-fork-dialog`) });
  assert.deepEqual(errors, [], `런타임 오류 0 (${lang})`);
  await page.close();
}

// 다른 room(내 변호사 등 = Test Agent) → 쓰레드만 노출, 새프로젝트 미노출 (t_7f86eefb 라벨 승계)
async function otherRoom(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await installFixtures(page, { rich: true, chief: false }); // name 'Test Agent'
  await page.goto(APP);
  await page.getByTestId('session-card').click();
  await page.getByText('Server value', { exact: true }).waitFor();
  assert.ok((await page.getByTestId('card-thread-start').count()) > 0, '타 room — 쓰레드 노출(무변경)');
  assert.equal(await page.getByTestId('card-fork').count(), 0, '타 room — 새프로젝트 미노출');
  assert.equal(await page.getByText('새프로젝트', { exact: false }).count(), 0, '타 room — 새프로젝트 텍스트 없음');
  assert.equal(await page.getByText('갈라내기', { exact: true }).count(), 0, '타 room — 구 라벨(갈라내기) 없음');
  // 쓰레드 시트 내 새프로젝트 버튼도 숨김 확인
  await page.getByTestId('card-thread-start').first().click();
  await page.getByTestId('thread-sheet').waitFor({ timeout: 10000 });
  await page.getByText('Thread reply', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('thread-fork').count(), 0, '타 room — 시트 새프로젝트 미노출');
  await page.screenshot({ path: shot('other-ko-cards') });
  assert.deepEqual(errors, [], '런타임 오류 0 (other)');
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  try {
    await chiefRoom(browser, 'ko');
    await chiefRoom(browser, 'en');
    await otherRoom(browser);
    console.log('PASS labels: chief room (ko/en) 쓰레드+새프로젝트, other room 쓰레드만·새프로젝트 숨김');
    console.log('스크린샷:', OUT);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
