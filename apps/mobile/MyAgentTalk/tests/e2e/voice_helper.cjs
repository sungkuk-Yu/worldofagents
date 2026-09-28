// t_e735d936 → t_4758f25d: 음성 계층 A(투명 스테이지) / 키보드 계층 B 2계층.
// 채팅 입력이 필요한 스모크/캡처는 이 헬퍼로 A→B 전이(스트립 홀드 후 ↑ 릴리스) 후 접근한다
// (PC/데모 뷰포트에서는 스테이지가 없어 입력창 대기만 수행 — 무해). 제품 코드로 가져오지 않는다.
async function openKeyboardIfVoice(page) {
  // 진입 안착 대기: 스테이지(A, 웹 모바일) 또는 입력창(B/PC) 중 먼저 렌더되는 쪽
  await page.getByTestId('voice-stage').or(page.getByTestId('chat-input')).first().waitFor({ timeout: 20000 });
  if (await page.getByTestId('chat-input').count()) return;
  // A 계층: 홀드 → ↑ 릴리스 = 키보드 개방 (제스처 유일 진입로, #304).
  // 화면 전환(mat-slide) 중이면 strip이 아직 이동 중 → 좌표가 빗나감. hit-test로 안착 확인 후 시도,
  // 실패 시 최대 3회 재시도 (product 코드로 우회하지 않는다).
  for (let attempt = 0; attempt < 3; attempt++) {
    let box = null;
    for (let settle = 0; settle < 20; settle++) {
      box = await page.getByTestId('voice-stage').boundingBox();
      if (!box) break;
      const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return !!el && !!el.closest('[data-testid="voice-stage"]');
      }, [box.x + box.width / 2, box.y + box.height / 2]);
      if (hit) break;
      await page.waitForTimeout(250);
      box = null;
    }
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(cx, cy - i * 20); await page.waitForTimeout(30); }
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
    if (await page.getByTestId('chat-input').count()) return;
    await page.waitForTimeout(400);
  }
  await page.getByTestId('chat-input').waitFor({ timeout: 20000 });
}
// 채팅 화면 진입 대기 — B 계층(chat-input)이든 A 계층(voice-stage)이든 통과.
async function waitForChatEntered(page) {
  await Promise.race([
    page.getByTestId('chat-input').waitFor({ timeout: 20000 }),
    page.getByTestId('voice-stage').waitFor({ timeout: 20000 }),
  ]).catch(() => {});
  const stage0 = await page.getByTestId('voice-stage').count();
  const input0 = await page.getByTestId('chat-input').count();
  if (!stage0 && !input0) {
    // 둘 다 없으면 텍스트 모드의 느린 렌더 — 입력창을 끝까지 대기
    await page.getByTestId('chat-input').waitFor({ timeout: 20000 });
  }
}
// B→A 복귀: 입력바 우측 마이크 탭 (유일한 전이 버튼, #304)
async function backToVoice(page) {
  await page.getByTestId('chat-voice-back').click();
  await page.getByTestId('voice-stage').waitFor({ timeout: 20000 });
}
module.exports = { openKeyboardIfVoice, waitForChatEntered, backToVoice };
