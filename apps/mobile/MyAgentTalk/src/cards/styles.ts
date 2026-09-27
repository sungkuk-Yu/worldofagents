import { StyleSheet, Platform } from 'react-native';
import { colors, radii, shadows, spacing, typography } from '../theme';
export const cardStyles = StyleSheet.create({
  frame: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.sp3, marginBottom: spacing.sp2, minWidth: 0, ...shadows.sh1 },
  // 사용자 메시지 — t_64af90b0 #1 (#59 재확인): 연그린 '색 박스'는 버블처럼 보이므로 극박 회색 밴드 +
  // 좌측 액센트 바 3px만으로 영역 구분 (버블/라벨 금지, 전폭 행 — Slack 레퍼런스).
  userFrame: { backgroundColor: colors.surfaceRaise, borderColor: colors.border, borderWidth: 1, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: radii.md, padding: spacing.sp3, marginBottom: spacing.sp2, minWidth: 0, ...shadows.sh1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sp2, minWidth: 0 },
  body: { ...typography.body, color: colors.text1, flexShrink: 1, minWidth: 0 },
  title: { ...typography.subhead, color: colors.text1, flexShrink: 1, minWidth: 0 },
  micro: { ...typography.micro, color: colors.text3, flexShrink: 1, minWidth: 0 },
  action: { paddingVertical: spacing.sp2, flexShrink: 1, minWidth: 0 },
  actions: { borderTopWidth: 1, borderColor: colors.border, marginTop: spacing.sp2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sp3 },
  link: { ...typography.caption, color: colors.accent, flexShrink: 1 },
  cell: { width: spacing.sp10 * 4, padding: spacing.sp2, borderBottomWidth: 1, borderColor: colors.border },
  // 카드 펼침/접기 (#51) — 웹은 LayoutAnimation no-op이라 CSS transition 폴백 (#52 규칙 6)
  webTransition: Platform.OS === 'web'
    ? { transitionDuration: '260ms', transitionProperty: 'opacity, transform', transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' } as never
    : {},
  expandHandle: { paddingVertical: spacing.sp2, marginTop: spacing.sp1 },
  expandHandleText: { ...typography.caption, color: colors.accent },
  // t_3116c5bc §2 — '전체 읽기' 리더 진입 핸들 (펼침 상태와 독립, 장문 카드 하단)
  readerHandle: { paddingVertical: spacing.sp2, marginTop: spacing.sp1, alignSelf: 'flex-end' },
  // 헤더 행 — 발신자 라벨 + 우측 즐겨찾기 ⭐ 고정 (대표님 지시 9/26)
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2 },
  // t_b250487a — 사용자 밴드 상단 "나" 라벨 라인 (에이전트 작성자 라인과 대칭, 좌우 정렬 아님)
  userLabel: { ...typography.caption, fontWeight: '700', color: colors.text2, marginBottom: spacing.sp1 },
  headerTitle: { flex: 1, minWidth: 0 },
  // t_64af90b0 #3 — 에이전트명 생략 카드: 별은 우상단 고정 유지 (9/26 지시)
  headerSpacer: { flex: 1, minWidth: 0 },
  starTop: { padding: spacing.sp1 },
  starTopText: { fontSize: 16, lineHeight: 20 },
  starTopIdle: { color: colors.text3 },
  starTopActive: { color: colors.accent },
  previewMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sp2, marginTop: spacing.sp1 },
  badge: { ...typography.microSm, color: colors.accent, backgroundColor: colors.surfaceRaise, borderRadius: radii.xs, paddingHorizontal: spacing.sp2, paddingVertical: 2 },
  fallbackJson: { marginTop: spacing.sp2, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.sp2 },
});

