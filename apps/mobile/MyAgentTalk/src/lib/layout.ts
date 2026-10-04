// 반응형 2트랙 레이아웃 — 순수 로직 (카드 t_eded715c 요구 1: 단위테스트 대상)
// 모바일(<768) = 기존 단일 컬럼 / PC(≥768) = 3패널(사이드바 + 채팅 + 컨텍스트 패널).
// 태블릿(768~1100)은 2패널(사이드바 + 채팅, 컨텍스트 패널은 채팅 폭 확보 후 잔여에 표시 —
// 알리바바 미로 금지: 패널은 상시 노출, 접기 제스처 없음. 좁으면 컨텍스트를 우측에서 아래로 내리지
// 않고 아예 렌더 제외하지 않고 최소 폭으로 유지한다.)
export const PC_BREAKPOINT = 768;
/** 3패널 완본 최소 폭 — t_00fe9b0f(대표님 10/4 3-팬 최종 정의): ≥1024 = 좌(새프로젝트 레일)+중(메인
 *  스트림)+우(쓰레드 카드). 미만이면 2패널(좌 ThreadRail+채팅, 우측 패널은 현황 시트로 대체). */
export const WIDE_BREAKPOINT = 1024;
/** ≥1280: 우측 컨텍스트 패널(질문 트래커/즐겨찾기/카드 인스펙터, t_fd869e5b) 추가 — 1024~1279는
 *  사이드체인 패널 1개만(4컬럼 980px 고정 폭이면 채팅이 파묻힌다 — 미로 대신 압사 방지). */
export const CONTEXT_BREAKPOINT = 1280;

/** 사이드바(세션목록)/컨텍스트 패널 폭 — 고정, 알리바바 미로 금지 원칙상 리사이즈 핸들 없음 */
export const SIDEBAR_WIDTH = 300;
export const CONTEXT_WIDTH = 340;

export type LayoutMode = 'mobile' | 'pc' | 'pc-wide';

/** 창 폭 → 레이아웃 모드. 경계: 768 이상부터 PC(PC_BREAKPOINT 포함), 1100 이상부터 3패널. */
export function layoutModeForWidth(width: number): LayoutMode {
  if (!Number.isFinite(width) || width < PC_BREAKPOINT) return 'mobile';
  return width >= WIDE_BREAKPOINT ? 'pc-wide' : 'pc';
}

export const isPcLayout = (mode: LayoutMode): boolean => mode !== 'mobile';

/** PC 모드에서 현재 라우트(중앙 영역)가 대화목록일 때 본문을 이어보기 홈으로 대체할지 */
export const shouldShowResumeHome = (mode: LayoutMode, routeName: string | null): boolean =>
  isPcLayout(mode) && routeName === 'DialogueList';

/**
 * PC 중앙 본문 최대 읽기 폭 — 1440 이상에서 채팅 본문이 광대한 여백 없이 중앙에 앉는다.
 * (디자인 시스템: 본문 가독 폭 ≤900px, 그 외는 좌우 여백)
 */
export function bodyMaxWidth(width: number): number | undefined {
  return width >= 1440 ? 900 : undefined;
}

// ── t_e735d936 요구 1: 음성 우선 — 채팅 진입 기본 UI 판정 (pure, 단위테스트 대상) ──
// 대표님 9/28 새벽 슛: "일단 음성기능이 먼저 떠주고". 웹 모바일(터치 소형 화면) 채팅 진입 시
// 텍스트 입력창 대신 음성 콘솔(조이스틱 디스크)이 기본이고, 입력창은 키보드를 열었을 때만
// 나타나는 2차 UI로 강등된다. PC 레이아웃(≥768)과 네이티브는 기존 텍스트 채팅 유지 —
// PC엔 가상 키보드가 없어 입력창 상시가 곧 1차 UI이고, 네이티브는 웹 PTT 경로가 아니기 때문.
// demo 모드면 음성 콘솔 금지 — 녹음 제스처가 데모 세션(캐리어 ready=false)에서 무의미한
// 권한 다이얼로그만 부르므로 텍스트 진입이 폴백이다.
export function voiceFirstConsole(opts: { os: string; width: number; isDemo: boolean }): boolean {
  if (opts.os !== 'web' || opts.isDemo) return false;
  return !isPcLayout(layoutModeForWidth(opts.width));
}
