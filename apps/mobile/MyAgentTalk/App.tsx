import type { ForkOrigin } from './src/types';
import { initializeLanguage } from './src/i18n';
import { useTranslation } from 'react-i18next';
// MyAgentTalk — 메인 앱 진입점
// React Navigation 기반 네비게이션 구조
// 디자인 시스템 v1.2 토큰 적용 (docs/design/agenttalk-figma/tokens.json + Pretendard/Inter 번들)
// 화면 6(대화 목록) → 7(음성 우선 홈) → 10(결과 캔버스) → 11(카드 스레드)
import React, { Suspense, useEffect, lazy, useState } from 'react';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { initializeApi, getApiConfig, api } from './src/lib/api';
import { prefetchBootLists } from './src/lib/sessionPrefetch';
import { bootstrapOAuthCallback, oauthEnabledProviders, peekOAuthNotice, subscribeNativeOAuthLink, wireOAuthSessionBridge } from './src/lib/oauth';
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
// t_710b5d28 (10/4 속도 P0) — 라우트 코드 분할. 실측 entry 4.3MB 원본(969KB br) 단일 번들에
// 전 화면·victory/d3·카드 UI 스택이 들어 있었다. 1차(라우트별 import())는 실패: 공유 코드가
// __common으로 hoist되어 eager script로 남았다(부트 이득 0) — 따라서 비필수 화면 전체를
// asyncScreens.ts라는 단일 비동기 루트로 모았다. 공유 코드가 그 청크 내부로 흡수되어
// 부트 그래프에서 완전히 사라진다. 첫 화면 진입 fetch는 idle 프리로드로 상쇄.
import DialogueListScreen from './src/screens/DialogueListScreen';
import LoginScreen from './src/screens/LoginScreen';
type AsyncScreenName =
  | 'ChatScreen' | 'VoiceHomeScreen' | 'ResultCanvasScreen' | 'CardThreadScreen'
  | 'FavoritesScreen' | 'FeedScreen' | 'BoardScreen' | 'NeuronDashboardScreen'
  | 'SettingsScreen' | 'JoystickSettingsScreen' | 'LegalDocScreen' | 'ThreadRail' | 'ProjectRail' | 'FavoritesModal';
let asyncRoot: Promise<Record<AsyncScreenName, React.ComponentType<any>>> | null = null;
function loadAsyncRoot() {
  return (asyncRoot ??= import('./src/screens/asyncScreens') as unknown as Promise<Record<AsyncScreenName, React.ComponentType<any>>>);
}
const asyncScreen = (name: AsyncScreenName) =>
  lazy(async () => ({ default: (await loadAsyncRoot())[name] }));
function withChunkFallback(Loaded: React.LazyExoticComponent<React.ComponentType<any>>) {
  return function ChunkedScreen(props: any) {
    return (
      <Suspense fallback={<View style={styles.chunkFallback}><ActivityIndicator color={colors.accent} testID="chunk-loading" /></View>}>
        <Loaded {...props} />
      </Suspense>
    );
  };
}
const ChatScreen = withChunkFallback(asyncScreen('ChatScreen'));
const VoiceHomeScreen = withChunkFallback(asyncScreen('VoiceHomeScreen'));
const ResultCanvasScreen = withChunkFallback(asyncScreen('ResultCanvasScreen'));
const CardThreadScreen = withChunkFallback(asyncScreen('CardThreadScreen'));
const FavoritesScreen = withChunkFallback(asyncScreen('FavoritesScreen'));
const FeedScreen = withChunkFallback(asyncScreen('FeedScreen'));
const BoardScreen = withChunkFallback(asyncScreen('BoardScreen'));
const NeuronDashboardScreen = withChunkFallback(asyncScreen('NeuronDashboardScreen'));
const SettingsScreen = withChunkFallback(asyncScreen('SettingsScreen'));
const JoystickSettingsScreen = withChunkFallback(asyncScreen('JoystickSettingsScreen'));
const LegalDocScreen = withChunkFallback(asyncScreen('LegalDocScreen'));
const ProjectRail = withChunkFallback(asyncScreen('ProjectRail'));
// t_710b5d28 — ThreadRail lazy 청크 (정적 체인이 victory/CardFrame을 entry로 끌었다)
const LazyThreadRail = asyncScreen('ThreadRail');

