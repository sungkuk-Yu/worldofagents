import { useTranslation } from 'react-i18next';
// 로그인과 회원가입을 분리하여 가입 동의 검증 오류를 그대로 표시한다.
// 디자인: Mintlify 패턴 — 화이트 캔버스, 미니멀 폼, 그린 CTA, 사각 입력(radii.md)
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Surface, Text, TextInput } from 'react-native-paper';
import { colors, radii, spacing, typography, webScreenMotion } from '../theme';
import { errorKey } from '../lib/errorKeys';
import { api, setToken } from '../lib/api';
import ConsentGate from '../components/ConsentGate';
import { emptyConsents, signupConsents, validateConsents } from '../lib/consents';

interface Props {
  navigation: any;
}

export default function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [consents, setConsents] = useState({ ...emptyConsents });
  const signup = mode === 'signup';
  const consentValid = validateConsents(consents);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticate = async () => {
    if (busy) return;
    if (signup && !consentValid) { setError('errors.consentRequired'); return; }
    const mail = email.trim();
    if (!mail || !password) {
      setError('errors.credentials');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = signup
        ? await api.signup(mail, password, signupConsents(consents))
        : await api.login(mail, password);
      const token = result.ok ? result.data?.token : null;
      if (!token) throw new Error('errors.token');
      await setToken(token);
      navigation.reset({ index: 0, routes: [{ name: 'DialogueList' }] });
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  };


  return (
    <KeyboardAvoidingView
      style={[styles.container, webScreenMotion('mat-slide-from-right')]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <Surface style={styles.card} elevation={0} testID="login-card">
          <View style={styles.logoWrap}>
            <Text style={styles.logoText}>{t('common.logo')}</Text>
          </View>
          <Text style={styles.title}>{t('common.app')}</Text>
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

          <TextInput
            mode="outlined"
            label={t('login.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            style={styles.input}
            outlineColor={colors.border}
            activeOutlineColor={colors.accent}
            testID="login-email"
          />
          <TextInput
            mode="outlined"
            label={t('login.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            outlineColor={colors.border}
            activeOutlineColor={colors.accent}
            testID="login-password"
            onSubmitEditing={() => void authenticate()}
          />

          {signup && <ConsentGate value={consents} onChange={setConsents} disabled={busy} onError={setError} />}

          {error && (
            <Text style={styles.error} testID="login-error">{t(error)}</Text>
          )}

          <Button
            mode="contained"
            onPress={() => void authenticate()}
            disabled={busy || (signup && !consentValid)}
            buttonColor={colors.accent}
            textColor={colors.onPrimary}
            style={styles.submit}
            labelStyle={styles.submitLabel}
            loading={busy}
            testID={signup ? 'signup-submit' : 'login-submit'}
          >
            {t(busy ? (signup ? 'login.signupBusy' : 'login.busy') : (signup ? 'login.signup' : 'login.submit'))}
          </Button>
          {signup && !consentValid && <Text style={styles.skipMsg} accessibilityLiveRegion="polite">{t('consent.missing')}</Text>}
          <Button disabled={busy} textColor={colors.accent} onPress={() => { setMode(signup ? 'login' : 'signup'); setError(null); }} testID="auth-mode-toggle">
            {t(signup ? 'login.switchLogin' : 'login.switchSignup')}
          </Button>


        </Surface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flexGrow: 1,
    paddingVertical: spacing.sp6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sp5,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sp6,
  },
  logoWrap: {
    // 워드마크 — 텍스트 박스 로고 폐기 (#47): 배경 박스 없이 그린 이니셜 워드마크만
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sp4,
  },
  logoText: {
    ...typography.display,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.accent,
  },
  title: {
    ...typography.title1,
    letterSpacing: -0.8,
    color: colors.text1,
    marginBottom: spacing.sp1,
  },
  subtitle: {
    ...typography.subhead,
    color: colors.text2,
    marginBottom: spacing.sp5,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    marginBottom: spacing.sp3,
    borderRadius: radii.md,
  },
  error: {
    ...typography.caption,
    color: colors.statusErr,
    marginBottom: spacing.sp2,
  },
  skipMsg: {
    ...typography.caption,
    color: colors.text3,
    marginBottom: spacing.sp2,
  },
  submit: {
    borderRadius: radii.md,
    marginTop: spacing.sp1,
  },
  submitLabel: {
    ...typography.bodyBold,
    paddingVertical: spacing.sp1,
  },
  skipLabel: {
    ...typography.subhead,
    marginTop: spacing.sp2,
  },
});
