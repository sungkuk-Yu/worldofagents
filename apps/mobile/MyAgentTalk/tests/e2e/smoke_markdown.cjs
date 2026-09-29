/**
 * 채팅 버블 마크다운 e2e 스모크 — t_e9480e0f 백로그①
 * 백엔드 없이 run_c_fixtures 인터셉트로 마크다운/평문/스트리밍 픽스처 렌더 (메모리 최소 토큰 경로, 9/26 교훈).
 * 웹 FlatList 유령/리사이클 주의(9/27 교훈): 검사는 locator 자동 스크롤-인투뷰에 의존하고
 * 개수 검사는 >=1로 느슨하게(뷰포트 밖 행은 언마운트될 수 있다).
 * 검수조항 대응:
 *  ① 마크다운 답변 = 스타일 블록(제목 크기↑/볼드/리스트 마커/표 셀/코드블록 배경+monospace)
 *  ② 마크다운 미사용 답변 = RichText 평문 경로 유지(chat-bubble 승격 없음)
 *  ③ 사용자 발화 버블은 평문(** 리터럴 그대로)
 *  ④ <script> 주입 문자 미interpret + alert 실행 없음 + 페이지 에러 0
 *  ⑤ 스트리밍 partially-valid: 미닫힌 ``` 프리뷰 프레임 렌더 + done 최종 렌더 + run.failed 소멸
 *  ⑥ 코드블록 복제(testID code-copy) 클릭 → 복사됨
 *  ⑦ 표 컨테이너 overflow-x:auto
 * 실행: node tests/e2e/fr-serve.cjs dist-mdgate-t_e9480e0f 8231 &
 *       APP_URL=http://localhost:8231 node tests/e2e/smoke_markdown.cjs
 */
const fs = require('node:fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');

const APP = process.env.APP_URL || 'http://localhost:8231';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'markdown-t_e9480e0f');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const MD = [
  '## 결제 정책 요약',
  '',
  '**환불은 7일 이내** 요청 건만 가능합니다.',
  '',
  '- 카드사 승인 취소',
  '- 부분 환불 불가',
  '',
  '| 항목 | 금액 | 상태 |',
  '| --- | --- | --- |',
  '| 기본 | 1200 | 완료 |',
  '| 확장 | 3400 | 대기 |',
  '',
  '```js',
  'const refundWindow = 7;',
  '```',
].join('\n');

