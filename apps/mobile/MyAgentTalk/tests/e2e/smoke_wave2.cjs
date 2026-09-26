/**
 * Wave 2 스모크 — 볼트(옵시디언 노트) + 칸반 보드 + 대화->노트/카드 (t_174b66d2)
 * 실 API 연동 판정: DEV_MODE 백엔드(:3020) + dist-wave2 정적서버(:8099) 대상 (mock 아님).
 * 실행:
 *   백엔드: DEV_MODE=true PORT=3020 CORS_ORIGIN=http://localhost:8099 tsx src/index.ts
 *   정적서버: python3 -m http.server 8099 --bind 127.0.0.1 -d dist-wave2 (+window.process shim)
 *   APP_URL=http://localhost:8099 node tests/e2e/smoke_wave2.cjs
 * 검증 흐름 (완료 기준 대응):
 *   ① 가입 A → 채팅 전송 → 카드 '볼트에 저장' → 토스트 → 노트 열기(마크다운 렌더)
 *   ② [[wikilink]] 노트 생성 → 링크 탭 이동 → 백링크 표시
 *   ③ 보드 생성 → '보드에 카드로' → 카드 시트 → 드래그(웹 pointer) → 이동 → 새로고침 후 영속 확인
 *   ④ 사용자 구분: 가입 B → 볼트/보드 빈 상태 (A의 데이터 안 보임)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const APP = process.env.APP_URL || 'http://localhost:8099';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'wave2');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
async function signup(page, email, cred) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="login-hint"], [data-testid="new-chat-button"]', { timeout: 20000 });
  await page.getByTestId('login-hint').click();
  await page.getByTestId('auth-mode-toggle').click();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(cred);
  await page.getByTestId('consent-all-required').click();
  await page.getByTestId('signup-submit').click();
  await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 20000 });
  await page.waitForTimeout(800);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const stamp = Date.now();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // ── 1) 계정 A: 가입 → 채팅 → 카드 '볼트에 저장' ──
    await signup(page, `w2a-${stamp}@myagenttalk.dev`, `w2pw-${stamp}`);
    await page.getByTestId('new-chat-button').click();
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    await page.getByTestId('chat-input').fill(`웨이브2 스모크 볼트 노트 원문 ${stamp}`);
    await page.getByTestId('send-button').click();
    await page.waitForSelector('[data-testid="message-agent"]', { timeout: 30000 });
    await page.waitForTimeout(600);
    check('카드 액션에 볼트/보드 버튼 노출', (await page.getByTestId('card-vault-save').count()) > 0 && (await page.getByTestId('card-board-add').count()) > 0);
    await page.getByTestId('card-vault-save').first().click();
    await page.getByTestId('vault-toast').waitFor({ timeout: 10000 });
    check('볼트 저장 토스트', true);
    await page.screenshot({ path: shot('01-vault-toast') });
    await page.getByTestId('vault-toast-open').click();
    await page.waitForSelector('[data-testid="vault-note"]', { timeout: 10000 });
    const noteText = await page.getByTestId('vault-note').innerText();
    check('노트 상세 — from-message frontmatter 렌더', noteText.includes('대화에서 저장'));
    await page.screenshot({ path: shot('02-vault-note-from-chat') });
    check('원본 대화 열기 링크(source_message_id)', (await page.getByTestId('vault-open-source').count()) > 0);

    // ── 2) [[wikilink]] 노트 B 생성 → 링크 탭 이동 → 백링크 ──
    await page.getByTestId('vault-back').click();
    await page.getByTestId('vault-new').click();
    await page.getByTestId('vault-title-input').fill(`메모 B ${stamp}`);
    await page.getByTestId('vault-tags-input').fill('스모크');
    await page.getByTestId('vault-content-input').fill(`# 제목 메모 ${stamp}\n\n- 항목 하나\n\n> 인용\n\n[[메모 A ${stamp}]] 링크, \`코드\`\n`);
    await page.getByTestId('vault-save').click();
    await page.waitForSelector('[data-testid="vault-note"]', { timeout: 10000 });
    const noteB = await page.getByTestId('vault-note').innerText();
    check('wikilink 노트 생성/저장(본문 헤딩 렌더)', noteB.includes(`제목 메모 ${stamp}`) && !noteB.includes('# '));
    await page.screenshot({ path: shot('03-note-markdown-render') });
    // 미해결 링크([[메모 A ...]]) 탭 → 새 노트 프리필
    const wikilink = page.getByText(`메모 A ${stamp}`).first();
    await wikilink.click();
    await page.waitForSelector('[data-testid="vault-title-input"]', { timeout: 10000 });
    check('미해결 wikilink 탭 -> 제목 프리필 새 노트', (await page.getByTestId('vault-title-input').inputValue()).includes(`메모 A ${stamp}`));
    await page.getByTestId('vault-content-input').fill(`A로부터의 참조. back: [[메모 A ${stamp}]]`);
    await page.getByTestId('vault-save').click();
    await page.waitForSelector('[data-testid="vault-note"]', { timeout: 10000 });
    await page.waitForTimeout(800);
    // A 노트로 이동해 백링크 확인: 목록에서 A 검색
    await page.getByTestId('vault-back').click();
    await page.getByTestId('vault-search').fill(`메모 A ${stamp}`);
    await page.waitForSelector('[data-testid="vault-results"]', { timeout: 10000 });
    await page.locator('[data-testid^="vault-hit-"]').first().click();
    await page.waitForSelector('[data-testid="vault-note"]');
    const backlinkRows = await page.locator('[data-testid^="vault-backlink-"]').count();
    const noteA = await page.getByTestId('vault-note').innerText();
    check('백링크 섹션 — B가 A를 참조', backlinkRows >= 1 && noteA.includes('백링크'), `${backlinkRows}행`);
    await page.screenshot({ path: shot('04-backlinks') });

    // 백링크 탭 -> 참조 노트(B) 이동: B의 본문 시그니처('인용')가 보이는지
    await page.locator('[data-testid^="vault-backlink-"]').first().click();
    await page.waitForTimeout(600);
    check('백링크 탭 -> 참조 노트 이동', (await page.getByTestId('vault-note').innerText()).includes('인용'));

    // ── 3) 보드: 생성 → 대화->카드 → 웹 드래그 이동 → 새로고침 영속 → 카드 시트 편집 ──
    // (native-stack 웹은 히든 화면이 DOM에 남는다 — 교차 화면 진입 전 루트 리셋)
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="board-button"]', { timeout: 15000 });
    await page.getByTestId('board-button').click();
    await page.waitForSelector('[data-testid="board-list"]', { timeout: 10000 });
    await page.getByTestId('board-new').click();
    await page.getByTestId('board-name-input').fill(`웨이브2 보드 ${stamp}`);
    await page.getByTestId('board-create-submit').click();
    await page.waitForSelector('[data-testid="board-columns"]', { timeout: 15000 });
    check('보드 생성 + 4컬럼 렌더', (await page.getByTestId('board-column-done').count()) > 0);
    await page.screenshot({ path: shot('05-board-columns') });

    // 채팅 → 카드 '보드에 카드로' → 토스트 딥링크로 보드 복귀
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="session-card"]', { timeout: 15000 });
    await page.getByTestId('session-card').first().click();
    await page.waitForSelector('[data-testid="message-agent"]', { timeout: 20000 });
    await page.getByTestId('card-board-add').first().click();
    await page.getByTestId('board-toast').waitFor({ timeout: 10000 });
    check('보드 저장 토스트', true);
    await page.screenshot({ path: shot('06-board-toast') });
    await page.getByTestId('board-toast-open').click();
    await page.waitForSelector('[data-testid="board-columns"]', { timeout: 15000 });

    // from-message 카드 특정 (라벨 텍스트로 testid 파생) + todo 끝에 수동 카드 추가
    const fromCard = page.locator('[data-testid^="board-card-"]', { hasText: 'from-message' }).first();
    await fromCard.waitFor({ timeout: 10000 });
    const fromTestId = await fromCard.evaluate((el) => el.getAttribute('data-testid'));
    const cardId = fromTestId.replace('board-card-', '');
    check('대화->카드 생성(from-message 라벨)', !!cardId);
    await page.getByTestId('board-add-doing').click();
    await page.waitForTimeout(900);
    const manualCard = page.locator('[data-testid^="board-card-"]', { hasText: '새 카드' }).first();
    check('컬럼 내 수동 카드 추가', (await manualCard.count()) > 0);

    // 웹 드래그: todo 카드 → done 컬럼. 모바일 390폭에선 4컬럼(≈1160px)이 한 화면에 안 들어옴
    // → 웹 데스크톱 뷰포트로 전환 후 드래그 (실사용 웹 경로 = 데스크톱 보드).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(500);
    const src = await fromCard.boundingBox();
    const dst = await page.getByTestId('board-column-done').boundingBox();
    check('드래그 대상들이 뷰포트 내(데스크톱)', !!src && !!dst && dst.x + dst.width <= 1280 && dst.x >= 0, dst ? `done.x=${Math.round(dst.x)}..${Math.round(dst.x + dst.width)}` : 'no-box');
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + src.width / 2 + 24, src.y + src.height / 2 + 6, { steps: 5 }); // activation distance 6 돌파
    await page.mouse.move(dst.x + dst.width / 2, dst.y + 90, { steps: 16 });
    await page.mouse.move(dst.x + dst.width / 2 + 1, dst.y + 91, { steps: 2 }); // over 재계산 지글
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const movedNow = await page.locator('[data-testid="board-column-done"] [data-testid="board-card-' + cardId + '"]').count();
    check('드래그 → done 컬럼 이동(낙관 PATCH)', movedNow === 1);
    await page.screenshot({ path: shot('07-after-drag') });

    // 영속성: 새로고침 후에도 done 유지
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="session-card"]', { timeout: 15000 });
    await page.getByTestId('board-button').click();
    await page.waitForSelector('[data-testid="board-list"]', { timeout: 10000 });
    await page.locator('[data-testid^="board-open-"]').first().click();
    await page.waitForSelector('[data-testid="board-columns"]', { timeout: 15000 });
    const persisted = await page.locator('[data-testid="board-column-done"] [data-testid="board-card-' + cardId + '"]').count();
    check('새로고침 후 카드 이동 영속', persisted === 1);
    await page.screenshot({ path: shot('08-persistence') });

    // 카드 시트: 편집 → 저장
    await page.getByTestId('board-card-' + cardId).click();
    await page.waitForSelector('[data-testid="card-sheet"]', { timeout: 10000 });
    const sheetText = await page.getByTestId('card-sheet').innerText();
    check('카드 시트 — from-message 표기', sheetText.includes('대화에서 생성'));
    await page.getByTestId('card-assignee-input').fill(' 그림자비서 ');
    await page.getByTestId('card-save').click();
    await page.waitForTimeout(900);
    check('카드 시트 편집 저장(담당 칩)', (await page.locator('[data-testid="board-card-' + cardId + '"]', { hasText: '그림자비서' }).count()) === 1);
    await page.screenshot({ path: shot('09-card-sheet') });

    // 다중 선택 → '볼트로' 일괄 저장 (루트로 리셋 후 세션 재진입 — detail/list 갈래 무시)
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="session-card"]', { timeout: 15000 });
    await page.getByTestId('session-card').first().click();
    await page.waitForSelector('[data-testid="message-agent"]', { timeout: 20000 });
    await page.getByTestId('selection-enter').click();
    await page.getByTestId('selection-toggle-all').click();
    await page.getByTestId('selection-vault').click();
    await page.getByTestId('vault-toast').waitFor({ timeout: 10000 });
    check('다중 선택 → 볼트로 일괄 저장', true);
    await page.screenshot({ path: shot('10-selection-vault') });

    // ── 4) 사용자 구분: 계정 B — A의 데이터 비가시 ──
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const pageB = await ctxB.newPage();
    const errorsB = [];
    pageB.on('pageerror', (e) => errorsB.push(String(e)));
    await signup(pageB, `w2b-${stamp}@myagenttalk.dev`, `w2pwB-${stamp}`);
    await pageB.getByTestId('vault-button').click();
    await pageB.waitForSelector('[data-testid="vault-list"]', { timeout: 10000 });
    const bNotes = await pageB.locator('[data-testid^="vault-note-"]').count();
    const bEmpty = await pageB.getByText('노트가 없습니다').count();
    check('계정 B — A의 노트 안 보임', bEmpty > 0 && bNotes === 0);
    await pageB.screenshot({ path: shot('11-account-b-vault-empty') });
    await pageB.getByTestId('vault-home-back').click();
    await pageB.getByTestId('board-button').click();
    await pageB.waitForSelector('[data-testid="board-list"]', { timeout: 10000 });
    const bBoards = await pageB.locator('[data-testid^="board-open-"]').count();
    const bBoardEmpty = await pageB.getByText('보드가 없습니다').count();
    check('계정 B — A의 보드 안 보임', bBoardEmpty > 0 && bBoards === 0);
    await pageB.screenshot({ path: shot('12-account-b-board-empty') });

    check('A 런타임 예외 없음', errors.length === 0, errors.slice(0, 2).join(' | '));
    check('B 런타임 예외 없음', errorsB.length === 0, errorsB.slice(0, 2).join(' | '));
  } catch (e) {
    failed++;
    console.log('  FAIL  스모크 예외 —', String(e.message).split('\n').slice(0, 4).join(' ⏎ '));
  } finally {
    await browser.close();
  }
  console.log(`\n결과: PASS ${passed} / FAIL ${failed}`);
  process.exitCode = failed ? 1 : 0;
})();