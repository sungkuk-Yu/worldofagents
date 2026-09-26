import { changeLanguage, getLanguagePreference } from '../i18n';
import type { LanguagePreference } from '../i18n/language';
import { useTranslation } from 'react-i18next';
// Screen 5: 설정 (SettingsScreen)
// 설계: agenttalk-screen-spec.md 화면 5 — 왼손잡이 모드, 햅틱, 자동 전환, 조이스틱 커스터마이징 진입
import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { colors, radii, spacing } from '../theme';

interface Props {
  navigation: any;
}

export default function SettingsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [preference, setPreference] = React.useState(getLanguagePreference);
  const [languageError, setLanguageError] = React.useState(false);
  const selectLanguage = async (next: LanguagePreference) => {
    try { await changeLanguage(next); setPreference(next); setLanguageError(false); }
    catch { setLanguageError(true); }
  };
  const [leftHandMode, setLeftHandMode] = React.useState(false);
  const [hapticFeedback, setHapticFeedback] = React.useState(true);
  const [autoTransition, setAutoTransition] = React.useState(true);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel={t('common.back')} onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>{t('common.backIcon')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('common.settings')}</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
        <View style={styles.settingCard}>
          {(['system', 'ko', 'en'] as const).map((option) => <TouchableOpacity key={option} style={styles.linkRow} accessibilityRole="radio" accessibilityState={{ checked: preference === option }} accessibilityLabel={t(`settings.${option}`)} onPress={() => void selectLanguage(option)}>
            <Text style={[styles.settingLabel, { flexShrink: 1, color: preference === option ? colors.accent : colors.text1 }]}>{t(`settings.${option}`)}</Text>
          </TouchableOpacity>)}
        </View>
        {languageError && <Text style={styles.settingDescription}>{t('errors.language')}</Text>}
        <Text style={[styles.sectionTitle, { marginTop: spacing.sp6 }]}>{t('settings.interface')}</Text>

        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>{t('settings.leftHand')}</Text>
              <Text style={styles.settingDescription}>{t('settings.leftHandDescription')}</Text>
            </View>
            <Switch
              accessibilityLabel={t('settings.leftHand')}
              value={leftHandMode}
              onValueChange={setLeftHandMode}
              trackColor={{ false: colors.surfaceHover, true: colors.accent }}
              thumbColor={colors.text1}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>{t('settings.haptics')}</Text>
              <Text style={styles.settingDescription}>{t('settings.hapticsDescription')}</Text>
            </View>
            <Switch
              accessibilityLabel={t('settings.haptics')}
              value={hapticFeedback}
              onValueChange={setHapticFeedback}
              trackColor={{ false: colors.surfaceHover, true: colors.accent }}
              thumbColor={colors.text1}
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: spacing.sp6 }]}>{t('settings.conversation')}</Text>

        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>{t('settings.auto')}</Text>
              <Text style={styles.settingDescription}>{t('settings.autoDescription')}</Text>
            </View>
            <Switch
              accessibilityLabel={t('settings.auto')}
              value={autoTransition}
              onValueChange={setAutoTransition}
              trackColor={{ false: colors.surfaceHover, true: colors.accent }}
              thumbColor={colors.text1}
            />
          </View>

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('NeuronDashboard')}
          >
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>{t('common.neurons')}</Text>
              <Text style={styles.settingDescription}>{t('settings.neuronDescription')}</Text>
            </View>
            <Text style={styles.chevron}>{t('common.forwardIcon')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: spacing.sp6 }]}>{t('settings.joystick')}</Text>

        <View style={styles.settingCard}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => console.log('[Settings] joystick customization pending')}
          >
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>{t('settings.customize')}</Text>
              <Text style={styles.settingDescription}>{t('settings.customizeDescription')}</Text>
            </View>
            <Text style={styles.chevron}>{t('common.forwardIcon')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity testID="demo-button" style={styles.linkRow} onPress={() => navigation.navigate('Chat', { demo: true })}>
          <Text style={styles.settingLabel}>{t('settings.demo')}</Text>
        </TouchableOpacity>
        <Text style={styles.footerText}>{t('settings.footer')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
  },
  headerButton: {
    width: 44,
    alignItems: 'flex-start',
    padding: spacing.sp2,
  },
  headerButtonText: {
    fontSize: 20,
    color: colors.text1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text1,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacing.sp4,
    paddingBottom: spacing.sp8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sp2,
  },
  settingCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingBody: {
    minWidth: 0,
    flex: 1,
    paddingRight: spacing.sp3,
  },
  settingLabel: {
    fontSize: 15,
    color: colors.text1,
    fontWeight: '500',
  },
  settingDescription: {
    fontSize: 12,
    color: colors.text3,
    marginTop: 3,
    lineHeight: 17,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp4,
  },
  chevron: {
    fontSize: 18,
    color: colors.text3,
  },
  footerText: {
    marginTop: spacing.sp8,
    textAlign: 'center',
    fontSize: 11,
    color: colors.text3,
  },
});
