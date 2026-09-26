import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CardProps } from '../../cards/types';
import { cardStyles as s } from '../../cards/styles';
import { displayValue } from '../../cards/payload';
import { isRecord } from '../../lib/chatLogic';
export default function SpreadsheetView({ message, payload }: Partial<CardProps> = {}) {
  const { t } = useTranslation();
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!columns.length || !rows.length) return <Text style={s.body}>{message?.content || t('cards.noContent')}</Text>;
  return <ScrollView horizontal><View>
    <View style={s.row}>{columns.map((col, i) => <Text key={i} style={[s.cell, s.title]}>{displayValue(isRecord(col) ? col.title ?? col.label ?? col.key : col)}</Text>)}</View>
    {rows.map((row, i) => <View key={i} style={s.row}>{columns.map((col, j) => {
      const key = isRecord(col) ? displayValue(col.key ?? col.name) : displayValue(col);
      return <Text key={j} style={[s.cell, s.body]}>{displayValue(Array.isArray(row) ? row[j] : isRecord(row) ? row[key] : undefined)}</Text>;
    })}</View>)}
  </View></ScrollView>;
}
