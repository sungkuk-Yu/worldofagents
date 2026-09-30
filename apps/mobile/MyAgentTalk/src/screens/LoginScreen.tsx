import { useTranslation } from 'react-i18next';
// 로그인과 회원가입을 분리하여 가입 동의 검증 오류를 그대로 표시한다.
// 디자인: Mintlify 패턴 — 화이트 캔버스, 미니멀 폼, 그린 CTA, 사각 입력(radii.md)
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
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
  const { height } = useWindowDimensions();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [consents, setConsents] = useState({ ...emptyConsents });
  const signup = mode === 'signup';
  const consentValid = validateConsents(consents);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // t_391be23c #1 — 카드 실측 높이 기반 수직 중앙: 짧은 화면(로그인)은 진짜 중앙,
  // 가입처럼 카드가 뷰포트보다 길면 상단(sp8) 고정 후 스크롤(중앙이면 상단이 잘림).
  // onLayout 측정값은 모드 전환 시 갱신 → 점프가 아니라 재중앙(대표님 요구).
  const [cardH, setCardH] = useState(0);
  const verticalGap = cardH > 0
    ? Math.max(spacing.sp8, Math.round((height - cardH) / 2))
    : spacing.sp8;

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
      {/* t_391be23c #1: 카드 실측(onLayout) 높이로 수직 중앙 — 짧은 화면(로그인)은 뷰포트 중앙,
          긴 화면(가입 게이트)은 상단 sp8 고정 후 스크롤(중앙이면 헤더가 잘려서 불가).
          t_865ea744의 '고정 430 근사'는 가입 화면에서 하단 회색 과다 → 대표님 재지시 시정.
          iOS는 automaticallyAdjustKeyboardInsets가 키보드 높이만큼 인셋을 벌어 카드가 가려지지 않고,
          하단 safe area(paddingBottom)를 넉넉히 확보한다. */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: verticalGap }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
      >
        <Surface style={styles.card} elevation={0} testID="login-card"
          onLayout={(e) => setCardH(Math.round(e.nativeEvent.layout.height))}>
          <View style={styles.logoWrap}>
            {/* t_64af90b0 #8 — 3단 브랜드 중복 제거: 'MAT' 워드마크만 (Round 7 로고 확정 전), 타이틀 삭제 */}
            <Text style={styles.logoText}>{t('common.logo')}</Text>
          </View>
          {/* t_391be23c #1 — 헤더 라인(MAT·타이틀·서브텍스트) 중앙 정렬 통일: 서브텍스트 좌측 정렬 잔여 시정 */}
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

          {/* 입력 스택 — 카드 내부 블록 사이 contentGap(20), 스택 내부 stackGap(16)
              t_64af90b0 #8: paper outlined가 label을 placeholder로 이중 렌더(포커스 시 상자 안 재표시) →
              placeholder=''로 억제, 플로팅 라벨 하나로 통일 */}
          <View style={styles.fieldStack}>
            <TextInput
              mode="outlined"
              label={t('login.email')}
              placeholder=""
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
              placeholder=""
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
  // t_865ea744 ②: 상단 고정 정렬 + 하단 safe area. t_391be23c #1부터 실제 중앙 정렬은
  // 카드 onLayout 실측(verticalGap)로 계산하고, 여기는 최소 상단 여백(sp8) 폴백.
  content: {
    alignItems: 'center',
    paddingHorizontal: spacing.sp5,
    // t_64af90b0 #9 → t_391be23c: 고정 430 근사 폐기 — 카드 실측 높이 기반 재중앙.
    // 모드 전환 시 필드 위치가 이동하는 것은 회귀가 아니라 의도된 재중앙(대표님 지시).
    paddingTop: spacing.sp8,
    paddingBottom: spacing.sp10 * 2,
    flexGrow: 1,
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
    // t_391be23c #2 — 폰트 담백화(Weight 강등): 800 → 600, display 토큰 트래킹(-0.4)으로 회귀
    ...typography.display,
    fontWeight: '600',
    color: colors.accent,
  },
  title: {
    ...typography.title1,
    color: colors.text1,
    // t_391be23c #1 — 헤더 3줄(MAT·타이틀·서브텍스트) 중앙 정렬 통일 (#8에서 타이틀 행은 미렌더, 스타일만 정비)
    textAlign: 'center',
    marginBottom: spacing.sp1,
  },
  subtitle: {
    ...typography.subhead,
    color: colors.text2,
    // t_391be23c #1 — MAT·서브텍스트 헤더 중앙 정렬 통일 (기존 좌측 정렬 혼선 시정)
    textAlign: 'center',
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
