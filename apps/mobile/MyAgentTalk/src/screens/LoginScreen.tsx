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
import ConsentGate, { contentGap, stackGap, formGap } from '../components/ConsentGate';
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
      {/* t_865ea744 ②: 스크롤 점프 수정 — 가운데 정렬(flexGrow+center)을 버리고 상단 고정 정렬로 전환.
          가입 게이트가 아래에 삽입돼도 입력 필드 위치가 흔들리지 않고 페이지 상단으로 튕기지 않는다.
          iOS는 automaticallyAdjustKeyboardInsets가 키보드 높이만큼 인셋을 벌어 카드가 가려지지 않고,
          하단 safe area(paddingBottom)를 넉넉히 확보한다. */}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
      >
        <Surface style={styles.card} elevation={0} testID="login-card">
          <View style={styles.logoWrap}>
            <Text style={styles.logoText}>{t('common.logo')}</Text>
          </View>
          <Text style={styles.title}>{t('common.app')}</Text>
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

          {/* 입력 스택 — 카드 내부 블록 사이 contentGap(20), 스택 내부 stackGap(16) */}
          <View style={styles.fieldStack}>
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
              // 폼 필드 설정: 엔터는 제출이 아니라 다음 필드로 (웹 포커스 이탈/스크롤 방지)
              submitBehavior="newline"
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
              submitBehavior="submit"
              testID="login-password"
              onSubmitEditing={() => void authenticate()}
            />
          </View>

          {/* 입력 vs 동의 게이트: formGap(12) — 게이트 자체 margin */}
          {signup && <ConsentGate value={consents} onChange={setConsents} disabled={busy} onError={setError}
            onOpenDoc={(kind) => navigation.navigate('LegalDoc', { kind })} />}

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
  // t_865ea744 ②: 상단 고정 정렬 + 하단 safe area. 로그인(짧은 화면)과 가입(게이트로 길어진 화면)이
  // 같은 캔버스 위를 스크롤할 때 필드 위치가 점프하지 않는다.
  content: {
    alignItems: 'center',
    paddingHorizontal: spacing.sp5,
    paddingTop: spacing.sp8,
    paddingBottom: spacing.sp10 * 2,
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
    // 카드 내부 블록 사이 = contentGap (9/25 재설계 스페시싱)
    marginBottom: contentGap,
  },
  // 입력 스택: 스택 내부 16, 스택과 다음 블록 사이 20
  fieldStack: {
    gap: stackGap,
    marginBottom: formGap,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
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
