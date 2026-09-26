import './defaults';
import { needsClientDisclaimer } from '../lib/legal';
import React, { useCallback, useSyncExternalStore } from 'react';
import { LayoutAnimation, Platform, Pressable, Text, TouchableOpacity, UIManager, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getCard, isCardRegistered } from './registry';
import UserCard from './UserCard';
import type { CardProps } from './types';
import { cardStyles as s } from './styles';
import { buildCardPreview } from './preview';
import { expandStore } from './expandStore';
import { formatNumber } from '../i18n/format';
import { useReduceMotion } from '../lib/motion';

// 웹: LayoutAnimation은 no-op → CSS transition 폴백 (#52 규칙 6, styles.webTransition).
// 네이티브: 스프링 프리셋 — ease-in/out 금지, 애플 계열 snappy 곡선 (#52 규칙 1).
if (Platform.OS !== 'web' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const expandAnimation = (skip: boolean) => {
  if (skip || Platform.OS === 'web') return;
  LayoutAnimation.configureNext({
    duration: 260,
    create: { type: LayoutAnimation.Types.spring, property: LayoutAnimation.Properties.scaleY },
    update: { type: LayoutAnimation.Types.spring, property: LayoutAnimation.Properties.opacity },
  });
};

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

// 미등록 dialogue_type 폴백 — 제목 + JSON 접기 (#51: 백엔드가 새 카드 타입을 추가해도 프론트 재배포 없이 기본 렌더)
function FallbackCard({ message, payload }: { message: CardProps['message']; payload?: CardProps['payload'] }) {
  const { t } = useTranslation();
  const keys = payload ? Object.keys(payload) : [];
  return <View style={s.webTransition}>
    {!!message.content && <Text style={s.body}>{message.content}</Text>}
    {!!keys.length && <View style={s.fallbackJson}>
      <Text style={s.micro}>{t('cards.unknownType', { type: message.dialogueType ?? '?' })}</Text>
      {keys.map((key) => {
        const value = payload?.[key];
        const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : JSON.stringify(value);
        return <View key={key} style={s.row}>
          <Text style={s.micro}>{key}</Text>
          <Text style={s.body} numberOfLines={4}>{text}</Text>
        </View>;
      })}
    </View>}
  </View>;
}

// 기능형 카드 프레임 — 대표님 지시 #51 (펼치기/접기 유연성, Perplexity 소스 카드 패턴)
// 기본 접힘(1~2줄 미리보기) → 탭으로 펼침(전체 payload) → 다시 탭하면 접힘.
// 각 카드 독립 상태(expandStore) — 아코디언 아님, 여러 카드를 동시에 열어 비교 가능.
// 법률 표기(ai_generated·디스클레이머)와 액션 행은 접힘 상태에서도 항상 노출 (법률 요구 — 숨김 금지).
export default function CardFrame(props: CardProps & { agentName: string; presetCategory?: string; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReduceMotion();
  const messageId = props.message.id;
  const expandedState = useSyncExternalStore(expandStore.subscribe, () => expandStore.get(messageId), () => false);
  const toggleExpand = useCallback(() => { expandAnimation(reduceMotion); expandStore.toggle(messageId); }, [messageId, reduceMotion]);
  if (props.message.role === 'system') return <View style={s.action}><UserCard {...props} /></View>;
  const knownType = isCardRegistered(props.message.dialogueType);
  const Component = props.message.role === 'agent' ? (knownType ? getCard(props.message.dialogueType) : FallbackCard) : UserCard;
  // 사용자 카드(text)는 펼침 UI 대상이 아님 — 에이전트 기능형 카드만 (compact=스레드 행도 제외)
  const isAgentCard = props.message.role === 'agent' && !props.compact;
  const preview = isAgentCard
    ? buildCardPreview(props.message.dialogueType, props.message.payload, props.message.content, knownType)
    : null;
  const showHandle = isAgentCard && preview?.expandable === true;
  const expanded = showHandle && expandedState;

  // 발신자 구분 = 영역(zone) 방식 (#54): 사용자 = 연그린 밴드 전체폭 행, 에이전트 = 흰 카드. 좌우 말풍선 금지.
  return <View style={props.compact ? undefined : (props.message.role === 'user' ? s.userFrame : s.frame)} testID={props.message.role === 'user' ? 'message-user' : 'message-agent'}>
    {!props.compact && <Text style={s.title}>{props.message.role === 'user' ? t('chat.me') : props.agentName}</Text>}
    {expanded || !showHandle ? (
      React.createElement(Component, { ...props, payload: props.message.payload })
    ) : (
      // 접힘 상태 — 카드 종류별 미리보기 (info=제목+한 줄, data=첫 N행+"N행 더", file=파일명, task=상태 배지, multi=에이전트 나열)
      <View style={s.webTransition}>
        {!!preview.title && <Text style={s.title} numberOfLines={1}>{preview.title}</Text>}
        {!!preview.summary && <Text style={s.body} numberOfLines={2}>{preview.summary}</Text>}
        <View style={s.previewMeta}>
          {!!preview.badge && <Text style={s.badge} testID="card-preview-badge">{preview.badge}</Text>}
          {preview.moreCount > 0 && <Text style={s.micro} testID="card-preview-more">{t('cards.moreRows', { countText: formatNumber(preview.moreCount, i18n.language) })}</Text>}
          {preview.unknownType && <Text style={s.micro} numberOfLines={1}>{t('cards.unknownType', { type: props.message.dialogueType ?? '?' })}</Text>}
        </View>
      </View>
    )}
    {showHandle && <Pressable
      onPress={toggleExpand}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={expanded ? t('cards.collapse') : t('cards.expand')}
      testID={expanded ? 'card-collapse' : 'card-expand'}
      style={s.expandHandle}
    >
      <Text style={s.expandHandleText}>{expanded ? `${t('cards.collapse')} ⌃` : `${t('cards.expand')} ⌄`}</Text>
    </Pressable>}
    {props.message.role === 'agent' && needsClientDisclaimer(props.presetCategory, props.message.content) && <Text style={s.micro} testID="legal-disclaimer">{t('legal.disclaimer')}</Text>}
    {props.message.role === 'agent' && <CardActions {...props} />}
  </View>;
}
