import type { ForkOrigin } from './src/types';
import { initializeLanguage } from './src/i18n';
import { useTranslation } from 'react-i18next';
// MyAgentTalk — 메인 앱 진입점
// React Navigation 기반 네비게이션 구조
// 디자인 시스템 v1.2 토큰 적용 (docs/design/agenttalk-figma/tokens.json + Pretendard/Inter 번들)
// 화면 6(대화 목록) → 7(음성 우선 홈) → 10(결과 캔버스) → 11(카드 스레드)
import React, { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { initializeApi, api } from './src/lib/api';
import { setClassifyRequest } from './src/neurons/DialogTypeClassifier';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, useNavigation, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { PaperProvider, MD3LightTheme, Text, Button, configureFonts } from 'react-native-paper';
import { ActivityIndicator, StyleSheet, View, Platform, useWindowDimensions } from 'react-native';

import { colors, fontFamily, spacing, typography } from './src/theme';
import { layoutModeForWidth, SIDEBAR_WIDTH } from './src/lib/layout';
import {
  DialogueListScreen,
  ChatScreen,
  LoginScreen,
  VoiceHomeScreen,
  ResultCanvasScreen,
  CardThreadScreen,
  FavoritesScreen,
  VaultScreen,
  BoardScreen,
  NeuronDashboardScreen,
  SettingsScreen,
  JoystickSettingsScreen,
  LegalDocScreen,
} from './src/screens';

// 네비게이션 타입
export type RootStackParamList = {
  Login: undefined;
  DialogueList: { demo?: boolean } | undefined;
  Chat: { sessionId?: string; agentId?: string; agentName?: string; demo?: boolean; presetTitleKey?: string; sessionTitle?: string; forkedFrom?: ForkOrigin; focusMessageId?: string };
  VoiceHome: { dialogueId?: string };
  ResultCanvas: { dialogueId?: string };
  CardThread: { sessionId: string; rootMessageId: string; agentName?: string; sessionTitle?: string };
  Favorites: undefined;
  Vault: { noteId?: string; createTitle?: string } | undefined;
  Board: { boardId?: string } | undefined;
  NeuronDashboard: undefined;
  Settings: undefined;
  JoystickSettings: undefined;
  LegalDoc: { kind?: 'terms' | 'privacy' };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// PC 사이드바 레일 — DialogueListScreen을 'sidebar' 변형으로 재사용(목록 코드 단일화).
// 내비게이션 패사드: 레일의 navigate는 중앙 Stack에 그대로 전달(모바일과 동일 라우트 계약).
const RAIL_ROUTES = new Set(['Chat']); // 목록 화면은 home 변형(전폭)이 이미 목록을 렌더 — 레일 중복 제거
function SidebarRail() {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.sidebarRail}>
      <DialogueListScreen navigation={navigation} variant="sidebar" />
    </View>
  );
}

// PC 중앙 본문용 — 세션 목록이 좌측 레일로 갔으므로 목록 화면은 '이어보기 홈'으로 렌더.
// (브레이크포인트 경계에서만 참조가 바뀌어 재마운트 — 리사이즈마다 상태가 날아가지 않게 안정 참조.)
function DialogueListHomeScreen(props: any) {
  return <DialogueListScreen {...props} variant="home" />;
}

// 라이트 테마 — 디자인 시스템 v1.1 토큰 (docs/design/agenttalk-figma/tokens.json)
// 흰 바탕 + 그린 액센트(#00A86B) — 참고 톤: 삼성 헬스 / 네이버페이 / 토스
const AppTheme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.surface,
    text: colors.text1,
    border: colors.border,
    notification: colors.statusErr,
  },
};

// react-native-paper 테마 — 마이에이전트톡 토큰을 MD3에 매핑 (기성 컴포넌트에 기존 디자인 시스템 입히기)
// 폰트: Paper MD3 variant 전체의 fontFamily를 Pretendard/Inter 스택으로 통일
// (기성 컴포넌트가 시스템 폴백 폰트로 렌더되는 것 방지 — 대표님 지적 "촌스러운 글씨체" 원인)
const paperFonts = configureFonts({
  config: Object.fromEntries(
    Object.entries(MD3LightTheme.fonts).map(([variant, style]) => [variant, { ...style, fontFamily }])
  ) as typeof MD3LightTheme.fonts,
});
const PaperTheme = {
  ...MD3LightTheme,
  fonts: paperFonts,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.accent,
    onPrimary: colors.onPrimary,
    background: colors.bg,
    onBackground: colors.text1,
    surface: colors.surface,
    onSurface: colors.text1,
    surfaceVariant: colors.surfaceRaise,
    onSurfaceVariant: colors.text2,
    outline: colors.border,
    outlineVariant: colors.border,
    error: colors.statusErr,
    onError: '#FFFFFF',
    secondary: colors.accent,
    tertiary: colors.segData,
  },
};

