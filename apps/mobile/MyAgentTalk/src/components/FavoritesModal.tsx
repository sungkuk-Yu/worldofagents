// 즐겨찾기 상단 모달 (t_fd869e5b 요구3, 대표님 10/4: "즐겨찾기는 모달로 상단부에 내비줘서 바로 찾아
// 볼수 있도록") — 헤더 ★ 탭 → 화면 상단에서 내려오는 시트로 즉시 열람.
// FavoritesScreen의 목록/딥링크 로직을 그대로 재사용한다 (GET /api/favorites + 카드 프리뷰(#51 규칙)
// + focusMessageId 스크롤/하이라이트 딥링크 + ⭐ 재탭 해제 낙관/롤백). 라우트(Favorites)는
// 조이스틱 '즐겨찾기' 매크로 등 다른 진입점 호환 위해 보존 — 헤더 버튼만 모달로 전환.
// 시트 위치: 상단 (하단 시트 관례와 구별 — '상단부' 지시). fade backdrop + ✕/배경 탭 닫기.
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { api, FavoriteEntry } from '../lib/api';
import { errorKey } from '../lib/errorKeys';
import { normalizeServerMessages } from '../lib/chatLogic';
import { buildCardPreview } from '../cards/preview';
import { isCardRegistered } from '../cards/registry';
import { formatDayLabel } from '../i18n/format';
import { StarIcon } from './Icon';
import { colors, radii, spacing, typography, iconSize } from '../theme';

const PAGE = 50;

interface Props {
  visible: boolean;
  onClose: () => void;
  navigation: any;
}

