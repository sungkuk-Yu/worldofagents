import './defaults';
import { needsClientDisclaimer } from '../lib/legal';
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getCard } from './registry';
import UserCard from './UserCard';
import type { CardProps } from './types';
import { cardStyles as s } from './styles';
import { formatNumber } from '../i18n/format';

export function CardActions({ message, handlers }: CardProps) {
  const { t, i18n } = useTranslation();
  return <View style={s.actions}>
    {message.role === 'agent' && message.aiGenerated !== false && <Text style={s.micro} testID="ai-generated-badge">{t('common.aiGenerated')}</Text>}
    <TouchableOpacity style={s.action} onPress={() => handlers.openThread(message)}>
      <Text style={s.link}>{message.threadReplyCount === undefined ? t('cards.thread') : t('cards.replies', { count: message.threadReplyCount, countText: formatNumber(message.threadReplyCount, i18n.language) })}</Text>
    </TouchableOpacity>
    <TouchableOpacity style={s.action} accessibilityLabel={t(message.favorite ? 'cards.unfavorite' : 'cards.favorite')} accessibilityRole="button" accessibilityState={{ selected: !!message.favorite }} onPress={() => handlers.toggleFavorite(message)}>
      <Text style={s.link}>{t(message.favorite ? 'cards.starredIcon' : 'cards.starIcon')}</Text>
    </TouchableOpacity>
    <TouchableOpacity style={s.action} onPress={() => handlers.forkFromHere(message)}><Text style={s.link}>{t('fork.action')}</Text></TouchableOpacity>
  </View>;
}
export default function CardFrame(props: CardProps & { agentName: string; presetCategory?: string; compact?: boolean }) {
  const { t } = useTranslation();
  if (props.message.role === 'system') return <View style={s.action}><UserCard {...props} /></View>;
  const Component = props.message.role === 'agent' ? getCard(props.message.dialogueType) : UserCard;
  return <View style={props.compact ? undefined : s.frame} testID={props.message.role === 'user' ? 'message-user' : 'message-agent'}>
    {!props.compact && <Text style={s.title}>{props.message.role === 'user' ? t('chat.me') : props.agentName}</Text>}
    {React.createElement(Component, { ...props, payload: props.message.payload })}
    {props.message.role === 'agent' && needsClientDisclaimer(props.presetCategory, props.message.content) && <Text style={s.micro} testID="legal-disclaimer">{t('legal.disclaimer')}</Text>}
    {props.message.role === 'agent' && <CardActions {...props} />}
  </View>;
}
