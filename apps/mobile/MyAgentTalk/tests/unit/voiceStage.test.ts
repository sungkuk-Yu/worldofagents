// t_4758f25d — 음성 스테이지 순수 로직 단위 테스트 (lib/voiceStage)
import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceStageHeight, stageReleaseOutcome } from '../../src/lib/voiceStage';

test('voiceStageHeight — 세로 뷰포트 30%, 180~300px 클램프 (#311 strip 높이=패딩)', () => {
  assert.equal(voiceStageHeight(844), 253); // iPhone 14 — 844*0.3
  assert.equal(voiceStageHeight(600), 180); //下限 clamp
  assert.equal(voiceStageHeight(1200), 300); //上限 clamp
  assert.equal(voiceStageHeight(768), 230);
  assert.equal(voiceStageHeight(0), 253); // 비정상 값 → 844 폴백 (PC 중앙 본문과 동일 상수 — t_4b1bd4c2)
  assert.equal(voiceStageHeight(Number.NaN), 253);
});

test('stageReleaseOutcome — 제스처 계약 우선순위 (ack > keyboard > cancel > send)', () => {
  // arm된 끝방향 릴리스 = 예/아니요 발화 (t_043539ff 계승)
  assert.equal(stageReleaseOutcome({ escaped: false, armedAck: true, gesture: 'DIR_LEFT' }), 'ack');
  // ↑ = 키보드 계층(B) 개방 — 유일한 A→B 전이 (#304)
  assert.equal(stageReleaseOutcome({ escaped: false, armedAck: false, gesture: 'DIR_UP' }), 'keyboard');
  // ↑는 이탈 판정보다 우선 (링 위쪽으로 빠져나가는 동작 = 키보드 의도)
  assert.equal(stageReleaseOutcome({ escaped: true, armedAck: false, gesture: 'DIR_UP' }), 'keyboard');
  // 좌·우·하단 완전 이탈 = 폐기 (#311)
  assert.equal(stageReleaseOutcome({ escaped: true, armedAck: false, gesture: 'DIR_RIGHT' }), 'cancel');
  assert.equal(stageReleaseOutcome({ escaped: true, armedAck: false, gesture: 'DIR_DOWN' }), 'cancel');
  assert.equal(stageReleaseOutcome({ escaped: true, armedAck: false, gesture: null }), 'cancel');
  // 제자리 홀드 릴리스 / 탭 = 말하기 전송
  assert.equal(stageReleaseOutcome({ escaped: false, armedAck: false, gesture: null }), 'send');
  assert.equal(stageReleaseOutcome({ escaped: false, armedAck: false, gesture: 'TAP_CENTER' }), 'send');
  // arm 해제 후(방향 이동) send — armedAck=false 라면 끝방향도 그냥 이탈/전송 판정
  assert.equal(stageReleaseOutcome({ escaped: false, armedAck: false, gesture: 'DIR_LEFT' }), 'send');
});
