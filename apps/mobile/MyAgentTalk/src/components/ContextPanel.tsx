// PC 3패널 레이아웃의 우측 컨텍스트 패널 (t_eded715c 요구 1).
// 볼트 노트 / 즐겨찾기 / 카드 인스펙터 세 그룹을 한 화면에 위→아래로 모두 노출한다.
// 알리바바 미로 금지: 탭 전환 아코디언 없음 — 세 섹션 동시 상시 표시, 각 섹션 최대 5건 + "전체" 링크로 해당 화면 이동.
// 카드 인스펙터 = inspectStore가 가리키는 카드를 이 채팅 messages에서 찾아 비춘다 (채팅 탭 ↔ 패널 동기).
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { api, FavoriteEntry, VaultNote } from '../lib/api';
import { inspectStore } from '../lib/inspectStore';
import type { ChatMessage } from '../lib/chatLogic';
import { colors, radii, spacing, typography } from '../theme';

interface Props {
  sessionId: string | null;
  messages: ChatMessage[];
  /** 섹션 헤더 '전체' 링크 — Vault/Favorites 화면 push (네이티브는 이 패널을 쓰지 않지만 prop은 유지) */
  onOpenVault: () => void;
  onOpenFavorites: () => void;
}

const SECTION_LIMIT = 5;

function SectionHead({ title, onSeeAll, seeAllLabel }: { title: string; onSeeAll?: () => void; seeAllLabel?: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onSeeAll && seeAllLabel && (
        <Pressable accessibilityRole="button" onPress={onSeeAll} hitSlop={8}>
          <Text style={styles.seeAll}>{seeAllLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function ContextPanel({ sessionId, messages, onOpenVault, onOpenFavorites }: Props) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [inspectedId, setInspectedId] = useState<string | null>(inspectStore.get());

  useEffect(() => inspectStore.subscribe(() => setInspectedId(inspectStore.get())), []);

  const load = useCallback(() => {
    void api.listNotes({ limit: SECTION_LIMIT }).then((env) => setNotes(env.data ?? [])).catch(() => undefined);
    void api.listFavorites({ limit: SECTION_LIMIT }).then((env) => setFavorites(env.data ?? [])).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load, sessionId]);

  const inspected = inspectedId ? messages.find((m) => m.id === inspectedId) : undefined;
  const inspectedCard = inspected && inspected.payload && typeof inspected.payload === 'object'
    ? (inspected.payload as { kind?: string; title?: string }) : null;

  return (
    <View style={styles.container} testID="context-panel">
      {/* 카드 인스펙터 — 채팅에서 선택(inspectStore)된 카드를 상시 비춤 */}
      <View style={styles.section}>
        <SectionHead title={t('context.cards')} />
        {inspected ? (
          <View style={styles.itemCard}>
            <Text style={styles.itemTitle} numberOfLines={2}>{inspectedCard?.title || inspectedCard?.kind || t('context.cardUntitled')}</Text>
            <Text style={styles.itemBody} numberOfLines={4}>{inspected.content || t('context.cardPreviewEmpty')}</Text>
          </View>
        ) : (
          <Text style={styles.empty}>{t('context.cardEmpty')}</Text>
        )}
      </View>
      <View style={styles.section}>
        <SectionHead title={t('context.notes')} onSeeAll={onOpenVault} seeAllLabel={t('context.seeAll')} />
        {notes.length === 0 && <Text style={styles.empty}>{t('context.notesEmpty')}</Text>}
        {notes.map((note) => (
          <Pressable key={note.id} accessibilityRole="button" onPress={onOpenVault} style={styles.itemCard} testID={`context-note-${note.id}`}>
            <Text style={styles.itemTitle} numberOfLines={1}>{note.title}</Text>
            <Text style={styles.itemBody} numberOfLines={2}>{note.content}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.section}>
        <SectionHead title={t('context.favorites')} onSeeAll={onOpenFavorites} seeAllLabel={t('context.seeAll')} />
        {favorites.length === 0 && <Text style={styles.empty}>{t('context.favoritesEmpty')}</Text>}
        {favorites.map((entry) => (
          <View key={entry.message.id} style={styles.itemCard}>
            <Text style={styles.itemTitle} numberOfLines={1}>{entry.session.title || entry.session.agent_name || t('common.agent')}</Text>
            <Text style={styles.itemBody} numberOfLines={2}>{entry.message.content}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 340, // layout.ts CONTEXT_WIDTH — 고정 폭, 리사이즈 핸들 없음(미로 금지)
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp5,
    gap: spacing.sp6,
  },
  section: { gap: spacing.sp2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...typography.subhead, fontWeight: '700', color: colors.text1, letterSpacing: 0 },
  seeAll: { ...typography.caption, fontWeight: '600', color: colors.accent },
  itemCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sp3,
    gap: spacing.sp1,
    backgroundColor: colors.surface,
  },
  itemTitle: { ...typography.bodyBold, color: colors.text1 },
  itemBody: { ...typography.caption, color: colors.text2 },
  empty: { ...typography.caption, color: colors.text3 },
});
