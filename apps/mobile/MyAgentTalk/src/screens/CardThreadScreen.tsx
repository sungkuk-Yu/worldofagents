// 카드 스레드 — 전체 화면 라우트 버전 (ResultCanvas 경유 진입, 네이티브 스택 push 유지).
// #52: 채팅 → 스레드 진입은 ChatScreen의 바텀시트 디텐트(ThreadSheet)가 담당하고,
// 이 라우트는 스레드 간 중첩 이동(push)과 캔버스 경유 진입용이다. 내용부는 ThreadPanel 공유.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ThreadPanel from '../components/ThreadPanel';
import { webScreenMotion } from '../theme';

export default function CardThreadScreen({ navigation, route }: { navigation: any; route: any }) {
  const { t } = useTranslation();
  const sessionId = typeof route?.params?.sessionId === 'string' ? route.params.sessionId : undefined;
  const rootMessageId = typeof route?.params?.rootMessageId === 'string' ? route.params.rootMessageId : undefined;
  return <View style={[{ flex: 1 }, webScreenMotion('mat-slide-from-bottom')]}>
    <ThreadPanel
      navigation={navigation}
      onBack={() => navigation.goBack()}
      target={{
        sessionId,
        rootMessageId,
        agentName: route?.params?.agentName || t('common.agent'),
        presetCategory: route?.params?.presetCategory,
        sessionTitle: route?.params?.sessionTitle,
      }}
    />
  </View>;
}
