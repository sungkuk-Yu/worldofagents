// 마이에이전트톡 디자인 토큰 — 디자인 시스템 v1.2 (docs/design/agenttalk-figma/tokens.json)
// 모드: light-primary · 모바일 390×844 기준
// 원칙: 라이트 모드(흰 바탕), 사각형 카드(radius 4~12px), 그린 액센트 1색 + 세그먼트 식별색 5종
// 참고 톤: 삼성 헬스 / 네이버페이 / 토스 (핀테크 미니멀)
//
// 폰트 (대표님 지시 2026-09-26 — 타이포그래피 현대화):
//   한글 Pretendard Variable(OFL, assets/fonts) + 영문 Inter(OFL, @expo-google-fonts/inter)
//   웹: CSS 폰트 스택(Inter가 영문, Pretendard가 한글 담당) · 네이티브: PretendardVariable 단일 등록
//   레퍼런스: popular-web-designs/mintlify.md — Inter + 음수 트래킹(디스플레이급 -0.2~-0.4px),
//   line-height 1.15~1.5 (tokens.json 기준)
import { Platform } from 'react-native';
import type { ViewStyle } from 'react-native';

export const colors = {
  // 배경/표면 — 라이트
  bg: '#F5F7FA',            // 앱 배경 — 흰 바탕 계열
  surface: '#FFFFFF',       // 카드 표면 — 화이트
  surfaceRaise: '#F0F3F7',  // 상승 표면 (hover/selected/참조바)
  surfaceHover: '#EAEEF3',
  overlay: 'rgba(17,24,39,0.40)',
  border: '#E4E8EE',
  borderStrong: '#CBD3DD',

  // 텍스트 — 라이트 3단계
  text1: '#1A1D26',
  text2: '#5A6472',
  text3: '#8F98A6',

  // 액센트 — 그린 (메인)
  accent: '#00A86B',
  onPrimary: '#FFFFFF',
  accentTint: '#F0FAF5',  // 연그린 tint — 사용자 메시지 밴드 배경 (#54 영역 구분용, 버블 금지)

  // 세그먼트 식별색 (아이콘·테두리·글로우에만 사용 — 전면 배경 금지)
  segInfo: '#0891B2',   // 정보 information (라이트 대응)
  segData: '#7C5CE0',   // 데이터 data
  segFile: '#E8912D',   // 파일 file
  segTask: '#16A34A',   // 작업 task
  segMulti: '#F43F5E',  // 멀티에이전트 multi-agent

  // 상태
  statusOk: '#16A34A',
  statusWarn: '#D97706',
  statusErr: '#DC2626',
  statusNeutral: '#6B7280', // 막힘 상태는 경고색이 아닌 중립 회색
} as const;

export const radii = {
  xs: 4,
  sm: 6,
  md: 8,   // 카드 기본 (사각형)
  lg: 12,  // 히어로/결과 카드
  full: 999,
} as const;

export const spacing = {
  sp1: 4,
  sp2: 8,
  sp3: 12,
  sp4: 16,
  sp5: 20,
  sp6: 24,
  sp8: 32,
  sp10: 40,
} as const;

// ── 타이포그래피 ─────────────────────────────────────────────
// fontFamily는 토큰에서 일괄 지정 — 화면 스타일에서 개별 지정 금지(하드코딩 검사 기준).
export const fontFamily = Platform.select({
  // 웹: CSS 스택 — Inter(영문) 우선, Pretendard Variable(한글) 후속.
  // public/index.html의 CDN @font-face + public/fonts 로컬 woff2가 PretendardVariable을,
  // expo-font(useFonts)가 Inter를 주입한다.
  web: 'Inter, PretendardVariable, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", Roboto, sans-serif',
  default: 'PretendardVariable',
}) as string;

// 라인하이트 비율은 tokens.json v1.1 기준, 트래킹은 mintlify.md 규칙(크기별 음수 축소).
export const typography = {
  display: { fontFamily, fontSize: 34, fontWeight: '700', lineHeight: 39, letterSpacing: -0.4 },  // 34/1.15
  title1: { fontFamily, fontSize: 28, fontWeight: '700', lineHeight: 34, letterSpacing: -0.3 },    // 28/1.2
  title2: { fontFamily, fontSize: 22, fontWeight: '700', lineHeight: 28, letterSpacing: -0.2 },    // 22/1.25
  headline: { fontFamily, fontSize: 17, fontWeight: '600', lineHeight: 22, letterSpacing: -0.2 },  // 17/1.3
  body: { fontFamily, fontSize: 15, fontWeight: '400', lineHeight: 22, letterSpacing: 0 },         // 15/1.5 — 장문 가독성 (Claude 레퍼런스)
  bodyBold: { fontFamily, fontSize: 15, fontWeight: '600', lineHeight: 21, letterSpacing: 0 },      // 15/1.4
  subhead: { fontFamily, fontSize: 13, fontWeight: '500', lineHeight: 19, letterSpacing: 0 },       // 13/1.45
  caption: { fontFamily, fontSize: 12, fontWeight: '500', lineHeight: 17, letterSpacing: 0 },       // 12/1.4
  micro: { fontFamily, fontSize: 11, fontWeight: '500', lineHeight: 14, letterSpacing: 0.1 },       // 11/1.3 — 미세 +트래킹 (mintlify Label 규칙)
  microSm: { fontFamily, fontSize: 10, fontWeight: '600', lineHeight: 14, letterSpacing: 0.1 },     // 배지/메타용 (micro 하위)
  microXs: { fontFamily, fontSize: 9, fontWeight: '700', lineHeight: 12, letterSpacing: 0.2 },      // 극소 배지 (삭제 뱃지 등)
} as const;