const PLAIN = '결제 정책은 화면 하단 링크에서 확인할 수 있어요. 문의는 [여기](https://example.test/contact) 또는 `support@mat.dev` 로 해주세요.';
// 볼드가 있어 게이트 true → ChatMarkdown 경로. html:false의 raw HTML 미interpret를 이 경로에서 직접 검증.
const HTML_INJECT = '**주의:** <script>alert(1)</script> 와 <img src=x onerror=alert(2)> 는 문자로만 보여야 한다.';
const CODE_UNCLOSED = '## 설치 방법\n\n```bash\ncurl -fsSL https://example.test/install.sh | sh\n\n설명: 위 커맨드를 실행하면 끝.';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  const errors = [];
  // 헤드리스 웹 클립보드: navigator.clipboard.writeText는 권한 컨텍스트 필요(복사 검증 실행 보장).
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      // run_c_fixtures 하네스는 queue/pending/auth-me 엔드포인트를 스텁하지 않는다 → 리소스 404는
      //Baseline 픽스처 한계(기존 스모크 관행: pageerror만 판정). 제품 코드에서 나는 에러만 판정한다.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
    });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    const state = await installFixtures(page);
    state.messages.source = [
      { id: 'um', role: 'user', content: '요약해줘 **굵게** 테스트', turn_index: 0, created_at: '2026-09-29T12:00:00Z' },
      { id: 'am', role: 'agent', content: MD, turn_index: 1, created_at: '2026-09-29T12:00:01Z' },
      { id: 'ap', role: 'agent', content: PLAIN, turn_index: 2, created_at: '2026-09-29T12:00:02Z' },
      { id: 'ahi', role: 'agent', content: HTML_INJECT, turn_index: 3, created_at: '2026-09-29T12:00:03Z' },
      { id: 'ac', role: 'agent', content: CODE_UNCLOSED, turn_index: 4, created_at: '2026-09-29T12:00:04Z' },
    ];
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').first().click();
    await page.getByTestId('message-list').waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);

    // ① 마크다운 버블 + 스타일 블록
    const bubble = page.getByTestId('chat-bubble').first();
    await bubble.waitFor({ timeout: 5000 });
    check('① 에이전트 마크다운 버블 렌더 (chat-bubble)', (await page.getByTestId('chat-bubble').count()) >= 1);
    const bubbleText = await bubble.innerText();
    check('① 제목 텍스트(## 기호 소멸)', bubbleText.includes('결제 정책 요약') && !bubbleText.includes('##'), bubbleText.slice(0, 40));
    const headingBig = await bubble.evaluate((el) => {
      const body = el.ownerDocument.body;
      const nodes = [...el.querySelectorAll('*')].filter((n) => !n.children.length && (n.textContent || '').includes('결제 정책 요약'));
      const h = nodes[0] ? parseFloat(getComputedStyle(nodes[0]).fontSize) : 0;
      const p = [...el.querySelectorAll('*')].find((n) => !n.children.length && (n.textContent || '').includes('요청 건만 가능합니다'));
      return h > (p ? parseFloat(getComputedStyle(p).fontSize) : 14);
    });
    check('① 제목 font-size > 본문', headingBig, '');
    const strongBold = await bubble.evaluate((el) => {
      const n = [...el.querySelectorAll('*')].find((x) => !x.children.length && (x.textContent || '').includes('환불은 7일 이내'));
      return !!n && +getComputedStyle(n).fontWeight >= 700;
    });
    check('① **볼드**가 bold 렌더(별표 소멸)', strongBold && !bubbleText.includes('**환불'), '');
    check('① 리스트 마커 • 렌더', bubbleText.includes('카드사 승인 취소') && bubbleText.includes('•'), '');
    check('① 표 셀 텍스트 렌더(파이프 소멸)', bubbleText.includes('기본') && bubbleText.includes('1200') && !bubbleText.includes('| 기본'), '');

    // ⑦ 표 래퍼 overflow-x:auto
    const tableScroll = page.getByTestId('markdown-table-scroll').first();
    await tableScroll.scrollIntoViewIfNeeded();
    const ox = await tableScroll.evaluate((el) => getComputedStyle(el).overflowX);
    check('⑦ 표 컨테이너 overflow-x:auto', ox === 'auto', ox);

    // ⑥ 코드블록 배경·monospace·복사(testID code-copy)
    const codeBlock = page.getByTestId('markdown-code-block').first();
    await codeBlock.scrollIntoViewIfNeeded();
    const codeStyle = await codeBlock.evaluate((el) => {
      const t = el.querySelector('p, div, span');
      const cs = getComputedStyle(t || el);
      const bg = getComputedStyle(el).backgroundColor;
      return { mono: /mono|Menlo|monospace/i.test(cs.fontFamily), colored: bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' };
    });
    check('⑥ 코드블록 monospace+배경', codeStyle.mono && codeStyle.colored, JSON.stringify(codeStyle));
    const copyBtn = codeBlock.getByTestId('code-copy');
    check('⑥ code-copy 버튼 존재', await copyBtn.isVisible(), '');
    await copyBtn.click();
    await page.waitForTimeout(300);
    const copied = await copyBtn.innerText().catch(() => '');
    check('⑥ 복사 클릭 → 복사됨 피드백', copied.includes('복사됨'), copied);
    // 실제 클립보드 내용 검증: 복사된 텍스트 = 코드블록 본문(정본 복사).
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('⑥ 클립보드 = 코드 본문', clip.includes('const refundWindow = 7;'), clip.slice(0, 40));

    // ⑤ 히스토리 미닫힌 fence: 안전 마감 렌더(``` 리터럴 소멸)
    const fenceBubble = page.locator('[data-testid="chat-bubble"]', { hasText: '위 커맨드를 실행하면 끝' }).first();
    await fenceBubble.scrollIntoViewIfNeeded();
    const fenceText = await fenceBubble.innerText();
    check('⑤′ 히스토리 미닫힌 fence 코드블록 마감 렌더', fenceText.includes('curl -fsSL') && !fenceText.includes('```'), fenceText.slice(0, 50));

    // ④ HTML 주입: 문자로만, 실행 안 됨
    const injBubble = page.locator('[data-testid="chat-bubble"]', { hasText: '문자로만 보여야 한다' }).first();
    await injBubble.scrollIntoViewIfNeeded();
    const injText = await injBubble.innerText();
    check('④ <script> 태그 문자 노출(미해석)', injText.includes('<script>') && injText.includes('onerror'), injText.slice(0, 70));
    check('④ alert/dialog 실행 없음', dialogs.length === 0, dialogs.join(','));

    // ② 평문 답변 = RichText 경로 회귀: chat-bubble 승격 없음 + rich-link 유지
    const plainInBubble = await page.getByTestId('chat-bubble').evaluateAll((els) => els.some((e) => (e.textContent || '').includes('화면 하단 링크에서')));
    check('② 평문 답변은 마크다운 버블로 승격되지 않음', !plainInBubble, '');
    const plainRow = page.getByText('결제 정책은 화면 하단 링크에서').first();
    await plainRow.scrollIntoViewIfNeeded();
    check('② 평문 내 링크는 기존 rich-link 경로', (await page.getByTestId('rich-link').count()) >= 1);

    // ③ 사용자 버블 평문: ** 리터럴 그대로 (마크다운 미적용)
    const userText = await page.getByText('요약해줘 **굵게** 테스트').first().innerText().catch(() => '');
    check('③ 사용자 **굵게** 평문 리터럴 유지', userText.includes('**굵게**'), userText.slice(0, 40));

    await page.screenshot({ path: shot('01-md-history-mobile') });

    // ⑤″ 스트리밍 partially-valid — WS answer.delta: 미닫힌 fence 프레임 → 마지막 chunk로 마감 → done
    let socket = state.sockets.at(-1);
    for (let i = 0; i < 40 && !socket; i++) { await page.waitForTimeout(100); socket = state.sockets.at(-1); }
    if (!socket) check('WS 소켓 미확보 — 스트리밍 검사 스킵', false);
    else {
      const RUN = 'md-stream-1';
      const FULL = '## 실시간 요약\n\n- 항목 **A**\n\n```ts\nconst live = true;\n```';
      const chunks = FULL.match(/[\s\S]{1,12}/g);
      const sendDelta = (i, d) => socket.send(JSON.stringify({ type: 'answer.delta', session_id: 'source', run_id: RUN, index: i, delta: d }));
      // 마지막 chunk('```' 마감분) 직전까지 = 미닫힌 fence 프레임
      for (let i = 0; i < chunks.length - 1; i++) sendDelta(i, chunks[i]);
      const streamBubble = page.getByTestId('chat-bubble-stream').first();
      await streamBubble.waitFor({ timeout: 5000 });
      const midText = await streamBubble.innerText();
      check('⑤″ 스트리밍 중간 프레임 마크다운 렌더(## 소멸)', midText.includes('실시간 요약') && !midText.includes('##'), midText.slice(0, 40));
      check('⑤″ 미닫힌 ``` 프리뷰: fence 리터럴 잔존 없음(임시 마감)', !midText.includes('```') && midText.includes('const live'), midText.slice(-50));
      sendDelta(chunks.length - 1, chunks[chunks.length - 1]);
      socket.send(JSON.stringify({ type: 'answer.done', session_id: 'source', run_id: RUN, text: FULL }));
      await page.waitForTimeout(500);
      const doneText = await streamBubble.innerText().catch(() => '');
      check('⑤″ done 후 최종 텍스트 마크다운 렌더', doneText.includes('const live = true;') && !doneText.includes('```'), doneText.slice(0, 50));
      await page.screenshot({ path: shot('02-streaming') });
      socket.send(JSON.stringify({ type: 'run.failed', session_id: 'source', run_id: RUN }));
      await page.waitForTimeout(300);
      check('⑤″ run.failed 후 스트림 카드 소멸', (await page.getByTestId('chat-bubble-stream').count()) === 0);
    }

    // FlatList 중첩 스크롤: 스크롤 왕복 후 버블 유지 + 에러 0
    await page.getByTestId('message-list').evaluate((el) => el.scrollBy(0, -600)).catch(() => {});
    await page.waitForTimeout(250);
    check('FlatList 스크롤 왕복 후 버블 유지', (await page.getByTestId('chat-bubble').count()) >= 1);

    // PC 1440: 전폭 카드 폭·간격 유지 캡처
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    page2.on('pageerror', (e) => errors.push('pc: ' + String(e)));
    const st2 = await installFixtures(page2);
    st2.messages.source = [{ id: 'am', role: 'agent', content: MD, turn_index: 1, created_at: '2026-09-29T12:00:01Z' }];
    await page2.goto(APP, { waitUntil: 'networkidle' });
    await page2.getByTestId('session-card').first().click();
    await page2.getByTestId('message-list').waitFor({ timeout: 8000 });
    await page2.waitForTimeout(600);
    const b1 = await page2.getByTestId('chat-bubble').first().boundingBox();
    check('PC1440 마크다운 행 전폭 카드 폭 유지', !!b1 && b1.width >= 700, b1 && Math.round(b1.width));
    await page2.screenshot({ path: shot('03-md-pc1440') });

    check('콘솔/pageerror 0 (전 구간)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (err) {
    check('스모크 예외', false, String(err).slice(0, 200));
  } finally {
    await browser.close();
  }
  console.log(`\n=== smoke_markdown: ${passed} PASS / ${failed} FAIL ===`);
  process.exit(failed ? 1 : 0);
})();
