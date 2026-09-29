// 조이스틱 끝방향 → 예/아니요 발화 판정 (t_043539ff 출발 → t_64e3edd6 9/29 개정)
// t_64e3edd6 (대표님 9/29): 0.8s arm 유지 타이머 폐지 — 재질문 버튼 행이 활성인 동안
//   좌/우 끝방향으로 스냅된 상태에서 릴리스하면 즉시 해당 문장 전송 (stageReleaseOutcome의 ackActive 게이트).
//   발동 조건(재질문 활성)은 VoiceStage/화면 소유, 이 모듈은 방향→문장 대응만 순수 판정.
// 계약:
//   - 왼쪽 = 예(DIR_LEFT), 오른쪽 = 아니요(DIR_RIGHT) — t_64e3edd6 ③ "왼쪽은 예, 오른쪽은 아니오".
//   - ↑ = 키보드, 좌·우·하단 링 이탈 = 폐기 — 기존 제스처 계약 유지.
//   - 전송 텍스트는 칩과 동일 계약(백엔드 isConfirmationUtterance 부분일치 금지 집합과 완전 일치).
import type { JoystickGesture } from '../types';

/** 끝방향 → 확인 문장 키 (lib/i18n: chat.ackYes / chat.ackNo) */
export function ackPhraseForDirection(gesture: JoystickGesture | null): 'yes' | 'no' | null {
  if (gesture === 'DIR_LEFT') return 'yes';
  if (gesture === 'DIR_RIGHT') return 'no';
  return null;
}
