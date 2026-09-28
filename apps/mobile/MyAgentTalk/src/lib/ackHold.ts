// 조이스틱 끝방향 홀드 → 예/아니요 발화 (t_043539ff, 대표님 9/28 코멘트 #233 차선안 병행 확정)
// 순수 판정 로직 — UI(ChatVoiceConsole)는 타이머/렌더만 소유, 의미 결정은 여기서.
// 계약:
//   - 조이스틱 홀드 중 좌/우 끝방향(DIR_LEFT/DIR_RIGHT — 엔진 8방향 스냅 콘 자체가 '끝' 각도)을
//     ACK_HOLD_MS(800ms) 유지하면 'arm' → 하단 배너에 예/아니요 표시 → 놓으면 해당 문장 전송.
//   - arm 후 다른 방향(예: DIR_UP)으로 옮기면 해제 — ↑올리기는 기존 폐기+키보드 경로 그대로.
//   - 홀드 없는 얕은 좌우 스와이프(<800ms)는 arm되지 않아 기존 커스텀 매핑(actionFor) 경로 유지 →
//     ↑ 전용 매핑과 충돌 없음(카드 #2 요구).
//   - 전송 텍스트는 칩과 동일 계약(백엔드 isConfirmationUtterance 부분일치 금지 집합과 완전 일치).
import type { JoystickGesture } from '../types';

export const ACK_HOLD_MS = 800;

/** 끝방향 → 확인 문장 키 (lib/i18n: chat.ackYes / chat.ackNo) */
export function ackPhraseForDirection(gesture: JoystickGesture | null): 'yes' | 'no' | null {
  if (gesture === 'DIR_LEFT') return 'yes';
  if (gesture === 'DIR_RIGHT') return 'no';
  return null;
}

/** arm 유지 판정 — 무장된 방향과 릴리스 시점의 최종 방향이 같아야 발화 전송 */
export function resolveArmedAck(armedDirection: JoystickGesture | null, releaseDirection: JoystickGesture | null): 'yes' | 'no' | null {
  const phrase = ackPhraseForDirection(armedDirection);
  return phrase && armedDirection === releaseDirection ? phrase : null;
}
