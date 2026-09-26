// 가입 동의 게이트 — 대표님 지시 레이아웃 (김비서 코멘트 #48 → 9/26 후퇴 반영):
//   ① 전체 동의 = 분리된 강조 블록(divider 위아래) ② 필수 개별 항목 목록
//   ③ 선택 동의(마케팅) = 맨 아래 + 저대비 caption·미노출에 가까움 (opt-in — 개인정보보호법 제22조 선택 동의).
//   토글 로직/검증/testID 계약 불변 (기존 단위테스트 통과 조건), marketing 기본값 false (lib/consents.ts).
import React from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { legalLinks } from '../config/legalLinks';
import { ConsentState, consentTypes, toggleRequiredConsents, validateConsents } from '../lib/consents';

// 햅틱: 동의 토글 = selection (#52 지시의 3곳 중 하나). 웹은 expo-haptics가 no-op 폴백이라 try로 방어.
const selectionTick = () => {
  try { void Haptics.selectionAsync().catch(() => undefined); } catch { /* native unavailable */ }
};

const testIds = { terms: 'terms', privacy: 'privacy', voice_recording: 'voice', overseas_transfer: 'overseas', marketing: 'marketing', ageConfirmed: 'age14' } as const;
// 필수 항목 표시 순서 — 마케팅(선택)은 상단 별도 영역이므로 목록에서 제외
const requiredTypes = [...consentTypes.filter((type) => type !== 'marketing'), 'ageConfirmed' as const];

export default function ConsentGate({ value, onChange, disabled, onError }: {
  value: ConsentState; onChange: (value: ConsentState) => void; disabled: boolean; onError: (key: string) => void;
}) {
  const { t } = useTranslation();
  const toggle = (next: ConsentState) => { selectionTick(); onChange(next); };
  const checkbox = (key: string, checked: boolean, onPress: () => void, testID: string, styleOverride?: { row?: object; box?: object; label?: object }) => (
    <Pressable key={key} onPress={onPress} disabled={disabled} accessibilityRole="checkbox"
      accessibilityLabel={t(key)} accessibilityState={{ checked, disabled }} testID={testID}
      style={[styles.row, styleOverride?.row]}>
      <View style={[styles.box, styleOverride?.box, checked && styles.checked]}>
        {checked && <Text style={styles.check}>{t('consent.checkedIcon')}</Text>}
      </View>
      <Text style={[styles.label, styleOverride?.label]}>{t(key)}</Text>
    </Pressable>
  );
  return <View style={styles.container}>
    {/* ① 전체 동의 — 목록 행이 아닌 분리된 강조 블록 (카드 배경 + 큰 체크박스 + 굵은 라벨) */}
    {checkbox('consent.allRequired', validateConsents(value), () => toggle(toggleRequiredConsents(value)), 'consent-all-required',
      { row: styles.allRow, box: styles.allBox, label: styles.allLabel })}

    <View style={styles.divider} />

    {/* ② 필수 개별 항목 — 전체 동의 아래 기존 목록 */}
    {requiredTypes.map((type) => <View key={type}>
      {checkbox(`consent.${type}`, value[type], () => toggle({ ...value, [type]: !value[type] }), `consent-${testIds[type]}`)}
      {type === 'voice_recording' && <Text style={styles.notice}>{t('consent.voiceNotice')}</Text>}
      {type === 'overseas_transfer' && <Text style={styles.notice}>{t('consent.overseasNotice')}</Text>}
    </View>)}

    {/* ③ 선택 동의(마케팅) — 9/26 후퇴 지시: 맨 아래 + 저대비 최소 박스, 기본 미체크(opt-in) */}
    <View style={styles.divider} />
    {checkbox('consent.marketing', value.marketing, () => toggle({ ...value, marketing: !value.marketing }), `consent-${testIds.marketing}`,
      { row: styles.optionalRow, box: styles.optionalBox, label: styles.optionalLabel })}
    <Text style={styles.notice}>{t('consent.documentsPending')}</Text>
    <View style={styles.links}>
      {(['terms', 'privacy'] as const).map((type) => <Pressable key={type} accessibilityRole="link" style={styles.link}
        onPress={() => { void Linking.openURL(legalLinks[type]).catch(() => onError('errors.legalLink')); }}>
        <Text style={styles.linkText}>{t(type === 'terms' ? 'consent.viewTerms' : 'consent.viewPrivacy')}</Text>
      </Pressable>)}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  container: { marginVertical: spacing.sp3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, minHeight: spacing.sp10 + spacing.sp2, paddingVertical: spacing.sp2 },
  box: { width: spacing.sp6, height: spacing.sp6, borderWidth: 1, borderColor: colors.accent, borderRadius: radii.xs, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.accent },
  check: { ...typography.bodyBold, color: colors.onPrimary },
  label: { ...typography.subhead, color: colors.text1, flex: 1, minWidth: 0 },
  // 선택 동의 — 조그맣게(caption) + 저대비(text3)로 필수와 위계 분리
  optionalRow: { minHeight: spacing.sp8, paddingVertical: spacing.sp1, gap: spacing.sp2 },
  optionalBox: { width: spacing.sp5, height: spacing.sp5, borderColor: colors.borderStrong },
  optionalLabel: { ...typography.caption, color: colors.text3 },
  // 전체 동의 — 분리 블록: 카드 배경 + 큰 체크박스 + 굵은 라벨
  allRow: {
    backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp3, minHeight: spacing.sp10,
    ...(Platform.OS === 'web' ? {} : { shadowColor: 'rgba(16,24,40,0.06)', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 2, elevation: 2 }),
  },
  allBox: { width: spacing.sp8, height: spacing.sp8, borderRadius: radii.sm, borderWidth: 2 },
  allLabel: { ...typography.bodyBold, fontWeight: '700', color: colors.text1 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sp2 },
  notice: { ...typography.caption, color: colors.text2, marginBottom: spacing.sp2, flexShrink: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp2 },
  link: { paddingVertical: spacing.sp3, flexShrink: 1 },
  linkText: { ...typography.caption, color: colors.accent },
});
