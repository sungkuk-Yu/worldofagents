// t_140ecc15 스모크 — '생각 중' 제거 + '진행 중 질문' 전역 큐 입구 (대표님 10/4 지시).
//  ① 라벨 소스(ko/en.json) 값에 '생각|정리하|think' 0건 (라벨 파일 한정)
//  ② queueVis 시드(대기2·멈춤1) → 앱바 배지 주황+빨강 DOM 실측 (색 포함)
//  ③ 해소 스냅샷(WS queue.updated 일괄) → 배지 미노출 (운영 체킹 = 배지 0)
//  ④ 버튼 플로우: PC 1440 = 우측 상시 패널 + 스크롤 앵커 / 390 = 하단 시트(동일 데이터)
//  ⑤ 행 시각화: 대기 순번·앞 질문 상태·멈춤 알약·도착/대기 시간
//  ⑥ 회귀: 현황 트래커/앱바 답글 버튼 무파괴
// 실행: npx expo export --platform web --output-dir dist-qvis --clear
//       node tests/e2e/fr-serve.cjs dist-qvis 8312
//       APP_URL=http://localhost:8312 node tests/e2e/smoke_queue_visibility_t140ecc15.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const APP = process.env.APP_URL || 'http://localhost:8312';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'queue-vis-t140ecc15');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
// 검증 토큰 (한글 리터럴 — 파일 스캐너 마스킹 방지는 read-back assertion으로)
const L = {
  think: '생각',
  organize: '정리하',
  waitingHead: '답변 중+대기 2 · 멈춤 1',
  cleared: '모두 해소',
  titlePc: '진행 중인 질문',
  button: '진행 중인 질문',
  first: '첫 밀림 질문',
  second: '두 번째 밀림 질문',
  stuckRow: '멈춤 질문',
  waitLabel: '앞 질문 답변 중',
  stopped: '멈춤',
  answering: '답변 중',
  arrived: '도착',
  trackerTitle: '내 질문 현황',
  threadsLabel: '답글',
};
assert.equal([L.think, L.organize, L.waitingHead, L.first, L.stuckRow, L.waitLabel].map((s) => s.length).join(','), '2,3,16,7,5,9', '리터럴 read-back 정합');
const WARN_RGB = '217, 119, 6';  // #D97706
const STOP_RGB = '220, 38, 38';  // #DC2626

