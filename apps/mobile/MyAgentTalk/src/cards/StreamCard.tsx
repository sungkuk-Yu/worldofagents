// ① single card ID patch — 인라인 스트리밍 카드 (t_5c559e85, Telegram edit-in-place 규범)
// delta마다 새 카드가 아니라 같은 run의 고정 카드(stream-<runId>) content만 갱신되어 여기로 렌더된다.
// 확정 message.new(서버 answer 행)가 같은 자리에 오면 이 카드는 제거된다(ID merge 상당).
// ③ placeholder — content가 빈 토큰 전 카드도 같은 자리에 quip만 보여 점프를 없앤다.
import React from 'react';
import { Platform, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { CardProps } from './types';
import RichText from '../components/RichText';
import { cardStyles as s } from './styles';
import { renderFlags } from '../lib/renderFlags';

// ② contain:layout (t_5c559e85, Open WebUI 픽스 1단계) — 스트리밍 컨테이너 내부의 재레이아웃이
// 상위(리스트 전체)로 전파되는 것을 CSS layout containment로 차단. 웹 전용 CSS(네이티브 무해).
// size containment가 아니라 자기 키높이는 콘텐츠대로 산출 → FlatList onLayout 측정 불변.
const CONTAIN_WEB = Platform.OS === 'web' && renderFlags.streamContain
  ? ({ contain: 'layout' } as unknown as React.ComponentProps<typeof View>['style'])
  : undefined;

export default function StreamCard({ message }: CardProps) {
  const { t } = useTranslation();
  const done = message.payload?.streamDone === true;
  const quip = typeof message.payload?.streamQuip === 'string' ? message.payload.streamQuip : 'quip.default';
  return <View style={[s.frame, CONTAIN_WEB]} testID={`stream-card-${message.runId ?? message.id}`}>
    {message.content
      ? <RichText content={message.content} />
      : <Text style={[s.body, s.micro]} accessibilityLiveRegion="polite">{t(quip)}</Text>}
    {!done && <Text testID="stream-live-mark" style={s.micro}>{t(quip)}</Text>}
    <Text testID="ai-generated-badge" style={s.micro}>{t('common.aiGenerated')}</Text>
  </View>;
}
