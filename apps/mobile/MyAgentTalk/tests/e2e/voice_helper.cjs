// t_e735d936: 음성 우선 — 웹 모바일 채팅 진입 시 입력창은 2차 UI(키보드 계층)다.
// 채팅 입력이 필요한 스모크/캡처는 이 헬퍼로 콘솔→키보드 전환 후 접근한다
// (PC/데모 뷰포트에서는 키보드 버튼이 없어 대기만 수행 — 무해). 제품 코드로 가져오지 않는다.
async function openKeyboardIfVoice(page) {
  // 진입 안착 대기: 콘솔(음성 우선) 또는 입력창(텍스트 모드) 중 먼저 렌더되는 쪽
  await page.getByTestId('chat-voice-console').or(page.getByTestId('chat-input')).first().waitFor({ timeout: 20000 });
  const kb = page.getByTestId('chat-keyboard-button');
  if (await kb.count()) await kb.click();
  await page.getByTestId('chat-input').waitFor({ timeout: 20000 });
}
// 채팅 화면 진입 대기 — 텍스트 모드(chat-input)든 음성 우선 모드(chat-voice-console)든 통과.
async function waitForChatEntered(page) {
  await Promise.race([
    page.getByTestId('chat-input').waitFor({ timeout: 20000 }),
    page.getByTestId('chat-voice-console').waitFor({ timeout: 20000 }),
  ]).catch(() => {});
  const console0 = await page.getByTestId('chat-voice-console').count();
  const input0 = await page.getByTestId('chat-input').count();
  if (!console0 && !input0) {
    // 둘 다 없으면 텍스트 모드의 느린 렌더 — 입력창을 끝까지 대기
    await page.getByTestId('chat-input').waitFor({ timeout: 20000 });
  }
}
module.exports = { openKeyboardIfVoice, waitForChatEntered };