export default function FavoritesModal({ visible, onClose, navigation }: Props) {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<FavoriteEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number, replace: boolean) => {
    try {
      const env = await api.listFavorites({ limit: PAGE, offset: nextOffset });
      if (!env.ok) throw new Error('errors.request');
      setError(null);
      setEntries((prev) => (replace ? env.data ?? [] : [...prev, ...(env.data ?? [])]));
      setHasMore(env.meta?.has_more === true);
      setOffset(nextOffset + (env.data?.length ?? 0));
    } catch (e) { setError(errorKey(e)); }
    finally { setLoading(false); }
  }, []);

  // 오픈 때마다 새로고침 — 카드 ⭐ 즐겨찾기 직후 열어본다는 요구 취지(캐시 staleness 금지).
  // 타이머 래퍼로 effect 동기 setState 회피 (FavoritesScreen load 패턴).
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    const timer = setTimeout(() => { void load(0, true); }, 0);
    return () => clearTimeout(timer);
  }, [visible, load]);

  const unfavorite = (entry: FavoriteEntry) => {
    setEntries((prev) => prev.filter((e) => e.message.id !== entry.message.id));
    api.setFavorite(entry.message.id, false).catch(() => {
      setEntries((prev) => (prev.some((e) => e.message.id === entry.message.id) ? prev : [...prev, entry].sort((a, b) => (a.message.created_at ?? '').localeCompare(b.message.created_at ?? '')).reverse()));
      setError('errors.favorite');
    });
  };

  // 딥링크 재사용 (Wave1): 원본 세션 + focusMessageId → ChatScreen 스크롤+하이라이트. 모달은 닫고 이동.
  const openSource = (entry: FavoriteEntry) => {
    onClose();
    navigation.navigate('Chat', {
      sessionId: entry.session.id,
      sessionTitle: entry.session.title ?? undefined,
      agentName: entry.session.agent_name ?? t('common.agent'),
      focusMessageId: entry.message.id,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} testID="favorites-modal-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal testID="favorites-modal">
          <View style={styles.header}>
            <StarIcon size={iconSize.glyph} color={colors.accent} filled />
            <Text style={styles.title}>{t('favorites.title')}</Text>
            <Pressable onPress={onClose} accessibilityLabel={t('common.close')} testID="favorites-modal-close" style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {loading && <Text style={styles.stateText}>{t('chat.connecting')}</Text>}
            {!!error && !loading && (
              <Pressable accessibilityRole="button" onPress={() => { setLoading(true); void load(0, true); }} testID="favorites-modal-retry">
                <Text style={styles.errorText}>{t(error)}</Text>
              </Pressable>
            )}
            {!loading && !error && entries.length === 0 && (
              <View style={styles.emptyWrap}>
                <StarIcon size={iconSize.hero} color={colors.borderStrong} />
                <Text style={styles.emptyText}>{t('favorites.empty')}</Text>
              </View>
            )}
            {entries.map((entry) => {
              const message = normalizeServerMessages([entry.message])[0];
              if (!message) return null;
              const known = isCardRegistered(message.dialogueType);
              const preview = buildCardPreview(message.dialogueType, message.payload, message.content, known);
              const date = message.createdAt ? new Date(message.createdAt) : null;
              return (
                <Pressable key={message.id} onPress={() => openSource(entry)} testID={`favorite-${message.id}`}
                  style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceHover }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('favorites.openSource', { title: entry.session.title || entry.session.agent_name || t('common.chat') })}>
                  <View style={styles.itemHead}>
                    <Text style={styles.itemSource} numberOfLines={1}>{entry.session.title || t('favorites.untitledSession')}</Text>
                    <Pressable hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => unfavorite(entry)}
                      accessibilityLabel={t('cards.unfavorite')} testID={`favorite-unstar-${message.id}`}>
                      <StarIcon size={iconSize.glyphLg} color={colors.accent} filled />
                    </Pressable>
                  </View>
                  {!!preview.title && <Text style={styles.itemTitle} numberOfLines={1}>{preview.title}</Text>}
                  {!!preview.summary && <Text style={styles.itemSummary} numberOfLines={2}>{preview.summary}</Text>}
                  <View style={styles.itemMeta}>
                    <Text style={styles.itemBadge}>{entry.session.agent_name || t('common.agent')}</Text>
                    {!!preview.badge && <Text style={styles.itemBadge}>{preview.badge}</Text>}
                    {date && Number.isFinite(date.getTime()) && <Text style={styles.itemDate}>{formatDayLabel(date, i18n.language)}</Text>}
                  </View>
                </Pressable>
              );
            })}
            {hasMore && !loading && (
              <Pressable style={styles.more} onPress={() => void load(offset, false)} testID="favorites-modal-more" accessibilityRole="button">
                <Text style={styles.moreText}>{t('favorites.loadMore')}</Text>
              </Pressable>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-start' }, // 상단 시트 (지시: 상단부)
  sheet: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
    maxHeight: '70%',
    paddingBottom: spacing.sp4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingHorizontal: spacing.sp4, paddingTop: spacing.sp4, paddingBottom: spacing.sp2 },
  title: { ...typography.title2, color: colors.text1, flex: 1 },
  closeBtn: { padding: spacing.sp1 },
  closeText: { ...typography.title2, color: colors.text3 },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: spacing.sp3, gap: spacing.sp3, paddingTop: spacing.sp1 },
  stateText: { ...typography.caption, color: colors.text3, paddingVertical: spacing.sp3 },
  errorText: { ...typography.caption, color: colors.statusErr, paddingVertical: spacing.sp3 },
  emptyWrap: { alignItems: 'center', gap: spacing.sp3, paddingVertical: spacing.sp6 },
  emptyText: { ...typography.subhead, color: colors.text3 },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.sp3, gap: spacing.sp1 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2 },
  itemSource: { ...typography.caption, color: colors.text2, flex: 1, minWidth: 0 },
  itemTitle: { ...typography.subhead, color: colors.text1 },
  itemSummary: { ...typography.body, color: colors.text2 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, flexWrap: 'wrap' },
  itemBadge: { ...typography.microSm, color: colors.accent, backgroundColor: colors.surfaceRaise, borderRadius: radii.xs, paddingHorizontal: spacing.sp2, paddingVertical: 2 },
  itemDate: { ...typography.micro, color: colors.text3 },
  more: { padding: spacing.sp3, alignItems: 'center' },
  moreText: { ...typography.caption, color: colors.accent },
});
