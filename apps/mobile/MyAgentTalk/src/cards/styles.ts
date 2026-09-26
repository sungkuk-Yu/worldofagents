import { StyleSheet } from 'react-native';
import { colors, radii, spacing, typography } from '../theme';
export const cardStyles = StyleSheet.create({
  frame: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.sp3, marginBottom: spacing.sp2, minWidth: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sp2, minWidth: 0 },
  body: { ...typography.body, color: colors.text1, flexShrink: 1, minWidth: 0 },
  title: { ...typography.subhead, color: colors.text1, flexShrink: 1, minWidth: 0 },
  micro: { ...typography.micro, color: colors.text3, flexShrink: 1, minWidth: 0 },
  action: { paddingVertical: spacing.sp2, flexShrink: 1, minWidth: 0 },
  actions: { borderTopWidth: 1, borderColor: colors.border, marginTop: spacing.sp2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sp3 },
  link: { ...typography.caption, color: colors.accent, flexShrink: 1 },
  cell: { width: spacing.sp10 * 4, padding: spacing.sp2, borderBottomWidth: 1, borderColor: colors.border },
});
