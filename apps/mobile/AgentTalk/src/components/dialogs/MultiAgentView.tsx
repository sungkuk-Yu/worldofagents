import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CardProps } from '../../cards/types';
import { cardStyles as s } from '../../cards/styles';
import { displayValue, records } from '../../cards/payload';

export default function MultiAgentView({ message, payload }: Partial<CardProps> = {}) {
  const { t } = useTranslation();
  const agents = records(payload?.agents);
  return <View>{agents.length ? agents.map((agent, index) => <View key={index}>
    <Text style={s.title}>{displayValue(agent.name) || t('common.agent')}</Text>
    <Text style={s.body}>{displayValue(agent.content ?? agent.result)}</Text>
  </View>) : <Text style={s.body}>{message?.content || t('cards.noContent')}</Text>}</View>;
}
