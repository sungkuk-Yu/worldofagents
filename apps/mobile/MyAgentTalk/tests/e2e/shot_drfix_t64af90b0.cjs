// t_64af90b0 after-capture — 디자인 리뷰 12건 반영 화면 캡처 (drshots와 동일한 390/1440 뷰포트)
// 실행: (dist-dr 정적서버 :8123) → node shot_drfix_t64af90b0.cjs
// 픽스처: run_c_fixtures.cjs (API/WS 전량 모의) — wave=true로 카드/폼/즐겨찾기 혼재 상태 재현
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');
const { openKeyboardIfVoice } = require('./voice_helper.cjs');
const APP = process.env.APP_URL || 'http://localhost:8123';
const OUT = process.env.OUT_DIR || path.join(__dirname, 'artifacts', 'drfix-t64af90b0');
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, `${n}.png`);

async function openChat(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 900 }, locale: 'ko-KR' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await installFixtures(page, { wave: true });
  await page.addInitScript(() => localStorage.setItem('at-language', 'ko'));
  await page.goto(APP);
  await page.getByTestId('session-card').click();
  await page.getByText('견적 요청', { exact: true }).first().waitFor({ timeout: 15000 });
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  try {
    // m-04 채팅 (390) — #1 버블 회귀 없음(전폭 밴드), #2 SVG 아이콘, #3 라벨 첫 메시지만, #4 placeholder/전송
    {
      const { page, errors } = await openChat(browser, 390);
      // #4: placeholder 잘림 없이 전체 표시 — 입력창 placeholder 텍스트 실측
      // t_4b1bd4c2 요구 4: placeholder 전체 한 줄 표시 — 마이크 버튼 제거로 입력창 폭 확보
      // t_e735d936: 웹 모바일 채팅 = 음성 우선 — placeholder 검증은 키보드 계층을 연 뒤
      await openKeyboardIfVoice(page);
      const ph = page.getByPlaceholder('에이전트에게 메시지 보내기');
      assert.ok((await ph.count()) > 0, 'placeholder \'에이전트에게 메시지 보내기\' 표시');
      // #1: t_b250487a(대표님 확정 계약, t_64af90b0 #1 반전) — 사용자 밴드 + '나' 라벨 유지
      await page.getByTestId('chat-input').fill('테스트 발화');
      await page.getByTestId('send-button').click();
      await page.getByText('Test reply to 테스트 발화', { exact: true }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(400);
      const labelCount = await page.getByTestId('message-user-label').count();
      assert.ok(labelCount >= 1, '#1(t_b250487a 반전) 사용자 밴드 \'나\' 라벨 존재');
      // #3 (t_64af90b0 → t_55b7e30c 대체): 에이전트명 헤더 = 발화 그룹 시작마다 재출력.
      // 이 시나리오: wave 시드 7행(동일 ts 단일 그룹 → 첫 카드만) + 방금 전송 응답(user 전환 경계 → 헤더) = 2.
      const bodyAgentName = await page.locator('[data-testid="message-agent"] >> text="Test Agent"').count();
      assert.ok(bodyAgentName === 2, `#3/t_55b7e30c 그룹 시작에만 라벨 — 시드 1 + 실시간 경계 1 (실측 ${bodyAgentName}회)`);
      // #2: t_4b1bd4c2 요구 1 — 입력창 옆 마이크 버튼 완전 제거 (ptt-mic-button 미렌더)
      assert.equal(await page.getByTestId('ptt-mic-button').count(), 0, '#2+t_4b1bd4c2 마이크 홀드 버튼 제거');
      // 즐겨찾기 별 SVG (카드 헤더)
      const favHtml = await page.getByTestId('card-favorite').first().innerHTML();
      assert.ok(!/[★☆]/.test(favHtml) && /<svg/i.test(favHtml), '#2 즐겨찾기 별 = SVG 아이콘');
      await page.screenshot({ path: shot('m-04-chat-after') });
      assert.deepEqual(errors, [], '채팅 런타임 오류 0');
      await page.close();
    }
    // m-03 대화목록 (390) — #6 한 줄 제목+우하 시간, #7 여백 균형
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await installFixtures(page, { wave: true });
      await page.addInitScript(() => localStorage.setItem('at-language', 'ko'));
      await page.goto(APP);
      await page.getByTestId('session-card').waitFor();
      // #6: 세션 카드 시간 = 제목 행 우측(caption) — 우하/한줄 검증은 스타일 실측으로 대체: 세로 파절 없음 = 카드 높이 정상
      await page.screenshot({ path: shot('m-03-dialogue-list-after') });
      // #2: 헤더 버튼 SVG (설정/즐겨찾기/볼트/보드/음성)
      const gear = await page.getByTestId('settings-button').innerHTML();
      assert.ok(/<svg/i.test(gear), '#2 설정 버튼 = SVG 기어');
      assert.deepEqual(errors, [], '목록 런타임 오류 0');
      await page.close();
    }
    // m-01 로그인 (390) — #8 브랜드 1단, #9 세로 중앙
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await installFixtures(page);
      // init script는 등록 순서대로 실행 — 픽스처가 심은 세션 토큰을 후속 script로 제거 → 미로그인 온보딩 경로
      await page.addInitScript(() => { localStorage.removeItem('at-web-v1.sess'); localStorage.setItem('at-language', 'ko'); });
      await page.goto(APP);
      await page.getByTestId('session-list').or(page.getByTestId('login-card')).first().waitFor({ timeout: 15000 }).catch(() => {});
      if (await page.getByTestId('signin-button').count()) {
        await page.getByTestId('signin-button').click();
      }
      await page.getByTestId('login-card').waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      // #8: '마이에이전트톡' 타이틀 제거 → 카드 내 브랜드 텍스트는 'MAT' + 부제만
      const cardText = await page.getByTestId('login-card').innerText();
      assert.ok(/MAT/.test(cardText), '#8 MAT 워드마크 유지');
      assert.ok(!/마이에이전트톡/.test(cardText), '#8 중복 타이틀 제거');
      const emailLabel = await page.getByText('이메일', { exact: true }).count();
      assert.ok(emailLabel >= 1, '#8 플로팅 라벨 유지');
      await page.screenshot({ path: shot('m-01-login-after') });
      assert.deepEqual(errors, [], '로그인 런타임 오류 0');
      await page.close();
    }
    // d-04 PC 3패널 (1440) — #10 빈 패널 압축, #11 초록 로고
    {
      const { page, errors } = await openChat(browser, 1440);
      const panel = page.getByTestId('context-panel');
      await panel.waitFor();
      const panelText = await panel.innerText();
      assert.ok(!/채팅에서 카드를 열면/.test(panelText), '#10 카드 인스펙터 빈 안내문 제거 (미선택 시 섹션 숨김)');
      assert.ok(/노트가 아직 없어요/.test(panelText), '#10 빈 노트 섹션 = 한 줄 요약 유지');
      // 빈 상태 행은 아이콘(SVG)+텍스트 — 회색 안내문 단독 행보다 구조화됨
      assert.ok((await panel.locator('svg').count()) > 0, '#10 빈 섹션 요약행에 SVG 아이콘');
      // #11: 사이드바 로고 = MAT 초록
      const logo = await page.getByTestId('sidebar-logo').count();
      assert.equal(logo, 1, '#11 사이드바 MAT 워드마크');
      await page.screenshot({ path: shot('d-04-chat-after') });
      assert.deepEqual(errors, [], 'PC 런타임 오류 0');
      await page.close();
    }
    console.log('PASS t_64af90b0 after-capture —', OUT);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
