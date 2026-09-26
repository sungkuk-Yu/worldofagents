// 마이에이전트톡 디자인 토큰 — 디자인 시스템 v1.1 (docs/design/agenttalk-figma/tokens.json)
// 모드: light-primary · 모바일 390×844 기준
// 원칙: 라이트 모드(흰 바탕), 사각형 카드(radius 4~12px), 그린 액센트 1색 + 세그먼트 식별색 5종
// 참고 톤: 삼성 헬스 / 네이버페이 / 토스 (핀테크 미니멀)

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

// 타이포그래피 (SF Pro / Pretendard 계열)
export const typography = {
  display: { fontSize: 34, fontWeight: '700', lineHeight: 40 },
  title1: { fontSize: 28, fontWeight: '700', lineHeight: 34 },
  title2: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  headline: { fontSize: 17, fontWeight: '600', lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  bodyBold: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  subhead: { fontSize: 13, fontWeight: '500', lineHeight: 19 },
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  micro: { fontSize: 11, fontWeight: '500', lineHeight: 14 },
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

export const SEGMENTS: SegmentMeta[] = [
  { type: 'information', label: '정보', color: colors.segInfo, icon: 'ⓘ' },
  { type: 'data', label: '데이터', color: colors.segData, icon: '▦' },
  { type: 'file', label: '파일', color: colors.segFile, icon: '▥' },
  { type: 'task', label: '작업', color: colors.segTask, icon: '✓' },
  { type: 'multi-agent', label: '멀티', color: colors.segMulti, icon: '◈' },
] as const;

export const segmentMeta = (type: SegmentType): SegmentMeta =>
  SEGMENTS.find((s) => s.type === type) ?? SEGMENTS[0];

// 카드 공통 스타일 (사각형 — 원칙)
export const cardBase = {
  backgroundColor: colors.surface,
  borderRadius: radii.md,
  borderWidth: 1,
  borderColor: colors.border,
} as const;

export default { colors, radii, spacing, typography, shadows, SEGMENTS, segmentMeta, cardBase };