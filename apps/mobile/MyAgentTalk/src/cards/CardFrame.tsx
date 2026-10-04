import './defaults';
import { needsClientDisclaimer } from '../lib/legal';
import React, { useCallback, useState, useSyncExternalStore } from 'react';
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
import { ChevronDownIcon, ChevronUpIcon, StarIcon, BookOpenIcon } from '../components/Icon';
import { ExportMenu } from '../components/ExportMenu';
import ReaderModal from '../components/ReaderModal';
import StreamCard from './StreamCard';
import { ONE_SCREEN_PX, guessLong, resolveExpanded } from '../lib/readerLogic';
import { colors, iconSize } from '../theme';

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

/** t_7f86eefb 라벨: 답글 열기 키 = '쓰레드' (+답글 수 배지 '(N)'). 목록/카운트 문구(답글 N개)와 구분. */
const threadActionLabel = (t: (k: string) => string, i18n: { language: string }, count: number | undefined) =>
  count === undefined || count <= 0 ? t('cards.threadFrom') : `${t('cards.threadFrom')} (${formatNumber(count, i18n.language)})`;

/**
 * t_7f86eefb (대표님 10/4) — '쓰레드'(답글 열기)/새프로젝트 키를 카드 우측 상단 클러스터로 이동.
 * 구배치(하단부)는 에이전트 답변이 길어질수록 버튼이 화면 아래로 밀려 도달 불가 → 슬랙/텔레그램 웹
 * 메시지 툴바 패턴으로 상단 고정. testID(card-thread-start/card-fork)·핸들러 계약 불변, 라벨만 이동.
 * fork는 김비서 room 전용 게이트(canFork) 유지 — 생략 시 렌더 없음(데이터 보존).
 */
export function CardHeaderActions({ message, handlers, canFork = true }: CardProps & { canFork?: boolean }) {
  const { t, i18n } = useTranslation();
  return <View style={s.headerActions}>
    <TouchableOpacity style={s.headerAction} accessibilityRole="button" onPress={() => handlers.openThread(message)} testID="card-thread-start">
      <Text style={s.headerActionText} numberOfLines={1}>{threadActionLabel(t, i18n, message.threadReplyCount)}</Text>
    </TouchableOpacity>
    {canFork && <TouchableOpacity style={s.headerAction} accessibilityRole="button" onPress={() => handlers.forkFromHere(message)} testID="card-fork">
      <Text style={s.headerActionText} numberOfLines={1}>{t('fork.action')}</Text>
    </TouchableOpacity>}
  </View>;
}

/**
 * 하단 액션 행. t_7f86eefb 이후 일반(피드) 카드는 AI 고지만 남고 쓰레드/새프로젝트는 상단 클러스터로 이동.
 * compact(스레드 패널 행)는 헤더가 없으므로 하단부에 쓰레드/즐겨찾기/새프로젝트 전체를 유지(기동 계약).
 */
export function CardActions({ message, handlers, withFavorite = true, canFork = true }: CardProps & { withFavorite?: boolean; canFork?: boolean }) {
  const { t, i18n } = useTranslation();
  return <View style={s.actions}>
    {message.role === 'agent' && message.aiGenerated !== false && <Text style={s.micro} testID="ai-generated-badge">{t('common.aiGenerated')}</Text>}
    {/* t_a0e998cc (대표님 9/26): 볼트/보드 저장·보관 액션 제거 — 카드는 기본적으로 볼트에 올라가고
        즐겨찾기가 있으므로 별도 보관은 불필요. t_7f86eefb (10/4): compact 행만 하단 액션 유지. */}
    {withFavorite && <>
      <TouchableOpacity style={s.action} onPress={() => handlers.openThread(message)} testID="card-thread-start">
        <Text style={s.link}>{threadActionLabel(t, i18n, message.threadReplyCount)}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.action} accessibilityLabel={t(message.favorite ? 'cards.unfavorite' : 'cards.favorite')} accessibilityRole="button" accessibilityState={{ selected: !!message.favorite }} onPress={() => handlers.toggleFavorite(message)}>
        {/* t_64af90b0 #2 — ☆/★ 텍스트 글리프 → SVG 아이콘 (이모지/문자 아이콘 금지) */}
        <StarIcon size={iconSize.tile} color={message.favorite ? colors.accent : colors.text3} />
      </TouchableOpacity>
      {/* 새프로젝트(fork)는 김비서 room 전용 (대표님 지시 9/27) — other room에서는 렌더 생략(데이터 보존) */}
      {canFork && <TouchableOpacity style={s.action} onPress={() => handlers.forkFromHere(message)} testID="card-fork"><Text style={s.link}>{t('fork.action')}</Text></TouchableOpacity>}
    </>}
  </View>;
}

