// AgentTalk — 메인 앱 진입점
// React Navigation 기반 네비게이션 구조
// 디자인 시스템 v1.0 토큰 적용 (docs/design/agenttalk-figma/tokens.json)
// 화면 6(대화 목록) → 7(음성 우선 홈) → 10(결과 캔버스) → 11(카드 스레드)
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

import { colors } from './src/theme';
import {
  DialogueListScreen,
  VoiceHomeScreen,
  ResultCanvasScreen,
  CardThreadScreen,
  NeuronDashboardScreen,
  SettingsScreen,
} from './src/screens';

// 네비게이션 타입
export type RootStackParamList = {
  DialogueList: undefined;
  VoiceHome: { dialogueId?: string };
  ResultCanvas: { dialogueId?: string };
  CardThread: { refType?: string; refTitle?: string };
  NeuronDashboard: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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

export default function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <NavigationContainer theme={AppTheme}>
        <Stack.Navigator
          initialRouteName="DialogueList"
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen
            name="DialogueList"
            component={DialogueListScreen}
            options={{ title: '에이전트톡' }}
          />
          <Stack.Screen
            name="VoiceHome"
            component={VoiceHomeScreen}
            options={{ title: '음성 입력' }}
          />
          <Stack.Screen
            name="ResultCanvas"
            component={ResultCanvasScreen}
            options={{ title: '결과', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="CardThread"
            component={CardThreadScreen}
            options={{ title: '스레드', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="NeuronDashboard"
            component={NeuronDashboardScreen}
            options={{ title: '뉴런 대시보드' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: '설정' }}
          />
        </Stack.Navigator>
        <StatusBar style="dark" />
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});