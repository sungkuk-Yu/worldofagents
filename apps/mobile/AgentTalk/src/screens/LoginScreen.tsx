import { useTranslation } from 'react-i18next';
// LoginScreen — dev 로그인/회원가입 (채팅 MVP Phase 2)
// 백엔드: POST /api/auth/signup → 실패(중복) 시 POST /api/auth/login 자동 폴백
// 디자인: Mintlify 패턴 — 화이트 캔버스, 미니멀 폼, 그린 CTA, 사각 입력(radii.md)
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Surface, Text, TextInput } from 'react-native-paper';
import { colors, radii, spacing, typography } from '../theme';
import { errorKey } from '../lib/errorKeys';
import { api, setToken } from '../lib/api';

interface Props {
  navigation: any;
}

export default function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticate = async () => {
    const mail = email.trim();
    if (!mail || !password) {
      setError('errors.credentials');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 회원가입 시도 → 이미 있으면 로그인
      let token: string | null = null;
      try {
        const signup = await api.signup(mail, password);
        token = signup?.data?.token ?? null;
      } catch {
        /* 중복 등 — 로그인으로 폴백 */
      }
      if (!token) {
        const login = await api.login(mail, password);
        token = login?.data?.token ?? null;
      }
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
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.center}>
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

          {error && (
            <Text style={styles.error} testID="login-error">{t(error)}</Text>
          )}

          <Button
            mode="contained"
            onPress={() => void authenticate()}
            disabled={busy}
            buttonColor={colors.accent}
            textColor={colors.onPrimary}
            style={styles.submit}
            labelStyle={styles.submitLabel}
            loading={busy}
            testID="login-submit"
          >
            {busy ? t('login.busy') : t('login.submit')}
          </Button>


        </Surface>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
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
    minWidth: 52,
    minHeight: 52,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaise,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sp4,
  },
  logoText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.accent,
    letterSpacing: -0.4,
  },
  title: {
    fontSize: typography.title1.fontSize,
    fontWeight: '700',
    color: colors.text1,
    letterSpacing: -0.8,
    marginBottom: spacing.sp1,
  },
  subtitle: {
    fontSize: typography.subhead.fontSize,
    color: colors.text2,
    marginBottom: spacing.sp5,
    lineHeight: 19,
  },
  input: {
    backgroundColor: colors.surface,
    marginBottom: spacing.sp3,
    borderRadius: radii.md,
    fontSize: typography.body.fontSize,
  },
  error: {
    fontSize: typography.caption.fontSize,
    color: colors.statusErr,
    marginBottom: spacing.sp2,
  },
  skipMsg: {
    fontSize: typography.caption.fontSize,
    color: colors.text3,
    marginBottom: spacing.sp2,
  },
  submit: {
    borderRadius: radii.md,
    marginTop: spacing.sp1,
  },
  submitLabel: {
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '600',
    paddingVertical: spacing.sp1,
  },
  skipLabel: {
    fontSize: typography.subhead.fontSize,
    marginTop: spacing.sp2,
  },
});