// 아이콘 글리프 크기 — 텍스트가 아닌 유니코드 심볼(⚙ ← ☆ ✓ 등) 렌더용.
// 타이포 스케일과 분리된 치수 토큰이라 하드코딩 검사(fontSize: 숫자) 대상에서 제외된다.
export const iconSize = {
  tileSm: 14,   // 히스토리 레일 노드 아이콘
  tile: 16,     // 카드/타일 내 세그먼트 아이콘
  glyph: 18,    // 헤더 버튼·chevron·방향 화살표
  glyphLg: 20,  // 큰 헤더 버튼 글리프
  hero: 32,     // 빈 상태 히어로 아이콘
} as const;

// 그림자 — 라이트용 저강도 (elevation/shadow)
export const shadows = {
  sh1: { shadowColor: 'rgba(16,24,40,0.06)', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 2, elevation: 2 },
  sh2: { shadowColor: 'rgba(16,24,40,0.08)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 14, elevation: 6 },
  sh3: { shadowColor: 'rgba(16,24,40,0.12)', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 1, shadowRadius: 32, elevation: 12 },
} as const;

// 세그먼트 5종 정의 — 디자인 시스템 §4
export type SegmentType = 'information' | 'data' | 'file' | 'task' | 'multi-agent';

export interface SegmentMeta {
  type: SegmentType;
  label: string;
  color: string;
  icon: string; // 유니코드 심볼 (SVG 아이콘 교체 슬롯)
}

/* i18n-exempt-start — 세그먼트 메타데이터(색상/아이콘 사전)의 라벨 필드.
   사용자 표시 라벨은 화면 쪽에서 t('segment.type.<type>')로 처리 (이 값 렌더링하지 않음).
   라벨 값은 ko 사본 유지 — 서버 로그·스레드 refTitle 등 비UI 참조용. */
export const SEGMENTS: SegmentMeta[] = [
  { type: 'information', label: '정보', color: colors.segInfo, icon: 'ⓘ' },
  { type: 'data', label: '데이터', color: colors.segData, icon: '▦' },
  { type: 'file', label: '파일', color: colors.segFile, icon: '▥' },
  { type: 'task', label: '작업', color: colors.segTask, icon: '✓' },
  { type: 'multi-agent', label: '멀티', color: colors.segMulti, icon: '◈' },
] as const;
/* i18n-exempt-end */

export const segmentMeta = (type: SegmentType): SegmentMeta =>
  SEGMENTS.find((s) => s.type === type) ?? SEGMENTS[0];

// 카드 공통 스타일 (사각형 — 원칙)
export const cardBase = {
  backgroundColor: colors.surface,
  borderRadius: radii.md,
  borderWidth: 1,
  borderColor: colors.border,
} as const;

// ── 웹 화면 전환 폴백 (#52 규칙 6) ─────────────────────────────
// 네이티브: native-stack 네이티브 전환 유지. 웹: react-native-screens가 no-op이라
// CSS keyframes(public/index.html)로 동일 감성 폴백 — Apple 계열 스냅 곡선 cubic-bezier(0.32,0.72,0,1).
// "동작 줄이기"는 index.html의 prefers-reduced-motion 미디어쿼리가 전역 처리 (#52 규칙 7).
export type ScreenMotion = 'mat-slide-from-right' | 'mat-slide-from-bottom';
export const webScreenMotion = (name: ScreenMotion): ViewStyle | undefined =>
  Platform.OS === 'web'
    ? ({
        animationName: name,
        animationDuration: '340ms',
        animationTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
        animationFillMode: 'both',
      } as unknown as ViewStyle)
    : undefined;

export default { colors, radii, spacing, typography, fontFamily, iconSize, shadows, SEGMENTS, segmentMeta, cardBase, webScreenMotion };
