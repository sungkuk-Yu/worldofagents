// PC 3패널 레이아웃의 우측 컨텍스트 패널 (t_eded715c 요구 1; t_fd869e5b 레이아웃 확정 10/4).
// 대표님 10/4 최종 지시: "오른쪽엔 볼트 노트가 아니라, 내가 한 질문들이 어떻게 돌아가는지 질문의 큐를
// 쓰레드 형식으로 보여주고, 큐가 어떻게 진행되는지 눈으로" — 볼트 노트 섹션(listNotes 호출 포함) 완전 제거,
// 그 자리에 내 질문 트래커(4단계 스텝바) 상시 노출. 즐겨찾기/카드 인스펙터 섹션은 유지.
// 알리바바 미로 금지: 탭 전환 아코디언 없음 — 섹션 동시 상시 표시, 즐겨찾기 최대 5건 + "전체" 링크.
// 카드 인스펙터 = inspectStore가 가리키는 카드를 이 채팅 messages에서 찾아 비춘다 (채팅 탭 ↔ 패널 동기).
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { api, FavoriteEntry } from '../lib/api';
import { inspectStore } from '../lib/inspectStore';
import type { ChatMessage, PendingReplyItem, QueueItem, StreamingAnswer } from '../lib/chatLogic';
import type { QueueView } from '../lib/queueVisibility';
import { StarIcon } from './Icon';
import { QuestionTrackerSection } from './QuestionTracker';
import { QueueBacklogSection } from './QueueBacklog';
import { QUEUE_VIS } from '../lib/featureFlags';
import { colors, iconSize, radii, spacing, typography } from '../theme';

interface Props {
  sessionId: string | null;
  messages: ChatMessage[];
  /** 섹션 헤더 '전체' 링크 — Favorites 화면 push (네이티브는 이 패널을 쓰지 않지만 prop은 유지) */
  onOpenFavorites: () => void;
  // ── 내 질문 트래커 데이터 (t_fd869e5b) — 화면(useChatSession)의 단일 원천 props, 파생은 lib/questionTracker
  pendingReplies: PendingReplyItem[];
  streams: StreamingAnswer[];
  queue: QueueItem[];
  /** 진행 중 질문 전역 큐 뷰 (t_140ecc15 ②) — 앱바 '진행 중 질문' 버튼의 스크롤 앵커 섹션 */
  queueView: QueueView;
  onJump: (messageId: string) => void;
  onOpenThread: (rootMessageId: string) => void;
  onRetry: (messageId: string) => void;
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

export default function ContextPanel({ sessionId, messages, onOpenFavorites, pendingReplies, streams, queue, queueView, onJump, onOpenThread, onRetry }: Props) {
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
      {/* 진행 중 질문 백로그 (t_140ecc15 ②) — 앱바 '진행 중 질문' 버튼의 스크롤 앵커 섹션.
          밀린 질문 0건이면 카운트 줄 + '모두 해소' 빈 행 1줄만(운영 확인용, 리스트 폭발 없음). */}
      {QUEUE_VIS && <View style={styles.section}>
        <QueueBacklogSection view={queueView} onJump={onJump} onRetry={onRetry} />
      </View>}
      {/* 내 질문 트래커 (t_fd869e5b) — 볼트 노트 섹션 제거 후 그 자리. 목록 폭발 방지(로직단) */}
      <View style={styles.section}>
        <QuestionTrackerSection messages={messages} pendingReplies={pendingReplies} streams={streams} queue={queue} onJump={onJump} onOpenThread={onOpenThread} onRetry={onRetry} />
      </View>
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
