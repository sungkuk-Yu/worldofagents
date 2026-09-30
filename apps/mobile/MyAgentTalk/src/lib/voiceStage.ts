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

/**
 * t_dee9e982: 채팅 리스트 contentContainer 하단 패딩 오버라이드 (앵커 로직의 padding 축).
 * 정렬(justifyContent:'flex-end')은 styles.listContent 상수 — 짧은 히스토리는 하단 앵커,
 * 긴 히스토리는 플렉스 규칙상 정렬이 무의미해져 정상 스크롤. 패딩만 A계층에서 strip 높이로
 * 부풀어 마지막 줄이 스트립에 가려지지 않게 한다(#311 계약). B계층/비활성 = false(통지 기본).
 */
export function chatListPaddingOverride(stageActive: boolean, viewportH: number): { paddingBottom: number } | false {
  return stageActive ? { paddingBottom: voiceStageHeight(viewportH) } : false;
}

/**
 * t_dee9e982 (대표님 9/29): 짧은 히스토리 하단 앵커 — 리스트 contentContainer 정렬의 단일 원천.
 * flexGrow:1이 뷰포트까지 채우고 justifyContent:flex-end가 남은 여백을 아래로 밀어 마지막 발화가
 * 입력 스테이지 위 하단에 붙는다. 콘텐츠가 초과하면 박스 높이=콘텐츠 높이로 정렬 여백이 사라져
 * 정상 스크롤(상단 절단 없음) — CSS 플렉스 규약상 안전. chatScreenStyles.listContent가 스프레드.
 */
export const CHAT_LIST_ANCHOR = {
  flexGrow: 1,
  justifyContent: 'flex-end',
} as const;

/**
 * t_2eea055a (대표님 9/30 "녹음할때 텔레그램처럼 녹음 시간 보여줘야되"):
 * 경과/길이 ms → 'M:SS' (텔레그램 표기 규범: 분은 zero-pad 하지 않는다 — '0:05', '1:05', '10:00').
 * NaN/음수/미숫 = '0:00'. 초 단위로 반올림하지 않고 절삭(카운터가 릴리스 표시값과 역주행하지 않게).
 */
export function formatRecordingDuration(ms: unknown): string {
  const v = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const totalSec = Math.floor(v / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type StageOutcome = 'keyboard' | 'ack' | 'send' | 'cancel';

/**
 * 릴리스 판정 우선순위 (t_64e3edd6 9/29 #324 개정):
 *  1. 재질문 버튼 행 활성(ackActive) + 좌/우 끝방향 릴리스 → ack (좌=예, 우=아니요 — 0.8s arm 폐지, 즉시)
 *  2. ↑ → keyboard (B 계층 개방 — 이탈 판정보다 우선: ↑ 이탈은 곧 키보드 구간)
 *  3. 좌·우·하단 완전 이탈 → cancel (발화 폐기)
 *  4. 그 외(탭/제자리/좌우 홀드 — 재질문 비활성 시) → send (음성 = 무확인 진행, 전사→즉시 답변)
 */
export function stageReleaseOutcome(opts: {
  escaped: boolean;
  /** 공감 재질문 예/아니요 버튼 행이 화면에 활성일 때만 좌/우 ack 게이트 발동 (#325) */
  ackActive: boolean;
  gesture: JoystickGesture | null;
}): StageOutcome {
  if (opts.ackActive && (opts.gesture === 'DIR_LEFT' || opts.gesture === 'DIR_RIGHT')) return 'ack';
  if (opts.gesture === 'DIR_UP') return 'keyboard';
  if (opts.escaped) return 'cancel';
  return 'send';
}