// 즐겨찾기 — 대표님 지시(9/26): 카드 헤더 우상단 고정. t_64af90b0 #2: ☆/★ 문자 대신 SVG 별 아이콘
// (비활성=outline·text3, 활성=filled·accent).
export function FavoriteStar({ message, handlers }: CardProps) {
  const { t } = useTranslation();
  return <TouchableOpacity style={s.starTop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    accessibilityLabel={t(message.favorite ? 'cards.unfavorite' : 'cards.favorite')} accessibilityRole="button"
    accessibilityState={{ selected: !!message.favorite }} onPress={() => handlers.toggleFavorite(message)} testID="card-favorite">
    <StarIcon size={iconSize.glyph} filled={!!message.favorite} color={message.favorite ? colors.accent : colors.text3} />
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

// 기능형 카드 프레임 — #51 펼침/접기 유연성 → t_3116c5bc semantics 전환 (대표님 9/28深夜 지시)
// **본문 전부 펼침이 기본.** 실측(온레이아웃) 또는 길이 추정이 1 화면(≈1200px)을 넘을 때만
// '더 보기 ▾'로 접고, 펼침은 인라인(모달 아님). 긴 카드는 하단 '전체 읽기' → 리더 모달(§2).
// 각 카드 독립 상태(expandStore) — 아코디언 아님. 법률 표기·액션 행은 어떤 상태든 항상 노출(숨김 금지).
// compact(스레드 행)는 읽기 전용 행 — 펼침/내보내기 UI 없이 전체본문 그대로(중첩 모달 금지).
export default function CardFrame(props: CardProps & { agentName: string; presetCategory?: string; compact?: boolean; canFork?: boolean; showHeader?: boolean; /** t_55b7e30c 발화자 이름 우선값(서버 agent_name) — 없으면 agentName(라우트/프리셋) 표시 */ senderName?: string; /** t_55b7e30c 연속 발화 그룹 내부 카드 — 좌 오프셋으로 묶음 시각화 */ continuation?: boolean; sessionTitle?: string; exportDisabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReduceMotion();
  const messageId = props.message.id;
  // 스냅샷은 프리미티브 2개 — 객체 셀렉터는 매 렌더 새 참조라 useSyncExternalStore 무한리렌더 유발.
  const choice = useSyncExternalStore(expandStore.subscribe, () => expandStore.peek(messageId), () => undefined);
  const bodyHeight = useSyncExternalStore(expandStore.subscribe, () => expandStore.height(messageId), () => 0);
  const [readerOpen, setReaderOpen] = useState(false);
  const knownType = isCardRegistered(props.message.dialogueType);
  // 사용자 카드(text)는 펼침 UI 대상이 아님 — 에이전트 기능형 카드만 (compact=스레드 행도 제외)
  const isAgentCard = props.message.role === 'agent' && !props.compact;
  const preview = isAgentCard
    ? buildCardPreview(props.message.dialogueType, props.message.payload, props.message.content, knownType)
    : null;
  // potential: 접을 내용이 존재하는 카드 (#51 규칙 4). long = 실측(우선) 또는 길이 추정 가드로 1 화면(≈1200px) 초과 판정.
  const potential = isAgentCard && preview?.expandable === true;
  const collapsible = potential && (bodyHeight > 0 ? bodyHeight > ONE_SCREEN_PX : guessLong(props.message));
  // 펼침 = 기본. long 카드만 auto 접힘; 사용자 수동 선택(choice)이 auto를 덮는다.
  const expanded = !collapsible || resolveExpanded(choice, bodyHeight, guessLong(props.message), ONE_SCREEN_PX);
  const long = collapsible; // 리더 노출 기준 = auto 판정(장문이면 펼친 상태에도 '전체 읽기' 유지)
  // hook은 early return보다 위에서 전부 호출 (rules-of-hooks — 시스템 카드 분기 이후로 내리면 금지).
  const toggleExpand = useCallback(() => {
    expandAnimation(reduceMotion);
    expandStore.toggle(messageId, expanded);
  }, [messageId, expanded, reduceMotion]);
  // 펼친 본문만 실측 — 접힌 프리뷰 높이를 세면 전체 높이가 오염된다. (short 카드는 첫 프레임부터 펼침 → 실측 확보)
  const measureBody = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    if (!potential) return;
    expandStore.setHeight(messageId, e.nativeEvent.layout.height);
  }, [messageId, potential]);
  if (props.message.role === 'system') return <View style={s.action}><UserCard {...props} /></View>;
  // ① single card ID patch (t_5c559e85): 인라인 스트림 카드는 본문+quip만 — 액션/펼침/리더 대상 아님(잔류 금지).
  if (props.message.status === 'streaming') return <StreamCard {...props} />;
  const Component = props.message.role === 'agent' ? (knownType ? getCard(props.message.dialogueType) : FallbackCard) : UserCard;

  // 발신자 구분 = 영역(zone) 방식 (#54): 사용자 = 밴드 전체폭 행, 에이전트 = 흰 카드. 좌우 말풍선 금지.
  // t_64af90b0 #1: 사용자 카드의 '나' 라벨 행 제거 — 밴드+액센트 바만으로 구분 (버블/라벨 중복 금지, #59 재확인).
  // t_64af90b0 #3: 에이전트명 텍스트는 showHeader=true(첫 에이전트 메시지)에만 노출 — 이후 생략(Linear/Slack식).
  // 단 우상단 즐겨찾기 별은 전 카드 유지 (9/26 지시 — 별은 라벨이 아니라 컨트롤).
  // t_3116c5bc §3: 즐겨찾기 옆 다운로드 아이콘(카드 내보내기) — 전 에이전트 카드 무조건 노출.
  const showHeader = props.showHeader !== false;
  // t_55b7e30c: 발화자 이름 = 서버 agent_name 우선, 없으면 라우트/프리셋 agentName.
  // continuation(같은 그룹 연속 카드) = 좌 오프셋으로 묶음 시각화 (텔레그램식; 헤더는 이미 생략됨).
  const senderLabel = props.senderName || props.agentName;
  return <View style={[props.compact ? undefined : (props.message.role === 'user' ? s.userFrame : s.frame), props.continuation && !props.compact && props.message.role === 'agent' && s.groupContinuation]} testID={props.message.role === 'user' ? 'message-user' : 'message-agent'}>
    {/* t_b250487a 대표님 확정 계약 반전(9/27 심야): 사용자=전체폭 밴드+"나" 라벨.
        t_64af90b0 #1이 '나' 라벨을 제거했으나 본 계약(밴드+라벨, 에이전트=작성자 라인과 대칭)이 우선 — 두 결정 병기.
        라벨은 i18n t('chat.me') 유지(ko '나'/en 'You'), 좌우 정렬·버블 아닌 밴드 상단 라인. */}
    {!props.compact && props.message.role === 'user' && <Text style={s.userLabel} testID="message-user-label">{t('chat.me')}</Text>}
    {!props.compact && props.message.role === 'agent' && <View style={s.headerRow}>
      {showHeader ? <Text style={[s.title, s.headerTitle]} numberOfLines={1} testID="card-sender">{senderLabel}</Text> : <View style={s.headerSpacer} />}
      {/* t_7f86eefb (대표님 10/4) — 답글(쓰레드)/새프로젝트 키를 카드 우측 상단으로. 본문이 길어져도
          헤더 라인은 카드 최상단 고정이라 버튼이 아래로 밀리지 않는다. 그룹 연속 카드(showHeader=false)도
          동일 위치 유지(단, 이름 라벨 대신 스페이서). */}
      <CardHeaderActions message={props.message} handlers={props.handlers} canFork={props.canFork !== false} />
      <ExportMenu message={props.message} sessionTitle={props.sessionTitle || props.agentName}
        disabled={props.exportDisabled === true || props.message.pending === true || props.message.status === 'failed'} />
      <FavoriteStar {...props} />
    </View>}
    {/* 펼친 본문만 실측(preview 스왑) — 접힌 프리뷰 높이로 전체 높이가 오염되지 않는다. */}
    <View onLayout={expanded && potential ? measureBody : undefined}>
      {expanded || !collapsible ? (
        React.createElement(Component, { ...props, payload: props.message.payload })
      ) : getCardPreview(props.message.dialogueType) && props.message.role === 'agent' ? (
        // 커스텀 접힘 렌더러 (media=poster) — 텍스트 요약으로 못 그리는 유형 (사용자 수동 접힘 시)
        React.createElement(getCardPreview(props.message.dialogueType)!, { ...props, payload: props.message.payload })
      ) : (
        // '더 보기' 접힘 상태 — 카드 종류별 미리보기 (info=제목+한 줄, data=첫 N행+N행 더, task=상태 배지)
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
    </View>
    {collapsible && <Pressable
      onPress={toggleExpand}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={expanded ? t('cards.collapse') : t('cards.expand')}
      testID={expanded ? 'card-collapse' : 'card-expand'}
      style={s.expandHandle}
    >
      {/* t_64af90b0 #2 — ⌃/⌄ 문자 글리프 → SVG chevron */}
      <View style={s.row}>
        <Text style={s.expandHandleText}>{expanded ? t('cards.collapse') : t('cards.more')}</Text>
        {expanded ? <ChevronUpIcon size={iconSize.tile} color={colors.accent} /> : <ChevronDownIcon size={iconSize.tile} color={colors.accent} />}
      </View>
    </Pressable>}
    {/* 전체 읽기 (t_3116c5bc §2) — 1 화면을 넘는 장문·표형 카드에만 하단 노출 → 페이퍼 리더 모달 */}
    {long && <TouchableOpacity style={s.readerHandle} onPress={() => setReaderOpen(true)}
      accessibilityRole="button" accessibilityLabel={t('reader.open')} testID="reader-open">
      <View style={s.row}>
        <BookOpenIcon size={iconSize.tile} color={colors.accent} />
        <Text style={s.expandHandleText}>{t('reader.open')}</Text>
      </View>
    </TouchableOpacity>}
    {props.message.role === 'agent' && needsClientDisclaimer(props.presetCategory, props.message.content) && <Text style={s.micro} testID="legal-disclaimer">{t('legal.disclaimer')}</Text>}
    {/* compact(스레드 행)는 헤더 없음 → 즐겨찾기를 하단 액션에 유지. 일반 카드는 별 우상단 고정. */}
    {props.message.role === 'agent' && <CardActions {...props} withFavorite={props.compact === true} />}
    {isAgentCard && <ReaderModal message={readerOpen ? props.message : null} agentName={props.agentName} onClose={() => setReaderOpen(false)} />}
  </View>;
}
