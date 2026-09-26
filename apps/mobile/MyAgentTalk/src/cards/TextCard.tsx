import React from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CardProps } from './types';
import { cardStyles } from './styles';
export default function TextCard({ message }: CardProps) {
  const { t } = useTranslation();
  return <Text style={cardStyles.body}>{message.contentKey ? t(message.contentKey, message.contentParams) : message.content}</Text>;
}
