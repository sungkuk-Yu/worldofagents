import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CardProps } from '../../cards/types';
import { cardStyles as s } from '../../cards/styles';
import { displayValue, records } from '../../cards/payload';

const statusKeys: Record<string, string> = {
  pending: 'cards.pending', 'in-progress': 'cards.inProgress', in_progress: 'cards.inProgress',
  completed: 'cards.done', done: 'cards.done', failed: 'cards.failed', cancelled: 'cards.cancelled',
};
export default function TaskFlow({ message, payload, handlers }: Partial<CardProps> = {}) {
  const { t } = useTranslation();
  const items = records(payload?.items);
  return <View>
    {!!displayValue(payload?.title) && <Text style={s.title}>{displayValue(payload?.title)}</Text>}
    {items.length ? items.map((item, index) => {
      const override = message?.taskOverrides?.[index];
      const done = override ?? (item.status === 'completed' || item.status === 'done');
      const statusKey = override === undefined ? statusKeys[displayValue(item.status)] || 'cards.pending' : done ? 'cards.done' : 'cards.pending';
      return <TouchableOpacity key={index} style={s.row} accessibilityRole="checkbox" accessibilityState={{ checked: done }} disabled={!message || !handlers?.toggleTaskDone}
        onPress={() => message && handlers?.toggleTaskDone?.(message, index, done)}>
        <Text style={s.link}>{t(done ? 'cards.checkedIcon' : 'cards.uncheckedIcon')}</Text>
        <Text style={s.body}>{displayValue(item.title)}</Text>
        <Text style={s.micro}>{t(statusKey)}</Text>
      </TouchableOpacity>;
    }) : <Text style={s.body}>{message?.content || t('cards.noContent')}</Text>}
  </View>;
}