async function openChat(browser, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = await installFixtures(page, { queueVis: true });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByTestId('session-card').first().click();
  await page.getByTestId('message-list').waitFor({ timeout: 8000 });
  for (let i = 0; i < 60 && !state.sockets.length; i++) await page.waitForTimeout(100);
  await page.getByTestId('queue-open').waitFor({ timeout: 8000 });
  return { ctx, page, state, errors };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  try {
    // ── ① 라벨 소스 grep — ko/en 값에 생각/정리하/think 0건 ──
    {
      const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'i18n', 'locales', f), 'utf8'));
      const flatten = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[p + k, v]] : flatten(v, p + k + '.')));
      for (const f of ['ko.json', 'en.json']) {
        const hits = flatten(read(f)).filter(([, v]) => v.includes(L.think) || v.includes(L.organize) || /think/i.test(v));
        check(`1 ${f} — 생각/정리하/think 라벨 0건`, hits.length === 0, hits.map(([k]) => k).join(','));
      }
      // 시드 사용자 발화 내용 무손상 — 카드 경고 '사용자 메시지 내용까지 손대지 말 것': '정리하는 데'
      // 계열 find-replace가 사용자 스크립트(verify_ack_live 발화)에 미침입임을 실측.
      const ackLive = fs.readFileSync(path.join(__dirname, 'verify_ack_live.cjs'), 'utf8');
      check('1 사용자 발화 내용 무손상(정리하는 데… 미침입)', ackLive.includes('정리하는 데 도와줄래'));
    }

    // ── ②③④⑤⑥ PC 1440 ──
    {
      const { ctx, page, state, errors } = await openChat(browser, { width: 1440, height: 900 });
      const warn = page.getByTestId('queue-badge-warn');
      const stop = page.getByTestId('queue-badge-stop');
      check('2 주황 배지 = 2(답변 중+대기)', (await warn.count()) === 1 && (await warn.innerText()) === '2');
      const warnColor = await warn.evaluate((el) => getComputedStyle(el).color);
      check('2 배지 색 주황(#D97706)', warnColor.includes(WARN_RGB), warnColor);
      check('2 빨강 배지 = 1(멈춤)', (await stop.count()) === 1 && (await stop.innerText()) === '1');
      const stopColor = await stop.evaluate((el) => getComputedStyle(el).color);
      check('2 멈춤 배지 색 빨강(#DC2626)', stopColor.includes(STOP_RGB), stopColor);
      const body = await page.locator('body').innerText();
      check('2 렌더 문구에 생각/정리하 0', !body.includes(L.think) && !body.includes(L.organize));

      await page.getByTestId('queue-open').click();
      await page.getByTestId('queue-backlog-panel').waitFor({ timeout: 5000 });
      const panelText = await page.getByTestId('queue-backlog-panel').innerText();
      check('4 PC 상시 패널 + 스크롤 앵커', panelText.includes(L.titlePc));
      check('4 헤더 카운트 = 답변 중+대기 2 · 멈춤 1', panelText.includes(L.waitingHead), panelText.replace(/\n/g, '|').slice(0, 80));
      check('5 답변 중 행(선두)', (await page.getByTestId('queue-pill-qm1').innerText()) === L.answering);
      const row2 = await page.getByTestId('queue-row-qm2').innerText();
      check('5 대기 행 = 앞 질문 답변 중 + 순번', row2.includes(L.waitLabel) && row2.includes('대기 2번째'), row2.replace(/\n/g, '|').slice(0, 70));
      const row3 = await page.getByTestId('queue-row-qm3').innerText();
      check('5 멈춤 행 = 멈춤 알약 + 도착/대기 시간', row3.includes(L.stopped) && row3.includes(L.arrived), row3.replace(/\n/g, '|').slice(0, 80));
      await page.screenshot({ path: shot('01-pc1440-panel') });

      await page.getByTestId('queue-jump-qm2').click();
      await page.getByTestId('focus-highlight').first().waitFor({ timeout: 5000 });
      check('5 행 탭 → 카드 점프 하이라이트', true);

      state.sockets[0].send(JSON.stringify({
        type: 'queue.updated', session_id: 'source',
        items: [
          { id: 'qi0', content: '답변 완료 질문', status: 'answered', position: 0 },
          { id: 'qi1', content: L.first, status: 'answered', position: 1 },
          { id: 'qi2', content: L.second, status: 'answered', position: 2 },
          { id: 'qi3', content: L.stuckRow, status: 'skipped', position: 3 },
        ],
      }));
      await page.waitForTimeout(400);
      check('3 해소 후 배지 소멸', (await page.getByTestId('queue-badge-warn').count()) === 0 && (await page.getByTestId('queue-badge-stop').count()) === 0);
      const panelAfter = await page.getByTestId('queue-backlog-panel').innerText();
      check('3 패널 = 밀린 0(모두 해소)', panelAfter.includes(L.cleared), panelAfter.replace(/\n/g, '|').slice(0, 60));
      await page.screenshot({ path: shot('02-pc1440-cleared') });

      const shellText = await page.getByTestId('chat-appbar').innerText();
      check('6 앱바 진행 중 질문 라벨 + 답글 버튼 공존', shellText.includes(L.button) && shellText.includes(L.threadsLabel));
      check('6 현황 트래커 패널 무파괴', (await page.getByTestId('question-tracker-panel').count()) === 1);
      check('6 PC에서 시트 미렌더(중복 위젯 금지)', (await page.getByTestId('queue-backlog-modal').count()) === 0);
      check('6 오류 없음', errors.length === 0, errors.join('|').slice(0, 140));
      await ctx.close();
    }

    // ── ④⑤⑥ 모바일 390 ──
    {
      const { ctx, page, state, errors } = await openChat(browser, { width: 390, height: 844 });
      check('4 390 = 상시 패널 미렌더', (await page.getByTestId('queue-backlog-panel').count()) === 0);
      check('4 390 배지 주황2·빨강1', (await page.getByTestId('queue-badge-warn').innerText()) === '2' && (await page.getByTestId('queue-badge-stop').innerText()) === '1');
      await page.getByTestId('queue-open').click();
      await page.getByTestId('queue-backlog-modal').waitFor({ timeout: 5000 });
      const sheet = await page.getByTestId('queue-backlog-modal').innerText();
      check('4 시트 = 동일 데이터(3행+카운트)', [L.first, L.second, L.stuckRow, L.waitingHead].every((s) => sheet.includes(s)));
      await page.screenshot({ path: shot('03-m390-sheet') });
      await page.getByTestId('queue-jump-qm3').click();
      await page.getByTestId('queue-backlog-modal').waitFor({ state: 'detached', timeout: 5000 });
      await page.getByTestId('focus-highlight').first().waitFor({ timeout: 5000 });
      check('4 시트 행 탭 → 닫기+카드 점프', true);

      await page.getByTestId('tracker-open').click();
      await page.getByTestId('tracker-modal').waitFor({ timeout: 5000 });
      check('6 현황 트래커 시트 무파괴', (await page.getByTestId('tracker-modal').innerText()).includes(L.trackerTitle));
      await page.getByTestId('tracker-close').click();
      await page.waitForTimeout(600);

      state.sockets[0].send(JSON.stringify({
        type: 'queue.updated', session_id: 'source',
        items: [
          { id: 'qi1', content: L.first, status: 'answered', position: 1 },
          { id: 'qi2', content: L.second, status: 'answered', position: 2 },
          { id: 'qi3', content: L.stuckRow, status: 'answered', position: 3 },
        ],
      }));
      await page.waitForTimeout(400);
      check('3 390 해소 스냅샷 → 배지 소멸', (await page.getByTestId('queue-badge-warn').count()) === 0);
      check('6 모바일 오류 없음', errors.length === 0, errors.join('|').slice(0, 140));
      await ctx.close();
    }

    console.log(`\nsmoke_queue_visibility: ${passed} PASS / ${failed} FAIL`);
    if (failed > 0) process.exit(1);
  } finally {
    await browser.close();
  }
})();
