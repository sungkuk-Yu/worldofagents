// 음성 스테이지 순수 로직 (t_4758f25d — 대표님 9/28 밤 최종 재스펙 종합)
// 고정 조이스틱 콘솔 폐기 → 수직 2분할: 상부 = 스크롤/탭 영역, 하부 ~30% = 투명 홀드 스트립.
// 이 모듈은 판정만 소유(단위테스트 대상) — 렌더/타이머는 VoiceStage/ChatInputConsole.
// 활성 게이트는 voiceFirstConsole(lib/layout, t_e735d936) 그대로 — 웹 모바일만.
import { JoystickGesture } from '../types';

/** 스트립 높이 = 세로 뷰포트의 30%, 180~300px 클램프. 리스트 하단 패딩과 동일 값(패딩=스트립 실측). */
export function voiceStageHeight(viewportH: number): number {
  const base = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 844;
  return Math.round(Math.min(300, Math.max(180, base * 0.3)));
}

export type StageOutcome = 'keyboard' | 'ack' | 'send' | 'cancel';

/**
 * 릴리스 판정 우선순위 (제스처 계약 불변):
 *  1. 예/아니오 arm된 끝방향 릴리스 → ack (t_043539ff)
 *  2. ↑ → keyboard (B 계층 개방 — 이탈 판정보다 우선: ↑ 이탈은 곧 키보드 구간)
 *  3. 좌·우·하단 완전 이탈 → cancel (발화 폐기)
 *  4. 그 외(탭/제자리 홀드) → send
 */
export function stageReleaseOutcome(opts: {
  escaped: boolean;
  armedAck: boolean;
  gesture: JoystickGesture | null;
}): StageOutcome {
  if (opts.armedAck) return 'ack';
  if (opts.gesture === 'DIR_UP') return 'keyboard';
  if (opts.escaped) return 'cancel';
  return 'send';
}
