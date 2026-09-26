import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CardProps } from '../../cards/types';
import { cardStyles as s } from '../../cards/styles';
import { displayValue, records } from '../../cards/payload';

export default function InfoCard({ message, payload }: Partial<CardProps> = {}) {
  const { t } = useTranslation();
  const fields = records(payload?.fields);
  return <View>
    {!!displayValue(payload?.title) && <Text style={s.title}>{displayValue(payload?.title)}</Text>}
    {fields.length ? fields.map((field, index) => <View key={index} style={s.row}><Text style={s.title}>{displayValue(field.label ?? field.name)}</Text><Text style={s.body}>{displayValue(field.value)}</Text></View>)
      : <Text style={s.body}>{message?.content || t('cards.noContent')}</Text>}
  </View>;
}
