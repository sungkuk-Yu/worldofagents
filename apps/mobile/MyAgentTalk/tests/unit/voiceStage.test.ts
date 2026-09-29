// t_4758f25d — 음성 스테이지 순수 로직 단위 테스트 (lib/voiceStage)
import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceStageHeight, stageReleaseOutcome, chatListPaddingOverride, CHAT_LIST_ANCHOR } from '../../src/lib/voiceStage';

test('voiceStageHeight — 세로 뷰포트 30%, 180~300px 클램프 (#311 strip 높이=패딩)', () => {
  assert.equal(voiceStageHeight(844), 253); // iPhone 14 — 844*0.3
  assert.equal(voiceStageHeight(600), 180); //下限 clamp
  assert.equal(voiceStageHeight(1200), 300); //上限 clamp
  assert.equal(voiceStageHeight(768), 230);
  assert.equal(voiceStageHeight(0), 253); // 비정상 값 → 844 폴백 (PC 중앙 본문과 동일 상수 — t_4b1bd4c2)
  assert.equal(voiceStageHeight(Number.NaN), 253);
});

test('stageReleaseOutcome — 제스처 계약 우선순위 (ack > keyboard > cancel > send)', () => {
  // arm된 끝방향 릴리스 = 예/아니요 발화 (t_043539ff 계승 → t_64e3edd6: ackActive + 좌/우 즉시)
  assert.equal(stageReleaseOutcome({ escaped: false, ackActive: true, gesture: 'DIR_LEFT' }), 'ack');
  // ↑ = 키보드 계층(B) 개방 — 유일한 A→B 전이 (#304)
  assert.equal(stageReleaseOutcome({ escaped: false, ackActive: false, gesture: 'DIR_UP' }), 'keyboard');
  // ↑는 이탈 판정보다 우선
  assert.equal(stageReleaseOutcome({ escaped: true, ackActive: false, gesture: 'DIR_UP' }), 'keyboard');
  // 좌·우·하단 완전 이탈 = 폐기 (#311) — 재질문 비활성 시
  assert.equal(stageReleaseOutcome({ escaped: true, ackActive: false, gesture: 'DIR_RIGHT' }), 'cancel');
  assert.equal(stageReleaseOutcome({ escaped: true, ackActive: false, gesture: 'DIR_DOWN' }), 'cancel');
  assert.equal(stageReleaseOutcome({ escaped: true, ackActive: false, gesture: null }), 'cancel');
  // 제자리 홀드 릴리스 / 탭 = 말하기 전송
  assert.equal(stageReleaseOutcome({ escaped: false, ackActive: false, gesture: null }), 'send');
  assert.equal(stageReleaseOutcome({ escaped: false, ackActive: false, gesture: 'TAP_CENTER' }), 'send');
  // t_64e3edd6 ③: 재질문 비활성 시 좌/우 끝도 평범한 send (음성 = 무확인 진행, #324)
  assert.equal(stageReleaseOutcome({ escaped: false, ackActive: false, gesture: 'DIR_LEFT' }), 'send');
  // 재질문 활성 시에만 좌/우 끝 = ack (arm 타이머 폐지 — 방향 스냅만으로 즉시 판정)
  assert.equal(stageReleaseOutcome({ escaped: false, ackActive: true, gesture: 'DIR_LEFT' }), 'ack');
  assert.equal(stageReleaseOutcome({ escaped: false, ackActive: true, gesture: 'DIR_RIGHT' }), 'ack');
  // ↑/하단 이탈은 ackActive와 무관하게 기존 우선순위 유지 (#324: 좌예우아니오는 예/아니오의 의미만)
  assert.equal(stageReleaseOutcome({ escaped: true, ackActive: true, gesture: 'DIR_UP' }), 'keyboard');
  assert.equal(stageReleaseOutcome({ escaped: true, ackActive: true, gesture: 'DIR_DOWN' }), 'cancel');
  assert.equal(stageReleaseOutcome({ escaped: false, ackActive: true, gesture: 'DIR_DOWN' }), 'send');
});

// t_dee9e982 (대표님 9/29) — 리스트 하단 앵커 계약: 정렬(flex-end)은 항상, 패딩 오버라이드는
// A계층에서만 strip 높이. chatScreenStyles.listContent는 CHAT_LIST_ANCHOR을 스프레드하고
// ChatScreen contentContainerStyle은 chatListPaddingOverride(stageActive, viewportHeight)를 쓴다.
test('CHAT_LIST_ANCHOR — 짧은 히스토리 하단 앵커(정렬 상수) — flexGrow+flex-end 동시', () => {
  assert.equal(CHAT_LIST_ANCHOR.flexGrow, 1); // 박스가 뷰포트까지 성장해야 정렬 여백이 생긴다
  assert.equal(CHAT_LIST_ANCHOR.justifyContent, 'flex-end'); // 여백을 아래로 → 마지막 발화 하단 앵커
  // 콘텐츠 초과 시 flex 규칙상 정렬 여백 0 = 정상 스크롤(상단 절단 없음) — e2e 지오메트리가 회귀 검증.
});

test('chatListPaddingOverride — A계층=strip 높이 패딩 / B계층·비활성=false(통지) — #311 계약', () => {
  assert.deepEqual(chatListPaddingOverride(true, 844), { paddingBottom: 253 }); // = voiceStageHeight
  assert.deepEqual(chatListPaddingOverride(true, 600), { paddingBottom: 180 });
  assert.equal(chatListPaddingOverride(false, 844), false); // B계층(키보드)/PC/데모: 인라인 오버라이드 없음
});
