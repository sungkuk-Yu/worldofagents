// PC 3패널 레이아웃의 우측 컨텍스트 패널 (t_eded715c 요구 1).
// t_fd869e5b 요구2 (대표님 10/4) — 볼트 노트 섹션 완전 제거(listNotes 호출·context-note-* 렌더 0):
// 서버 내부 저장/사이드카(t_d469fac3)는 그대로 두고 사용자 화면에서만 폐기. 남은 섹션: 즐겨찾기 / 카드 인스펙터.
// 알리바바 미로 금지: 탭 전환 아코디언 없음 — 섹션 동시 상시 표시, 각 섹션 최대 5건 + "전체" 링크.
// 카드 인스펙터 = inspectStore가 가리키는 카드를 이 채팅 messages에서 찾아 비춘다 (채팅 탭 ↔ 패널 동기).
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { api, FavoriteEntry } from '../lib/api';
import { inspectStore } from '../lib/inspectStore';
import type { ChatMessage } from '../lib/chatLogic';
import { StarIcon } from './Icon';
import { colors, iconSize, radii, spacing, typography } from '../theme';

interface Props {
  sessionId: string | null;
  messages: ChatMessage[];
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

export default function ContextPanel({ sessionId, messages, onOpenFavorites }: Props) {
  const { t } = useTranslation();
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [inspectedId, setInspectedId] = useState<string | null>(inspectStore.get());

  useEffect(() => inspectStore.subscribe(() => setInspectedId(inspectStore.get())), []);

  const load = useCallback(() => {
    void api.listFavorites({ limit: SECTION_LIMIT }).then((env) => setFavorites(env.data ?? [])).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load, sessionId]);

  const inspected = inspectedId ? messages.find((m) => m.id === inspectedId) : undefined;
  const inspectedCard = inspected && inspected.payload && typeof inspected.payload === 'object'
    ? (inspected.payload as { kind?: string; title?: string }) : null;

  return (
    <View style={styles.container} testID="context-panel">
      {/* 카드 인스펙터 — 채팅에서 선택(inspectStore)된 카드를 상시 비춤 */}
      {inspected && <View style={styles.section}>
        <SectionHead title={t('context.cards')} />
        <View style={styles.itemCard}>
          <Text style={styles.itemTitle} numberOfLines={2}>{inspectedCard?.title || inspectedCard?.kind || t('context.cardUntitled')}</Text>
          <Text style={styles.itemBody} numberOfLines={4}>{inspected.content || t('context.cardPreviewEmpty')}</Text>
        </View>
      </View>}
      {/* t_fd869e5b 요구2 — 볼트 노트 섹션 폐기(라우트/버튼 제거와 동일 커밋 단위):
          서버 사이드카 저장은 유지, 사용자 화면에서만 제거. i18n context.notes* 키는 미사용 상태로 잔존(무해). */}
      <View style={styles.section}>
        <SectionHead title={t('context.favorites')} onSeeAll={onOpenFavorites} seeAllLabel={t('context.seeAll')} />
        {favorites.length === 0
          ? <View style={styles.emptyRow}><StarIcon size={iconSize.glyph} color={colors.text3} /><Text style={styles.empty}>{t('context.favoritesEmpty')}</Text></View>
          : favorites.map((entry) => (
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
  // t_64af90b0 #10 — 빈 상태 한 줄 요약 (아이콘 + 안내문), 섹션 헤더는 유지
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingVertical: spacing.sp2 },
});
