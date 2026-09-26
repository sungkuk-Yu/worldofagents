import { StyleSheet, Platform } from 'react-native';
import { colors, radii, spacing, typography } from '../theme';
export const cardStyles = StyleSheet.create({
  frame: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.sp3, marginBottom: spacing.sp2, minWidth: 0 },
  // 사용자 메시지 — 옅은 배경 밴드(연그린 tint) + 좌측 액센트 바로 발신자 구분 (#54 영역 구분, 말풍선 금지).
  // 레퍼런스: Slack 전체폭 행 — 둥근 비대칭 라운드 없음, 사각 계열 radii.md 통일.
  userFrame: { backgroundColor: colors.accentTint, borderColor: colors.border, borderWidth: 1, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: radii.md, padding: spacing.sp3, marginBottom: spacing.sp2, minWidth: 0 },
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
  // 헤더 행 — 발신자 라벨 + 우측 즐겨찾기 ⭐ 고정 (대표님 지시 9/26)
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2 },
  headerTitle: { flex: 1, minWidth: 0 },
  starTop: { padding: spacing.sp1 },
  starTopText: { fontSize: 16, lineHeight: 20 },
  starTopIdle: { color: colors.text3 },
  starTopActive: { color: colors.accent },
  previewMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sp2, marginTop: spacing.sp1 },
  badge: { ...typography.microSm, color: colors.accent, backgroundColor: colors.surfaceRaise, borderRadius: radii.xs, paddingHorizontal: spacing.sp2, paddingVertical: 2 },
  fallbackJson: { marginTop: spacing.sp2, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.sp2 },
});

