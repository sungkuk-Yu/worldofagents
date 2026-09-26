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
  Platform,
} from 'react-native';
import { colors, radii, spacing, typography, iconSize, webScreenMotion } from '../theme';
import { getPttKey, getPttMode, setPttKey, setPttMode, subscribePrefs } from '../lib/userPrefs';
import { capturePttKey, pttKeyLabel, PTT_DEFAULT_KEY } from '../lib/pttLogic';
import WithdrawDialog from '../components/dialogs/WithdrawDialog';

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
  // 회원탈퇴 다이얼로그 (t_eb7f13e9 항목 5) — 확인 없이는 어떤 파괴적 호출도 발생하지 않는다.
  const [withdrawOpen, setWithdrawOpen] = React.useState(false);

  // PTT (t_eded715c) — 웹 전용: 키보드 단축키 재매핑(녹화식 캡처) + 홀드/토글 모드.
  const [capturing, setCapturing] = React.useState(false);
  const [, forceRender] = React.useState(0);
  React.useEffect(() => subscribePrefs(() => forceRender((n) => n + 1)), []);
  React.useEffect(() => {
    if (!capturing || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(false); return; }
      const code = capturePttKey(e);
      if (code) void setPttKey(code);
      setCapturing(false);
    };
    // capture 단계 — 어떤 입력 포커스보다 먼저 잡아 재매핑 중 다른 핸들러에 새는 일 방지
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing]);
  const pttKey = getPttKey() ?? PTT_DEFAULT_KEY;
  const pttMode = getPttMode() ?? 'hold';

  return (
    <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
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
            testID="joystick-customize-button"
            onPress={() => navigation.navigate('JoystickSettings')}
          >
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>{t('settings.customize')}</Text>
              <Text style={styles.settingDescription}>{t('settings.customizeDescription')}</Text>
            </View>
            <Text style={styles.chevron}>{t('common.forwardIcon')}</Text>
          </TouchableOpacity>
        </View>

        {Platform.OS === 'web' && <>
          <Text style={[styles.sectionTitle, { marginTop: spacing.sp6 }]}>{t('ptt.section')}</Text>
          <View style={styles.settingCard}>
            <TouchableOpacity
              style={styles.linkRow}
              testID="ptt-key-button"
              accessibilityRole="button"
              onPress={() => setCapturing(true)}
            >
              <View style={styles.settingBody}>
                <Text style={styles.settingLabel}>{t('ptt.key')}</Text>
                <Text style={styles.settingDescription}>{capturing ? t('ptt.keyCapturing') : t('ptt.keyDescription', { key: pttKeyLabel(pttKey) })}</Text>
              </View>
              <Text style={[styles.chevron, { ...typography.bodyBold, color: colors.accent }]}>{capturing ? '…' : pttKeyLabel(pttKey)}</Text>
            </TouchableOpacity>
            <View style={styles.settingRow}>
              <View style={styles.settingBody}>
                <Text style={styles.settingLabel}>{t('ptt.mode')}</Text>
                <Text style={styles.settingDescription}>{t('ptt.modeDescription')}</Text>
              </View>
              {(['hold', 'toggle'] as const).map((option) => (
                <TouchableOpacity
                  key={option}
                  testID={`ptt-mode-${option}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: pttMode === option }}
                  onPress={() => void setPttMode(option)}
                  style={[styles.modeChip, pttMode === option && styles.modeChipActive]}
                >
                  <Text style={[styles.modeChipText, pttMode === option && styles.modeChipTextActive]}>{t(`ptt.mode${option === 'hold' ? 'Hold' : 'Toggle'}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </>}

        <TouchableOpacity testID="demo-button" style={styles.linkRow} onPress={() => navigation.navigate('Chat', { demo: true })}>
          <Text style={styles.settingLabel}>{t('settings.demo')}</Text>
        </TouchableOpacity>

        {/* 법률 카드 t_eb7f13e9 항목 4·5 — 정책 문서 열람 + 회원탈퇴 (개인정보보호법 제21조, AI 기본법 제31조) */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.sp6 }]}>{t('settings.legalSection')}</Text>
        <View style={styles.settingCard}>
          {(['terms', 'privacy'] as const).map((kind) => <TouchableOpacity key={kind}
            style={styles.linkRow} testID={`settings-legal-${kind}`}
            onPress={() => navigation.navigate('LegalDoc', { kind })}>
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>{t(`settings.legal.${kind}`)}</Text>
            </View>
            <Text style={styles.chevron}>{t('common.forwardIcon')}</Text>
          </TouchableOpacity>)}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: spacing.sp6 }]}>{t('settings.account')}</Text>
        <View style={styles.settingCard}>
          <TouchableOpacity style={styles.linkRow} testID="settings-withdraw-button"
            onPress={() => setWithdrawOpen(true)}>
            <View style={styles.settingBody}>
              <Text style={[styles.settingLabel, { color: colors.statusErr }]}>{t('withdraw.title')}</Text>
              <Text style={styles.settingDescription}>{t('withdraw.description')}</Text>
            </View>
            <Text style={styles.chevron}>{t('common.forwardIcon')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footerText}>{t('settings.footer')}</Text>
      </ScrollView>
      {withdrawOpen && <WithdrawDialog navigation={navigation} onClose={() => setWithdrawOpen(false)} />}
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
    ...typography.title2,
    fontSize: iconSize.glyphLg,
    color: colors.text1,
  },
  headerTitle: {
    ...typography.headline,
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
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.text3,
    textTransform: 'uppercase',
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
    ...typography.body,
    fontWeight: '500',
    color: colors.text1,
  },
  settingDescription: {
    ...typography.caption,
    color: colors.text3,
    marginTop: 3,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp4,
  },
  chevron: {
    ...typography.headline,
    fontSize: iconSize.glyph,
    color: colors.text3,
  },
  modeChip: {
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginLeft: spacing.sp2,
  },
  modeChipActive: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  modeChipText: { ...typography.caption, fontWeight: '600', color: colors.text2 },
  modeChipTextActive: { color: colors.accent },
  footerText: {
    ...typography.micro,
    marginTop: spacing.sp8,
    textAlign: 'center',
    color: colors.text3,
  },
});
