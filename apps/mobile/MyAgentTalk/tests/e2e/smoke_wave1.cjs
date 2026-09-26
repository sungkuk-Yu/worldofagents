// Wave 1 스모크 — 인터랙티브 카드 3종(form/chart/media) + 리치텍스트 + 즐겨찾기 영속/컬렉션
// 실행: 정적서버(python3 -m http.server 8081 @ dist-web) → node tests/e2e/smoke_wave1.cjs
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8081';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'wave1');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const state = await installFixtures(page, { wave: true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(APP);
    await page.getByTestId('session-card').click();

    // ① 리치텍스트 — 마크다운 링크/인라인 코드/인용이 별도 세그먼트로 렌더
    await page.getByTestId('rich-link').first().waitFor();
    assert.ok((await page.getByTestId('rich-link').count()) >= 1, '링크 세그먼트 렌더');
    await page.getByText('인용 테스트', { exact: true }).waitFor();
    await page.screenshot({ path: shot('01-richtext') });

    // 카드 4종 × (접힘/펼침) 캡처 — 완료 기준(카드 본문 검증 섹션). media는 텍스트 프리뷰가 없는 커스텀
    // 포스터 렌더러라 프레임 순서(rich=0, form=1, chart=2, media=3)로 잡는다.
    const shotCard = async (name, text, nth = 0) => {
      const frame = text
        ? page.getByTestId('message-agent').filter({ hasText: text }).nth(nth)
        : page.getByTestId('message-agent').nth(nth);
      await frame.scrollIntoViewIfNeeded();
      await page.waitForTimeout(120);
      await page.screenshot({ path: shot(name) });
    };
    await shotCard('10-richtext-collapsed', '문의는');
    await shotCard('11-form-collapsed', '견적 요청');
    await shotCard('12-chart-collapsed', '매출');
    await shotCard('13-media-collapsed', null, 3);

    // 카드 전부 펼침 (#51 기본 접힘 — 재조회 루프: 펼치면 핸들이 접기 버튼으로 바뀜)
    for (let i = 0; i < 12; i++) {
      const handle = page.getByTestId('card-expand').first();
      if (!(await handle.count())) break;
      await handle.click();
      await page.waitForTimeout(120);
    }
    await shotCard('14-richtext-expanded', '문의는');
    await shotCard('15-form-expanded', '견적 요청');
    await shotCard('16-chart-expanded', '매출');
    await shotCard('17-media-expanded', '샘플 이미지');

    // ② form 카드 — 필수 검증 → 입력 → 제출 wire 계약 확인
    await page.getByTestId('form-submit').scrollIntoViewIfNeeded();
    await page.getByTestId('form-submit').click();
    await page.getByTestId('form-missing').waitFor();
    await page.getByTestId('form-name').fill('김대표');
    await page.locator('[data-testid="form-card"] [role="radio"]').nth(1).click();
    await page.locator('[data-testid="form-card"] [role="checkbox"]').first().click();
    await page.getByTestId('form-submit').click();
    await page.getByTestId('form-submitted').waitFor();
    const sent = state.calls.filter((c) => c.method === 'POST' && c.path === '/api/sessions/source/messages').at(-1);
    assert.ok(sent.body.content.includes('[폼 답변]'), '제출 content에 요약 라벨');
    assert.ok(/"type":"form_response","form_id":"q1"/.test(sent.body.content), 'form_response JSON 첨부');
    assert.ok(sent.body.content.includes('김대표'), '값 요약 포함');
    await page.screenshot({ path: shot('02-form-submitted') });

    // ③ chart 카드 — svg 캔버스 렌더 + 표 전환 + 복귀
    await page.getByTestId('chart-canvas').scrollIntoViewIfNeeded();
    await page.getByTestId('chart-canvas').locator('svg').first().waitFor();
    await page.getByTestId('chart-table-toggle').click();
    await page.getByTestId('chart-table-toggle').click();
    await page.getByTestId('chart-canvas').locator('svg').first().waitFor();
    await page.screenshot({ path: shot('03-chart') });

    // ④ media 카드 — 이미지 인라인 + 라이트박스 열고 닫기
    await page.getByTestId('media-tap').scrollIntoViewIfNeeded();
    await page.getByTestId('media-tap').locator('img').first().waitFor();
    await page.getByTestId('media-tap').click();
    await page.getByTestId('media-lightbox').waitFor();
    await page.screenshot({ path: shot('04-lightbox') });
    await page.getByTestId('media-close').click();
    await page.waitForSelector('[data-testid="media-lightbox"]', { state: 'detached' });

    // ⑤ 즐겨찾기 ⭐ 우상단 — PATCH 영속 + 실패 시 롤백/오류 노출
    assert.ok((await page.getByTestId('card-favorite').count()) >= 5, `카드 우상단 ⭐ ${await page.getByTestId('card-favorite').count()}개`);
    await page.getByTestId('card-favorite').nth(1).click();
    await page.waitForTimeout(250);
    const patchCalls = state.calls.filter((c) => c.method === 'PATCH' && c.path.endsWith('/favorite'));
    assert.equal(patchCalls.length, 1, '즐겨찾기 PATCH 1회');
    assert.equal(patchCalls[0].body.favorite, true, 'favorite=true 페이로드');
    state.failFavorite = true;
    await page.getByTestId('card-favorite').nth(2).click();
    await page.getByText('즐겨찾기를 반영하지 못했어요', { exact: false }).waitFor();
    state.failFavorite = false;
    await page.screenshot({ path: shot('05-favorite') });

    // ⑥ 즐겨찾기 컬렉션 — 채팅 뒤로(←) → ★ 탭 → 방금 즐겨찾은 카드 + seed favorite:true 행 노출
    await page.getByTestId('chat-appbar').getByText('←', { exact: true }).click();
    await page.getByTestId('favorites-button').click();
    await page.getByText('견적 요청', { exact: true }).first().waitFor();
    await page.getByText('Fav card', { exact: true }).first().waitFor();
    await page.screenshot({ path: shot('06-favorites-feed') });
    await page.locator('[data-testid^="favorite-"]:not([data-testid^="favorite-unstar"])').first().click();
    await page.getByTestId('focus-highlight').first().waitFor({ timeout: 5000 });
    await page.screenshot({ path: shot('07-deeplink-highlight') });

    // ⑦ 다중 선택 + 보관/이어가기 (대표님 9/26) — 앱바 '선택' 진입, 복수 선택, 보관=일괄 PATCH, 이어가기=포크 진입
    // 딥링크 채팅 → 즐겨찾기 → 대화목록으로 두 번 백 후 원본 채팅 재진입
    await page.getByTestId('chat-appbar').getByText('←', { exact: true }).click();
    await page.getByTestId('favorites-back').click();
    await page.getByTestId('session-card').click(); // 원본 채팅 재진입 (선택 모드 검증용)
    await page.getByTestId('rich-link').first().waitFor();
    await page.getByTestId('selection-enter').click();
    await page.getByTestId('selection-toggle-all').waitFor();
    // 전체 선택 → 앱바 카운트 → 보관 = 즐겨찾기 아닌 카드 전량 PATCH (이미 별인 카드는 no-op)
    await page.getByTestId('selection-toggle-all').click();
    assert.ok((await page.getByText('개 선택됨', { exact: false }).count()) > 0, '앱바 카운트 노출');
    const patchBefore = state.calls.filter((c) => c.method === 'PATCH' && c.path.endsWith('/favorite')).length;
    await page.getByTestId('selection-keep').click();
    await page.waitForTimeout(500);
    const patchAfter = state.calls.filter((c) => c.method === 'PATCH' && c.path.endsWith('/favorite')).length;
    assert.ok(patchAfter - patchBefore >= 3, `보관 → 일괄 PATCH (delta ${patchAfter - patchBefore})`);
    assert.equal(await page.getByTestId('selection-bar').count(), 0, '보관 후 선택 종료');
    await page.screenshot({ path: shot('08-selection') });
    // 선택 해제 토글 확인 + 이어가기 = 선택 후 포크 다이얼로그 진입
    await page.getByTestId('selection-enter').click();
    await page.getByTestId('selection-toggle-all').click(); // 전체 선택
    await page.getByTestId('selection-toggle-all').click(); // 라벨이 '선택 해제'로 전환되며 전체 해제
    const rows = page.locator('[data-testid^="select-"]');
    await rows.nth(0).click();
    await page.getByTestId('selection-continue').click();
    await page.getByTestId('fork-title').waitFor();
    await page.screenshot({ path: shot('09-selection-fork') });
    await page.getByRole('button', { name: '취소', exact: true }).click();

    // ⑧ 콘솔 무오류
    assert.equal(errors.length, 0, `페이지 오류 0 — ${errors.join(' | ')}`);
    console.log('WAVE1 SMOKE PASS');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error('WAVE1 SMOKE FAIL:', error.message); process.exit(1); });
