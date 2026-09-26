import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { CardProps } from './types';
import { cardStyles } from './styles';
import RichText from '../components/RichText';
import RichLinks from '../components/RichLinks';
import { safePayloadLinks } from '../lib/richtext';
export default function TextCard({ message }: CardProps) {
  const { t } = useTranslation();
  // contentKey(시스템 안내문 등 로컬 문자열)는 평문 렌더 — 리치텍스트는 에이전트 응답용
  if (message.contentKey) return <Text style={cardStyles.body}>{t(message.contentKey, message.contentParams)}</Text>;
  const links = safePayloadLinks(message.payload?.links);
  return <View>
    <RichText content={message.content} />
    {links.length > 0 && <RichLinks links={links} />}
  </View>;
}
