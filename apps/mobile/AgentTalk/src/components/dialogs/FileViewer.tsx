import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CardProps } from '../../cards/types';
import { cardStyles as s } from '../../cards/styles';
import { displayValue, safeFileUrl } from '../../cards/payload';
export default function FileViewer({ message, payload, handlers }: Partial<CardProps> = {}) {
  const { t } = useTranslation();
  const url = safeFileUrl(payload?.url);
  return <View>
    <Text style={s.title}>{displayValue(payload?.name ?? payload?.title)}</Text>
    <Text style={s.body}>{message?.content || (!payload ? t('cards.noContent') : '')}</Text>
    <Text style={s.micro}>{displayValue(payload?.mime_type)}</Text>
    {!!displayValue(payload?.size) && <Text style={s.micro}>{t('cards.fileSize', { size: displayValue(payload?.size) })}</Text>}
    {url && handlers?.openFile && <TouchableOpacity style={s.action} onPress={() => handlers.openFile?.(url)}><Text style={s.link}>{t('cards.openFile')}</Text></TouchableOpacity>}
  </View>;
}