// 네비게이션 타입
export type RootStackParamList = {
  Login: undefined;
  DialogueList: { demo?: boolean } | undefined;
  Chat: { sessionId?: string; agentId?: string; agentName?: string; demo?: boolean; presetTitleKey?: string; sessionTitle?: string; forkedFrom?: ForkOrigin; focusMessageId?: string };
  VoiceHome: { dialogueId?: string };
  ResultCanvas: { dialogueId?: string };
  CardThread: { sessionId: string; rootMessageId: string; agentName?: string; sessionTitle?: string };
  Favorites: undefined;
  Feed: undefined;
  Board: { boardId?: string } | undefined;
  NeuronDashboard: undefined;
  Settings: undefined;
  JoystickSettings: undefined;
  LegalDoc: { kind?: 'terms' | 'privacy' };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// t_710b5d28 — ThreadRail/ProjectRail/FavoritesModal은 asyncScreens 단일 루트의 멤버
// (정적 체인이 victory/CardFrame 스택을 entry·eager __common으로 끌었다).

// PC 사이드바 레일 (t_fd869e5b 요구1 → t_00fe9b0f 3-팬 개정, 대표님 10/4 원문: "왼쪽 창 = 한 에이전트
// 안에서의 새프로젝트(갈라내기) 공간 리스트"). wide(≥1024) 채팅 = 좌측 1차 내용이 스레드 레일에서
// 하드포크(새프로젝트) 리스트로 대체 — 스레드는 우측 사이드체인 카드로 이관되었다. 768~1023(2-팬)은
// 기존 ThreadRail 유지(우측 패널 자원이 없어 스레드 목록이 좌측에 남는다). 세션 목록은 목록 라우트의
// home 변형(전폭)으로 계속 도달 가능하고, 채팅에서는 앱바 ← 가 복귀 경로(슬랙: 채널 목록으로 백).
// 내비게이션 패사드: 레일의 navigate는 중앙 Stack에 그대로 전달(모바일과 동일 라우트 계약).
const RAIL_ROUTES = new Set(['Chat']); // 목록 화면은 home 변형(전폭)이 이미 목록을 렌더 — 레일 중복 제거
function SidebarRail() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  return (
    <View style={styles.sidebarRail}>
      <Suspense fallback={<View />}>
        {layoutModeForWidth(width) === 'pc-wide'
          ? <ProjectRail navigation={navigation} />
          : <LazyThreadRail navigation={navigation} />}
      </Suspense>
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
  // OAuth 실패 콜백 복귀 시 진입 화면을 Login으로 — '에러 시 한 줄 안내'가 스크롤 너머
  // 온보딩 패널에 묻히는 것 방지(카드 §3). setReady 전에 결정돼 네비게이터 첫 렌더에 반영된다.
  const [initialRoute, setInitialRoute] = useState<'Login' | 'DialogueList'>('DialogueList');
  // 폰트 번들 — 로드 완료 전에는 스플래시만 (폰트 없는 화면 노출 방지, 대표님 지시 2026-09-26)
  // t_710b5d28 (10/4 속도 P0) 웹 경로 재설계 — 실측: 이 게이트가 splash를 woff2 완료(+1.0s)까지
  // 잡고, expo-font가 require(ttf)를 @font-face로 주입해 Inter ttf 4종(~600KB)을 다운로드했다.
  //   · CSS(@font-face, public/index.html)가 이미 web 스택 전체를 담당한다(theme의 web 폰트와 동일).
  //   · web은 useFonts 게이트를 쓰지 않는다 — 대신 index.html의 <link rel=preload>이 HTML 파싱 시점에
  //     woff2 fetch를 시켜 JS 평가와 겹친다(실측 splash gate 2526→~1.7s). 게이트는 document.fonts.load
  //     (미히트 시 폴백) + 부트 병렬 대기: '폰트 없는 화면'은 여전히 노출하지 않는다.
  //   · native은 기존 useFonts(ttf) 경로 유지 — require는 Metro 정적 해석이라 web에서도 번들에
  //     상수 테이블로 남지만 fetch되지 않는다(web loader는 src로 참조만 쓴다).
  const [bundleFonts] = useFonts(Platform.OS === 'web' ? {} : {
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
  // web 폰트 게이트 — preload/캐시 히트는 즉시, 미히트(프리로드 실패·첫 방문 CDN 폴백)는
  // document.fonts.load로 완료 이벤트. 1.2s 상한 = 외곽값(9/30 P0의 12.9s)에서 영구 스플래시 방지;
  // 상한 도달 시 이미 woff2 CSS 우선이라 폴백 스택(Noto/Apple SD Gothic)도 한글 정자형이다.
  const [webFontsSettled, setWebFontsSettled] = useState(Platform.OS !== 'web');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    const fonts = (globalThis as { document?: { fonts?: { check?: (f: string) => boolean; load?: (f: string) => Promise<unknown> } } }).document?.fonts;
    const done = () => { if (alive) setWebFontsSettled(true); };
    const cap = setTimeout(done, 1200);
    try {
      if (fonts?.check?.('17px PretendardVariable')) { clearTimeout(cap); done(); return; }
      if (fonts?.load) fonts.load('17px PretendardVariable').then(done, done);
      else done();
    } catch { clearTimeout(cap); done(); }
    return () => { alive = false; clearTimeout(cap); };
  }, []);
  const fontsLoaded = Platform.OS === 'web' ? webFontsSettled : bundleFonts;
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
      .then(() => {
        // t_710b5d28 — 토큰 확정 즉시 목록 prefetch: 스플래시(폰트 대기)·OAuth 부트 구간과
        // 목록 API 왕복을 겹치게 한다. DialogueList 첫 refresh가 1회 소비(미도달 시 정상 fetch 폴백).
        if (getApiConfig().token) prefetchBootLists();
      })
      // OAuth 세션 브리지 연결 (t_198b95cc): 401 리커버리 슬롯 + sb 핸들 슬롯 재충전.
      // 플래그 OFF면 no-op(전제 조건인 client가 만들어지지 않는다).
      .then(() => { wireOAuthSessionBridge(); return bootstrapOAuthCallback(); })
      .then(() => {
        if (markStale()) return;
        if (peekOAuthNotice()) setInitialRoute('Login');
        setReady(true);
      })
      .catch(() => { if (!markStale()) setError('errors.bootstrap'); });
  };
  useEffect(() => {
    let cancelled = false;
    runBootstrap(() => cancelled);
    return () => { cancelled = true; };
  }, []);
  // 사이드바 레일 노출 범위 — 3패널 설계는 대화 경험(목록/채팅) 전용. 보드·볼트 등 전면 화면과 충돌 금지 (t_eded715c).
  const navRef = useNavigationContainerRef();
  // 네이티브 런타임 딥링크(백그라운드 복귀) 단일 리스너 — 웹은 no-op(이중 소비 금지, 카드 §4).
  // 로그인 완료 시 목록으로 reset — NavigationContainer에 연결된 유일한 navRef를 재사용한다
  // (두 번째 컨테이너 ref를 만들면 연결되지 않아 isReady가 영구 false — 버그).
  useEffect(() => {
    if (!ready || !oauthEnabledProviders().length) return;
    const goHome = () => {
      if (navRef.isReady()) navRef.reset({ index: 0, routes: [{ name: 'DialogueList' }] });
    };
    return subscribeNativeOAuthLink(goHome, () => { /* 안내는 LoginScreen이 takeOAuthNotice로 소비 */ });
  }, [ready]);
  const retryBootstrap = () => {
    setError(null);
    runBootstrap(() => false);
  };
  const [railVisible, setRailVisible] = useState(false);
  // t_710b5d28 — idle 청크 프리로드: 목록 페인트 후 유휴에 비동기 화면 루트를 통째로 당긴다
  // (단일 루트 통합으로 fetch 1회). lazy 탭 시점의 네트워크 왕복을 제거 — 체감 tap→화면 = 0네트워크.
  // 실패는 조용히 무시(탭 시 정상 재시도). 네이티브는 인라인이라 즉시 resolve — 실질 효과는 웹 전용.
  useEffect(() => {
    if (!ready) return;
    const run = () => { void loadAsyncRoot().catch(() => {}); };
    if (typeof (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback === 'function')
      (globalThis as unknown as { requestIdleCallback: (cb: () => void, opt?: { timeout: number }) => number }).requestIdleCallback(run, { timeout: 3000 });
    const timer = setTimeout(run, 1500); // idle 미지원/지연 대비 1회 폴백 (멱등 — 캐시 공유)
    return () => clearTimeout(timer);
  }, [ready]);
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
        {/* 탭 제목 브랜딩 (t_3c882443 요구1, 대표님 10/4 "브라우저 탭에 그냥 '채팅'이라고 나와"):
            기본값 = '마이에이전트톡', 채팅 화면 진입 시에만 '대화방명 — 마이에이전트톡'.
            ChatScreen이 navigation.setOptions({ title: sessionTitle })로 방명을 발행하면 formatter가 조립한다.
            (documentTitle은 웹 전용 — 네이티브는 useDocumentTitle.native no-op, headerShown:false라 헤더 영향 없음.) */}
        <NavigationContainer ref={navRef} theme={AppTheme} onReady={syncRail} onStateChange={syncRail}
          documentTitle={{ formatter: (options, route) => (route?.name === 'Chat' && options?.title ? `${options.title} — ${t('common.app')}` : t('common.app')) }}>
          {/* 반응형 2트랙 (t_eded715c): PC 웹(≥768) = 사이드바(세션목록) + 중앙 Stack 본문.
              모바일/네이티브는 레일 없이 Stack 단독 — 기존 단일 컬럼과 동일 경로. */}
          <View style={styles.shellRow}>
          {Platform.OS === 'web' && layoutModeForWidth(width) !== 'mobile' && railVisible && <SidebarRail />}
          <View style={styles.mainColumn}>
          <Stack.Navigator
            initialRouteName={initialRoute}
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
              name="Feed"
              component={FeedScreen}
              options={{ title: t('feed.title') }}
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
  // t_710b5d28 — lazy 청크 로드 중 최소 폴백(실제로는 idle 프리로드로 거의 노출되지 않는다)
  chunkFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
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
