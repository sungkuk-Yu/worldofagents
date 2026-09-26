import './defaults';
import { needsClientDisclaimer } from '../lib/legal';
import React, { useCallback, useSyncExternalStore } from 'react';
import { LayoutAnimation, Platform, Pressable, Text, TouchableOpacity, UIManager, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getCard, getCardPreview, isCardRegistered } from './registry';
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

export function CardActions({ message, handlers, withFavorite = true, compact }: CardProps & { withFavorite?: boolean; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  return <View style={s.actions}>
    {message.role === 'agent' && message.aiGenerated !== false && <Text style={s.micro} testID="ai-generated-badge">{t('common.aiGenerated')}</Text>}
    <TouchableOpacity style={s.action} onPress={() => handlers.openThread(message)}>
      <Text style={s.link}>{message.threadReplyCount === undefined ? t('cards.thread') : t('cards.replies', { count: message.threadReplyCount, countText: formatNumber(message.threadReplyCount, i18n.language) })}</Text>
    </TouchableOpacity>
    {/* Wave 2 (t_174b66d2): 대화 → 볼트/칸반 — 백엔드 from-message API (에이전트 카드, compact=스레드 행 제외) */}
    {message.role === 'agent' && !compact && handlers.saveToVault && <TouchableOpacity style={s.action} accessibilityRole="button" accessibilityLabel={t('vault.saveAction')} onPress={() => { void handlers.saveToVault!(message); }} testID="card-vault-save">
      <Text style={s.link}>{t('vault.saveAction')}</Text>
    </TouchableOpacity>}
    {message.role === 'agent' && !compact && handlers.addCardToBoard && <TouchableOpacity style={s.action} accessibilityRole="button" accessibilityLabel={t('vault.boardAction')} onPress={() => { void handlers.addCardToBoard!(message); }} testID="card-board-add">
      <Text style={s.link}>{t('vault.boardAction')}</Text>
    </TouchableOpacity>}
    {withFavorite && <TouchableOpacity style={s.action} accessibilityLabel={t(message.favorite ? 'cards.unfavorite' : 'cards.favorite')} accessibilityRole="button" accessibilityState={{ selected: !!message.favorite }} onPress={() => handlers.toggleFavorite(message)}>
      <Text style={s.link}>{t(message.favorite ? 'cards.starredIcon' : 'cards.starIcon')}</Text>
    </TouchableOpacity>}
    <TouchableOpacity style={s.action} onPress={() => handlers.forkFromHere(message)}><Text style={s.link}>{t('fork.action')}</Text></TouchableOpacity>
  </View>;
}

// 즐겨찾기 ⭐ — 대표님 지시(9/26): 카드 헤더 우상단 고정. 비활성=옅은 외곽선(☆·text3), 활성=채운 별(★·accent).
export function FavoriteStar({ message, handlers }: CardProps) {
  const { t } = useTranslation();
  return <TouchableOpacity style={s.starTop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    accessibilityLabel={t(message.favorite ? 'cards.unfavorite' : 'cards.favorite')} accessibilityRole="button"
    accessibilityState={{ selected: !!message.favorite }} onPress={() => handlers.toggleFavorite(message)} testID="card-favorite">
    <Text style={[s.starTopText, message.favorite ? s.starTopActive : s.starTopIdle]}>{t(message.favorite ? 'cards.starredIcon' : 'cards.starIcon')}</Text>
  </TouchableOpacity>;
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
    {!props.compact && <View style={s.headerRow}>
      <Text style={[s.title, s.headerTitle]} numberOfLines={1}>{props.message.role === 'user' ? t('chat.me') : props.agentName}</Text>
      {/* 즐겨찾기 ⭐ = 카드 우상단 고정 (대표님 지시 9/26) — 하단 액션라인에서는 제외(compact 행은 헤더 없음 → 유지) */}
      {props.message.role === 'agent' && <FavoriteStar {...props} />}
    </View>}
    {expanded || !showHandle ? (
      React.createElement(Component, { ...props, payload: props.message.payload })
    ) : getCardPreview(props.message.dialogueType) && props.message.role === 'agent' ? (
      // 카드별 커스텀 접힘 렌더러 (Wave1: media=poster 썸네일) — 텍스트 요약으로 못 그리는 유형용
      React.createElement(getCardPreview(props.message.dialogueType)!, { ...props, payload: props.message.payload })
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
    {/* compact(스레드 행)는 헤더 없음 → 즐겨찾기를 하단 액션에 유지. 일반 카드는 ⭐ 우상단 고정. */}
    {props.message.role === 'agent' && <CardActions {...props} withFavorite={props.compact === true} />}
  </View>;
}
