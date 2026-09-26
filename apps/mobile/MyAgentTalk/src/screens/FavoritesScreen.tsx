// 즐겨찾기 컬렉션 뵤 — Wave1 코멘트(김비서 9/26): GET /api/favorites 세로 피드
// 항목 = 카드 스냅샷(#51 미리보기 규칙 재사용) + 원본 대화 제목 + 에이전트 이름 + 날짜.
// 탭 → 원본 세션을 열고 해당 메시지로 딥링크(focusMessageId 스크롤+하이라이트).
// ⭐ 재탭 = 해제 — 애플 모션(#52): LayoutAnimation 스프링으로 행 제거. Wave 2 피드의 기본 골격.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api, FavoriteEntry } from '../lib/api';
import { errorKey } from '../lib/errorKeys';
import { normalizeServerMessages } from '../lib/chatLogic';
import { buildCardPreview } from '../cards/preview';
import { isCardRegistered } from '../cards/registry';
import { formatDayLabel } from '../i18n/format';
import { colors, radii, spacing, typography, iconSize, webScreenMotion } from '../theme';

if (Platform.OS !== 'web' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const PAGE = 50;

export default function FavoritesScreen({ navigation }: { navigation: any }) {
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

  // 타이머 래퍼 — 리프레시/구독을 effect 동기 실행에서 분리 (DialogueList refresh 패턴, set-state-in-effect 회피)
  useEffect(() => { const timer = setTimeout(() => { void load(0, true); }, 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => navigation.addListener('focus', () => { void load(0, true); }), [navigation, load]);

  const unfavorite = (entry: FavoriteEntry) => {
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEntries((prev) => prev.filter((e) => e.message.id !== entry.message.id));
    api.setFavorite(entry.message.id, false).catch(() => {
      // 롤백 — 서버가 거부하면 행을 되돌린다
      setEntries((prev) => (prev.some((e) => e.message.id === entry.message.id) ? prev : [...prev, entry].sort((a, b) => (a.message.created_at ?? '').localeCompare(b.message.created_at ?? '')).reverse()));
      setError('errors.favorite');
    });
  };

  const openSource = (entry: FavoriteEntry) => {
    navigation.navigate('Chat', {
      sessionId: entry.session.id,
      sessionTitle: entry.session.title ?? undefined,
      agentName: entry.session.agent_name ?? t('common.agent'),
      focusMessageId: entry.message.id,
    });
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  return (
    <View style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')} style={styles.headerButton} testID="favorites-back">
          <Text style={styles.headerIcon}>{t('common.backIcon')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('favorites.title')}</Text>
        <View style={styles.headerButton} />
      </View>
      {error && <TouchableOpacity style={styles.errorBar} onPress={() => { setLoading(true); void load(0, true); }} testID="favorites-retry">
        <Text style={styles.errorText}>{t(error)}</Text>
      </TouchableOpacity>}
      {entries.length === 0 && !error && (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>{t('cards.starIcon')}</Text>
          <Text style={styles.emptyText}>{t('favorites.empty')}</Text>
        </View>
      )}
      <View style={styles.list}>
        {entries.map((entry) => {
          const message = normalizeServerMessages([entry.message])[0];
          if (!message) return null;
          const known = isCardRegistered(message.dialogueType);
          const preview = buildCardPreview(message.dialogueType, message.payload, message.content, known);
          const date = message.createdAt ? new Date(message.createdAt) : null;
          return (
            <TouchableOpacity key={message.id} style={styles.item} onPress={() => openSource(entry)} testID={`favorite-${message.id}`}
              accessibilityLabel={t('favorites.openSource', { title: entry.session.title || entry.session.agent_name || t('common.chat') })}>
              <View style={styles.itemHead}>
                <Text style={styles.itemSource} numberOfLines={1}>{entry.session.title || t('favorites.untitledSession')}</Text>
                <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => unfavorite(entry)}
                  accessibilityLabel={t('cards.unfavorite')} testID={`favorite-unstar-${message.id}`}>
                  <Text style={styles.starActive}>{t('cards.starredIcon')}</Text>
                </TouchableOpacity>
              </View>
              {!!preview.title && <Text style={styles.itemTitle} numberOfLines={1}>{preview.title}</Text>}
              {!!preview.summary && <Text style={styles.itemSummary} numberOfLines={2}>{preview.summary}</Text>}
              <View style={styles.itemMeta}>
                <Text style={styles.itemBadge}>{entry.session.agent_name || t('common.agent')}</Text>
                {!!preview.badge && <Text style={styles.itemBadge}>{preview.badge}</Text>}
                {date && Number.isFinite(date.getTime()) && <Text style={styles.itemDate}>{formatDayLabel(date, i18n.language)}</Text>}
              </View>
            </TouchableOpacity>
          );
        })}
        {hasMore && (
          <TouchableOpacity style={styles.more} onPress={() => void load(offset, false)} testID="favorites-more">
            <Text style={styles.moreText}>{t('favorites.loadMore')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sp3, padding: spacing.sp6 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sp2, paddingVertical: spacing.sp2, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerButton: { padding: spacing.sp2, minWidth: iconSize.hero },
  headerIcon: { ...typography.headline, color: colors.text1 },
  headerTitle: { ...typography.title2, color: colors.text1, flex: 1, textAlign: 'center' },
  errorBar: { padding: spacing.sp3 },
  errorText: { ...typography.caption, color: colors.statusErr },
  emptyIcon: { ...typography.display, color: colors.borderStrong },
  emptyText: { ...typography.subhead, color: colors.text3 },
  list: { padding: spacing.sp3, gap: spacing.sp3 },
  item: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sp3, gap: spacing.sp1 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2 },
  itemSource: { ...typography.caption, color: colors.text2, flex: 1, minWidth: 0 },
  starActive: { fontSize: iconSize.glyphLg, color: colors.accent },
  itemTitle: { ...typography.subhead, color: colors.text1 },
  itemSummary: { ...typography.body, color: colors.text2 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, flexWrap: 'wrap' },
  itemBadge: { ...typography.microSm, color: colors.accent, backgroundColor: colors.surfaceRaise, borderRadius: radii.xs, paddingHorizontal: spacing.sp2, paddingVertical: 2 },
  itemDate: { ...typography.micro, color: colors.text3 },
  more: { padding: spacing.sp3, alignItems: 'center' },
  moreText: { ...typography.caption, color: colors.accent },
});
