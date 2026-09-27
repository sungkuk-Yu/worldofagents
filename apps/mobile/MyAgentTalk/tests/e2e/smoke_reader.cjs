// t_3116c5bc 스모크 — 펼침 기본화 + '더 보기' + 리더 모달 + 카드 내보내기 메뉴 (웹 실측)
// 실행: 정적서버(python3 -m http.server 8141 @ dist-reader) → node tests/e2e/smoke_reader.cjs
// 완료 기준 매핑: 장문/표/단문 3카드 before/after + 리더 모달 캡처 ko/en + export 메뉴/요청 wire 검증.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8141';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'reader-export');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const run = async (locale, tags) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale, reducedMotion: 'reduce' });
    const state = await installFixtures(page, { reader: true, exportStub: true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (locale === 'en-US') {
      // 영어 캡처 — installFixtures의 ko init가 먼저 걸려 있으므로 같은 키을 뒤집는 init를 추가 등록(후순위 실행 우선).
      await page.addInitScript(() => localStorage.setItem('at-language', 'en'));
    }
    await page.goto(APP);
    await page.getByTestId('session-card').click();
    const ko = locale === 'ko-KR';
    const moreLabel = ko ? '더 보기' : 'More';
    const readLabel = ko ? '전체 읽기' : 'Read full';

    // ① 단문 카드 — 펼침 기본: 내용 바로 노출, '더 보기'/리더 없음
    const shortCard = page.getByTestId('message-agent').filter({ hasText: ko ? '단문 카드' : '단문 카드' }).first();
    await shortCard.getByText('정상', { exact: true }).waitFor();
    assert.equal(await shortCard.getByText(moreLabel, { exact: true }).count(), 0, '단문 = 더 보기 핸들 없음(전부 펼침)');

    // ② 장문 리치텍스트 — 1화면 초과 → '더 보기'로 접힌 채 시작, 인라인 펼침
    const longCard = page.getByTestId('message-agent').filter({ hasText: '제14조' }).first();
    await longCard.scrollIntoViewIfNeeded();
    const longExpand = longCard.getByTestId('card-expand');
    await longExpand.waitFor();
    assert.ok(await longExpand.getByText(moreLabel).count(), '장문 카드 = 더 보기 핸들');
    await page.screenshot({ path: shot(`${tags}01-long-collapsed`) });
    await longExpand.click();
    await longCard.getByTestId('card-collapse').waitFor();
    await page.screenshot({ path: shot(`${tags}02-long-expanded`) });
    await longCard.getByTestId('card-collapse').click(); // 재접힘 왕복
    await longExpand.waitFor();

    // ③ 표 40행 — 접힘 시작(추정) → 펼침 후 마지막 행까지 노출 ('항목 1'은 프리뷰/전체 렌더 양쪽 공통 앵커)
    const tableCard = page.getByTestId('message-agent').filter({ hasText: '항목 1' }).first();
    await tableCard.scrollIntoViewIfNeeded();
    await tableCard.getByTestId('card-expand').click();
    await tableCard.getByText('항목 40', { exact: true }).waitFor({ timeout: 5000 });
    assert.ok((await tableCard.getByText('완료', { exact: true }).count()) > 1, '펼치면 40행 전체 렌더');
    await page.screenshot({ path: shot(`${tags}03-table-expanded`) });

    // ④ 리더 모달 — 장문 카드 '전체 읽기' → 페이퍼 모달, Esc 닫기 (ko/en 양 언어)
    const readerBtn = page.getByTestId('reader-open').first();
    await readerBtn.waitFor();
    await readerBtn.click();
    const modal = page.getByTestId('reader-modal');
    await modal.waitFor();
    const title = await modal.getByTestId('reader-title').textContent();
    assert.ok((title || '').includes('제14조'), '리더 상단 제목 = 카드 첫 문장');
    await modal.getByText('부속 합의서의 비밀유지 조항').first().waitFor();
    await page.screenshot({ path: shot(`${tags}04-reader-modal`) });
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });

    // ⑤ 내보내기 — 다운로드 아이콘 → 메뉴 4종, 표 카드만 xlsx 활성, 클릭 wire + hwp 폴백 안내
    // (성공 시 메뉴가 닫히므로 포맷마다 재오픈 — 노트는 패널 밖으로 잔존)
    const tableExport = tableCard.getByTestId('card-export-table');
    await tableExport.scrollIntoViewIfNeeded();
    // virtualized list + 가로 ScrollView 재활용으로 액션너블 검사 오탐 — 아이콘 press는 force로 직접 전달
    await tableExport.click({ force: true });
    let menu = page.getByTestId('export-menu');
    await menu.getByTestId('export-xlsx').click();
    await page.getByTestId('export-note').waitFor();
    assert.ok(state.exports.some((e) => e.messageId === 'table' && e.fmt === 'xlsx'), 'xlsx = GET export?fmt=xlsx (표 카드)');
    await tableExport.click({ force: true });
    menu = page.getByTestId('export-menu');
    await menu.getByTestId('export-hwp').click();
    await page.getByTestId('export-note').waitFor();
    await page.waitForTimeout(150);
    assert.ok(state.exports.some((e) => e.fmt === 'hwp'), 'hwp 요청 전송(백엔드가 .docx 정직 폴백)');
    const noteText = await page.getByTestId('export-note').textContent();
    assert.ok(ko ? noteText.includes('한글') : noteText.toLowerCase().includes('hangul'), 'hwp 저장 = 호환 안내 노트');
    await page.screenshot({ path: shot(`${tags}05-export-menu`) });
    if (await page.getByTestId('export-menu-close').count()) await page.getByTestId('export-menu-close').click();

    // ⑥ 단문 카드 내보내기 메뉴에서 xlsx 비활성(회색) — 클릭해도 요청 나가지 않음
    // (virtualized FlatList: 스크롤 후 재클램까지 1프레임 — force 클릭 전 뷰포트 진입 확인)
    const shortExport = page.getByTestId('card-export-short');
    await shortExport.scrollIntoViewIfNeeded();
    await shortExport.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(250);
    await shortExport.click({ force: true });
    await page.getByTestId('export-pdf').waitFor();
    const xlsxOff = page.getByTestId('export-xlsx');
    await xlsxOff.click();
    // 노트는 시트 내부로 스코프 — 표 카드에 ⑤의 잔류 노트가 남아 strict 위반(2개) 방지
    const sheetNote = page.getByTestId('export-menu').getByTestId('export-note');
    await sheetNote.waitFor();
    const offNote = await sheetNote.textContent();
    assert.ok(ko ? offNote.includes('표') : offNote.toLowerCase().includes('table'), '비표 카드 xlsx = 안내만, 요청 없음');
    assert.ok(!state.exports.some((e) => e.messageId === 'short' && e.fmt === 'xlsx'), 'xlsx 서버 요청 차단');
    await page.getByTestId('export-menu-close').click();
    assert.equal(await page.getByTestId('export-menu').count(), 0, '메뉴 닫힘');

    assert.deepEqual(errors, [], '페이지 오류 0');
    await page.close();
    return state;
  };
  try {
    const koState = await run('ko-KR', 'ko-');
    await run('en-US', 'en-');
    console.log(`PASS smoke_reader — export calls=${JSON.stringify(koState.exports)}`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
