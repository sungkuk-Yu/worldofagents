// 사진 편집/피드 스모크 (t_4497cfce Wave 2) — 첨부→편집기(주석+저장)→photo_edit 지시 전송→재현 카드 + 피드(세그먼트·뷰어·딥링크)
// 실행: 정적서버(python3 -m http.server 8081 @ dist-web) → node tests/e2e/smoke_photo_feed.cjs
// 주의: smoke_wave2.cjs는 볼트/보드(t_174b66d2) 스모크 — 파일명 충돌 회피로 별도 파일.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8081';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'photo-feed');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const stub = { count: 0 };
    const state = await installFixtures(page, { wave: true, uploadStub: stub, feedPhoto: true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(APP);
    await page.getByTestId('session-card').click();
    await page.getByTestId('chat-appbar').waitFor();

    // ① 클립 → 파일 선택 → 즉시 업로드 + 편집기 자동 오픈
    const chooserP = page.waitForEvent('filechooser');
    await page.getByTestId('attach-button').click();
    const chooser = await chooserP;
    await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG_1PX });
    await page.getByTestId('photo-editor').waitFor({ timeout: 8000 });
    check('첨부 선택 → 편집기 자동 오픈', true);
    await page.screenshot({ path: shot('01-editor-open') });

    // ② 크롭 프리셋 1:1 + 핀 주석 + 메모 → 편집 저장(웹 canvas 합성 → 편집본 두 번째 업로드)
    await page.getByTestId('preset-1:1').click();
    await page.getByTestId('tool-pin').click();
    const canvasBox = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="photo-editor"]');
      const divs = sheet ? Array.from(sheet.querySelectorAll('div')) : [];
      // 캔버스 = 시트 내 정사각에 가까운 가장 큰 div (aspectRatio 1 스타일)
      let best = null, bestArea = 0;
      for (const d of divs) { const r = d.getBoundingClientRect(); if (r.width > 60 && Math.abs(r.width - r.height) < 8 && r.width * r.height > bestArea) { best = r; bestArea = r.width * r.height; } }
      return best ? { x: best.x + best.width / 2, y: best.y + best.height / 2 } : { x: 195, y: 300 };
    });
    await page.mouse.click(canvasBox.x, canvasBox.y);
    await page.getByTestId('photo-note').fill('이걸 우측 상단으로');
    await page.screenshot({ path: shot('02-editor-annotated') });
    await page.getByTestId('photo-editor-save').click();
    await page.getByTestId('photo-editor').waitFor({ state: 'hidden', timeout: 8000 });
    await page.getByTestId('attachment-stage').waitFor();
    check('편집 저장 → 편집본 업로드 스테이지', stub.count >= 2, `uploads=${stub.count}`);
    const prefilled = await page.getByTestId('chat-input').inputValue();
    check('지시문+photo_edit JSON 펜스 프리필', prefilled.includes('photo_edit') && prefilled.includes('핀'));
    await page.screenshot({ path: shot('03-stage-ready') });

    // ③ 전송 → attachment_ids 동봉 + 재현 카드(원본 위 크롭/주석 오버레이) 렌더
    await page.getByTestId('send-button').click();
    await page.getByTestId('photo-edit-card').waitFor({ timeout: 8000 });
    const sendCall = [...state.calls].reverse().find((c) => /\/messages$/.test(c.path) && c.method === 'POST');
    check('전송 본문에 attachment_ids 동봉', !!sendCall && Array.isArray(sendCall.body.attachment_ids) && sendCall.body.attachment_ids.length >= 1, sendCall ? String((sendCall.body.attachment_ids || []).length) + '개' : 'no call');
    check('photo_edit 재현 카드 — 펜스 원문 미노출', (await page.getByTestId('photo-edit-card').count()) === 1 && !((await page.locator('[data-testid="message-user"]').first().innerText()).includes('```json')));
    await page.screenshot({ path: shot('04-photoedit-card') });

    // ④ 피드 — 진입, 세그먼트 전환, 탭 = 뷰어(저장/원본 딥링크), 즐겨찾기 해제 = 즉시 제거
    // (native-stack 웹은 히든 화면이 DOM에 남는다 — 루트 재진입으로 목록 화면 확정)
    await page.goto(APP);
    await page.getByTestId('feed-button').waitFor({ timeout: 8000 });
    await page.getByTestId('feed-button').click();
    await page.getByTestId('feed-grid').waitFor({ timeout: 8000 });
    await page.getByTestId('feed-tile-fav').waitFor();
    check('피드 = 즐겨찾기 파생 그리드', true);
    await page.screenshot({ path: shot('05-feed-all') });
    await page.getByTestId('feed-segment-photo').click();
    check('photo 세그먼트 = 비사진 카드 제외', (await page.getByTestId('feed-tile-fav').count()) === 0);
    await page.screenshot({ path: shot('06-feed-photo-segment') });
    await page.getByTestId('feed-segment-all').click();
    // 사진 카드 기준 뷰어 = 미디어 저장 + 원본 세션 딥링크 (text 캐리는 action 버튼 없음 — 저장 버튼 미표시는 정상)
    await page.getByTestId('feed-tile-photo').click();
    await page.getByTestId('feed-viewer-save').waitFor({ timeout: 8000 });
    check('피드 탭 = 사진 뷰어(저장 + 원본 세션 딥링크)', (await page.getByTestId('feed-viewer-open-source').count()) === 1);
    // 공유 스냅샷: 캔버스 합성→(headless는 navigator.share 없음) 다운로드 폴백 = PNG 1장
    const dlP = page.waitForEvent('download', { timeout: 8000 });
    await page.getByTestId('feed-viewer-share').click();
    const dl = await dlP;
    check('외부 공유 스냅샷 = 카드 이미지 다운로드(세션 컨텍스트 미포함)', dl.suggestedFilename() === 'share-card.png');
    await page.screenshot({ path: shot('07-feed-viewer') });
    // unstar는 뷰어를 즉시 닫고 타일을 제거한다 (setViewerId(null) + 낙관적 필터)
    await page.getByTestId('feed-viewer-unstar').click();
    await page.waitForTimeout(400);
    check('뷰어 즐겨찾기 해제 → 파생 목록 즉시 반영', (await page.getByTestId('feed-tile-photo').count()) === 0);
    await page.getByTestId('feed-tile-fav').click();
    await page.getByTestId('feed-viewer-unstar').waitFor({ timeout: 8000 });
    await page.getByTestId('feed-viewer-unstar').click();
    await page.waitForTimeout(400);
    check('text 캐리도 뷰어 해제 동작', (await page.getByTestId('feed-tile-fav').count()) === 0);
    await page.screenshot({ path: shot('08-feed-after-unstar') });

    const fatal = errors.filter((e) => !/WebSocket|ws|network/i.test(e));
    check('런타임 예외 없음', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  } catch (e) {
    failed++;
    console.log('  FAIL  스모크 예외 —', String(e.message).split('\n').slice(0, 4).join(' ⏎ '));
  } finally {
    await browser.close();
  }
  console.log(`\n결과: PASS ${passed} / FAIL ${failed}`);
  process.exitCode = failed ? 1 : 0;
})();