export default function App() {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 폰트 번들 — 로드 완료 전에는 스플래시만 (폰트 없는 화면 노출 방지, 대표님 지시 2026-09-26)
  // 웹: Inter는 expo-font, PretendardVariable은 public/index.html CSS(@font-face, 로컬 woff2 + CDN 폴백)
  const [fontsLoaded] = useFonts({
    PretendardVariable: require('./assets/fonts/PretendardVariable.ttf'),
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter: Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
  });
  // 부트스트랩 — setState는 항상 비동기 콜백에서만 (react-hooks/set-state-in-effect 대응)
  const runBootstrap = (markStale: () => boolean) => {
    // 대화 유형 Stage 2 서버 위임 배선 (t_56498848): 로컬 패턴 미확정 발화만 /api/classify 호출.
    setClassifyRequest(async (input, history) => {
      try {
        const res = await api.classify(input, history);
        const d = res.data;
        return d && typeof d.type === 'string' ? { type: d.type, confidence: d.confidence, stage: d.stage } : null;
      } catch {
        return null; // 미로그인/오프라인 → Stage 3 폴백(로컬 information+확인).
      }
    });
    void Promise.all([initializeApi(), initializeLanguage()])
      .then(() => { if (!markStale()) setReady(true); })
      .catch(() => { if (!markStale()) setError('errors.bootstrap'); });
  };
  useEffect(() => {
    let cancelled = false;
    runBootstrap(() => cancelled);
    return () => { cancelled = true; };
  }, []);
  const retryBootstrap = () => {
    setError(null);
    runBootstrap(() => false);
  };
  // 사이드바 레일 노출 범위 — 3패널 설계는 대화 경험(목록/채팅) 전용. 보드·볼트 등 전면 화면과 충돌 금지 (t_eded715c).
  const navRef = useNavigationContainerRef();
  const [railVisible, setRailVisible] = useState(false);
  const syncRail = () => {
    const route = navRef.getCurrentRoute() as { name?: string } | undefined;
    setRailVisible(!!route?.name && RAIL_ROUTES.has(route.name));
  };
  if (!ready || !fontsLoaded) return <PaperProvider theme={PaperTheme}><View style={styles.splash}>
    <Text style={styles.splashBrand}>{t('common.app')}</Text>
    <ActivityIndicator color={colors.accent} testID="font-splash" />
    {error && <Text>{t(error)}</Text>}
    {error && <Button onPress={retryBootstrap}>{t('common.retry')}</Button>}
  </View></PaperProvider>;

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* #52: 카드 스레드 바텀시트(디텐트) — BottomSheetModalProvider는 GestureHandlerRootView 하위에 */}
      <BottomSheetModalProvider>
      <PaperProvider theme={PaperTheme}>
        <NavigationContainer ref={navRef} theme={AppTheme} onReady={syncRail} onStateChange={syncRail}>
          {/* 반응형 2트랙 (t_eded715c): PC 웹(≥768) = 사이드바(세션목록) + 중앙 Stack 본문.
              모바일/네이티브는 레일 없이 Stack 단독 — 기존 단일 컬럼과 동일 경로. */}
          <View style={styles.shellRow}>
          {Platform.OS === 'web' && layoutModeForWidth(width) !== 'mobile' && railVisible && <SidebarRail />}
          <View style={styles.mainColumn}>
          <Stack.Navigator
            initialRouteName="DialogueList"
            screenOptions={{
              headerShown: false,
              // #52 애플 감성: native-stack 푸시(네이티브는 iOS 스와이프 백 포함 기본 유지),
              // 웹은 theme/webScreenMotion의 CSS keyframes 폴백이 화면 루트에서 동일 곡선 적용.
              animation: 'slide_from_right',
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ title: t('common.login') }}
            />
            <Stack.Screen
              name="DialogueList"
              component={layoutModeForWidth(width) !== 'mobile' ? DialogueListHomeScreen : DialogueListScreen}
              options={{ title: t('common.app') }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={{ title: t('common.chat') }}
            />
            <Stack.Screen
              name="VoiceHome"
              component={VoiceHomeScreen}
              options={{ title: t('common.voice') }}
            />
            <Stack.Screen
              name="ResultCanvas"
              component={ResultCanvasScreen}
              // #52: fullScreenCover 스타일 — 아래서 밀어올림 (네이티브: slide_from_bottom)
              options={{ title: t('common.results'), animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="CardThread"
              component={CardThreadScreen}
              options={{ title: t('common.thread'), animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="Favorites"
              component={FavoritesScreen}
              options={{ title: t('favorites.title') }}
            />
            <Stack.Screen
              name="Vault"
              component={VaultScreen}
              options={{ title: t('vault.title') }}
            />
            <Stack.Screen
              name="Board"
              component={BoardScreen}
              options={{ title: t('board.title') }}
            />
            <Stack.Screen
              name="NeuronDashboard"
              component={NeuronDashboardScreen}
              options={{ title: t('common.neurons') }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: t('common.settings') }}
            />
            <Stack.Screen
              name="JoystickSettings"
              component={JoystickSettingsScreen}
              options={{ title: t('joystick.title') }}
            />
            <Stack.Screen
              name="LegalDoc"
              component={LegalDocScreen}
              options={{ title: t('settings.legalSection') }}
            />
          </Stack.Navigator>
          </View>
          </View>
          <StatusBar style="dark" />
        </NavigationContainer>
      </PaperProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // 반응형 셸 (t_eded715c): 사이드바 + 중앙 본문 가로 배치 — 모바일에서는 레일 미렌더로 단컬럼과 동일.
  shellRow: { flex: 1, flexDirection: 'row' },
  mainColumn: { flex: 1, minWidth: 0 },
  sidebarRail: {
    width: SIDEBAR_WIDTH,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sp4,
    backgroundColor: colors.bg,
  },
  splashBrand: {
    fontFamily,
    fontSize: typography.title2.fontSize,
    fontWeight: '700',
    letterSpacing: typography.title2.letterSpacing,
    color: colors.text1,
  },
});
