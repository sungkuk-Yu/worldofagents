import { useTranslation } from 'react-i18next';
// 로그인과 회원가입을 분리하여 가입 동의 검증 오류를 그대로 표시한다.
// 디자인: Mintlify 패턴 — 화이트 캔버스, 미니멀 폼, 그린 CTA, 사각 입력(radii.md)
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, Surface, Text, TextInput } from 'react-native-paper';
import { colors, radii, spacing, typography, webScreenMotion } from '../theme';
import { errorKey } from '../lib/errorKeys';
import { api, setToken } from '../lib/api';
import { oauthEnabledProviders, startOAuthSignIn, takeOAuthNotice } from '../lib/oauth';
import { GoogleIcon, GithubIcon, KakaoIcon, NaverIcon } from '../components/OAuthIcons';
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
  // OAuth (t_198b95cc): 부트스트랩에서 소비 실패한 콜백(사용자 취소 등) 1회성 안내로 표시.
  const [error, setError] = useState<string | null>(() => takeOAuthNotice());
  // OAuth 2단계 (t_198b95cc): 노출의 단일 소스는 EXPO_PUBLIC_OAUTH_PROVIDERS 플래그(카드 §1).
  // 등록 전(env 미설정)에는 목록이 비어 이 섹션 전체가 렌더되지 않는다 — 회귀 안전.
  const oauthProviders = oauthEnabledProviders();
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
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

  // OAuth (t_198b95cc §1·§3): 웹은 signInWithOAuth가 페이지를 떠나므로 성공 시 이 함수가
  // resolve되지 않는다. 네이티브는 외부 브라우저 복귀 후 딥링크 경로가 세션을 완성하므로,
  // 여선에서는 버튼이 '열림' 상태 그대로 유지된다(부트스트랩/리스너가 reset 처리).
  const oauthIcons: Record<string, React.ReactNode> = {
    // 배경 색과 대비되는 포그라운드: 카카오 다크브라운(옐로 배경), 네이버 화이트(그린 배경),
    // GitHub 화이트(다크 배경), Google은 4색 브랜드 마크(화이트 배경 규칙).
    kakao: <KakaoIcon color="#391B1B" />, naver: <NaverIcon color="#FFFFFF" />,
    google: <GoogleIcon />, github: <GithubIcon color="#FFFFFF" />,
  };
  const oauthLabelKey: Record<string, string> = {
    kakao: 'login.oauth.kakao', naver: 'login.oauth.naver', google: 'login.oauth.google', github: 'login.oauth.github',
  };
  const startOAuth = async (provider: string) => {
    if (busy || oauthBusy) return;
    setOauthBusy(provider);
    setError(null);
    try {
      await startOAuthSignIn(provider as never);
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setOauthBusy(null);
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

          {/* OAuth 2단계 (t_198b95cc §3) — '또는' 구분 + 소셜 버튼(로고 SVG, 브랜드 가이드 색).
              카카오/네이버 한국 우선 배치(oauthLogic.orderProviders가 고정).
              플래그 목록이 비면(등록 전 기본) 섹션 전체 미렌더 — 회귀 안전(카드 게이트 '버튼 숨김'). */}
          {oauthProviders.length > 0 && (
            <View style={styles.oauthSection} testID="oauth-section">
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t('login.oauth.or')}</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={styles.oauthStack}>
                {oauthProviders.map((p) => (
                  <TouchableOpacity
                    key={p}
                    accessibilityRole="button"
                    accessibilityLabel={t(oauthLabelKey[p])}
                    testID={`oauth-${p}`}
                    disabled={busy || oauthBusy !== null}
                    onPress={() => void startOAuth(p)}
                    style={[styles.oauthBtn, p === 'kakao' && styles.oauthBtnKakao, p === 'naver' && styles.oauthBtnNaver, p === 'github' && styles.oauthBtnGithub]}
                  >
                    <View style={styles.oauthIcon}>{oauthIcons[p]}</View>
                    <Text style={[styles.oauthLabel, p === 'kakao' && { color: '#391B1B' }, p === 'naver' && { color: '#FFFFFF' }, p === 'github' && { color: '#FFFFFF' }]} numberOfLines={1}>
                      {oauthBusy === p ? t('login.oauth.busy') : t(oauthLabelKey[p])}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}


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
  // ── OAuth 섹션 (t_198b95cc §3) ── '또는' 구분선 + 브랜드 가이드 색 버튼(카카오/네이버 우선)
  oauthSection: {
    marginTop: contentGap,
    width: '100%',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp3,
    marginBottom: stackGap,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.caption,
    color: colors.text3,
  },
  oauthStack: {
    gap: stackGap,
  },
  // 최소 44dp 히트영역 (동의 게이트 행 minHeight>=44 관례와 동일)
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sp2,
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sp3,
  },
  // 카카오: 브랜드 옐로 배경 + 다크 브라운 포그라운드(가이드) — 테두리 동일 톤으로 정리
  oauthBtnKakao: {
    backgroundColor: '#FEE500',
    borderColor: '#FEE500',
  },
  // 네이버: 시그니처 그린 배경 + 화이트 로고/글자
  oauthBtnNaver: {
    backgroundColor: '#03C75A',
    borderColor: '#03C75A',
  },
  // GitHub: 다크 배경 + 화이트 마크 (Octocat 단색 가이드)
  oauthBtnGithub: {
    backgroundColor: '#24292F',
    borderColor: '#24292F',
  },
  oauthIcon: {
    width: 20,
    alignItems: 'center',
  },
  oauthLabel: {
    ...typography.bodyBold,
    color: colors.text1,
  },
});
