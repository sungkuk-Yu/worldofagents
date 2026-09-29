// 홀드 그랜트 deferred 시작 판정 (t_5058e15f ② — 9/30 라이브 결함 #2 이관분)
// 원인: talk.ready=false(WS subscribe 완료 전, 라이브 DNS+TLS 레이시 ~23s)에서 홀드하면
//       usePushToTalk.startCaptureIfIdle가 early-return → 캡처 조용히 스킵 (r8 스모크는 로컬 수백 ms라 미발현).
// 결정(t_2fa10f11 이관 → frontdev 판단, 대표님 '조용한 실패 금지' 원칙 반영):
//       에러 토스트·폐기 아님 — 홀드는 유지하고 '연결 중' 안내를 띄운 뒤, talk.ready 도달 시
//       캡처를 자동 시작(그랜트 보존). 연결이 끝내 안 되면(릴리스/언마운트/타임아웃) 조용히 취소.
// 이 모듈은 판정만 소유 — 타이머/렌더는 VoiceStage/usePushToTalk.
import { stageReleaseOutcome, StageOutcome } from './voiceStage';
import { JoystickGesture } from '../types';

/** 그랜트 순간 talk 미준비면 안내를 띄우고 홀드를 쥔다(startPending). 준비되면 즉시 시작(captureNow). */
export type HoldGrant = 'captureNow' | 'startPending';
export function holdGrantAction(talkReady: boolean): HoldGrant {
  return talkReady ? 'captureNow' : 'startPending';
}

/**
 * talk.ready 대기 중(pending) 릴리스 판정 (t_5058e15f ②):
 *  - 기본 stageReleaseOutcome 계약 그대로 상속하되 'send'만 'sendAsAbort'로 강등 —
 *    캡처 미시작 발화를 전송으로 위장하지 않는다(무음 전송 금지, 수신키면 토스트 없이 조용한 폐기).
 *  - keyboard/ack/cancel은 캡처 여부와 무관한 경로(텍스트 발화·계층 전환) — 그대로 통과.
 * ready가 홀드 중 도달하면 pending이 꺼지므로 호출부는 정상 send 경로로 재판정한다.
 */
export type PendingRelease = StageOutcome;
export function pendingReleaseAction(opts: {
  escaped: boolean;
  ackActive: boolean;
  gesture: JoystickGesture | null;
}): PendingRelease {
  const base = stageReleaseOutcome(opts);
  return base === 'send' ? 'cancel' : base;
}

/** 연결 대기 상한 — 이 시간 내 talk.ready 미도달 시 안내 종료 + 조용한 취소(서버 안전망에 기대지 않음) */
export const HOLD_CONNECT_WAIT_MS = 20000;
