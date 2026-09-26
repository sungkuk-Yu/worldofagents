import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { legalLinks } from '../config/legalLinks';
import { ConsentState, consentTypes, toggleRequiredConsents, validateConsents } from '../lib/consents';

const testIds = { terms: 'terms', privacy: 'privacy', voice_recording: 'voice', overseas_transfer: 'overseas', marketing: 'marketing', ageConfirmed: 'age14' } as const;
export default function ConsentGate({ value, onChange, disabled, onError }: {
  value: ConsentState; onChange: (value: ConsentState) => void; disabled: boolean; onError: (key: string) => void;
}) {
  const { t } = useTranslation();
  const checkbox = (key: string, checked: boolean, onPress: () => void, testID: string) => (
    <Pressable key={key} onPress={onPress} disabled={disabled} accessibilityRole="checkbox"
      accessibilityLabel={t(key)} accessibilityState={{ checked, disabled }} testID={testID} style={styles.row}>
      <View style={[styles.box, checked && styles.checked]}>
        {checked && <Text style={styles.check}>{t('consent.checkedIcon')}</Text>}
      </View>
      <Text style={styles.label}>{t(key)}</Text>
    </Pressable>
  );
  return <View style={styles.container}>
    {checkbox('consent.allRequired', validateConsents(value), () => onChange(toggleRequiredConsents(value)), 'consent-all-required')}
    {[...consentTypes, 'ageConfirmed' as const].map((type) => <View key={type}>
      {checkbox(`consent.${type}`, value[type], () => onChange({ ...value, [type]: !value[type] }), `consent-${testIds[type]}`)}
      {type === 'voice_recording' && <Text style={styles.notice}>{t('consent.voiceNotice')}</Text>}
      {type === 'overseas_transfer' && <Text style={styles.notice}>{t('consent.overseasNotice')}</Text>}
    </View>)}
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
  notice: { ...typography.caption, color: colors.text2, marginBottom: spacing.sp2, flexShrink: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp2 },
  link: { paddingVertical: spacing.sp3, flexShrink: 1 },
  linkText: { ...typography.caption, color: colors.accent },
});
