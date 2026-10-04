// 우측 사이드체인 패널 (t_00fe9b0f 요구3·4 + 중간 지시 포크 모델/닫기 계약, 대표님 10/4).
// "오른쪽 창 = 쓰레드 카드 리스트의 진행 상태 — 답변 중=주황, 완료=초록, 멈춤(허가/선택 필요)=빨강
//  이 정도만" — 리스트는 색점 하나로 압축(단계바는 단독 뷰에서 유지), 상태는 chainLogic 실데이터 판정만.
// 카드 클릭 = 그 사이드체인 단독 뷰(원 질문 고정 + 답글 = ThreadPanel 재사용), 헤더에
//   ← 리스트 복귀 · 이전/다음 체인 이동 · 닫기(confirmed 전용; 주황/빨강은 비활성+사유 툴팁).
// 헤더 '완료된 것 정리' = 초록 카드 일괄 아카이브(확인 모달 없음, undo 안내 3s) — #555 시맨틱(물리 삭제 없음).
// 닫힌 카드는 리스트에서 접히고 원 질문 뱃지 'n closed' 칩으로 재접근(재개방 = reopen).
// 알리바바 미로 금지: 탭 전환 아코디언 없음 — 리스트↔단독 뷰는 같은 창의 스택(슬랙 스레드 패널 관습).
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { buildSideChainCards, canCloseChain, CHAIN_COLORS, closableConfirmedIds, type ArchiveMap, type SideChainCard } from '../lib/chainLogic';
import { chainArchive } from '../lib/chainArchive';
import { buildQuestionTracker } from '../lib/questionTracker';
import { railStore } from '../lib/railStore';
import ThreadPanel from './ThreadPanel';
import { colors, radii, spacing, typography } from '../theme';
import { formatNumber, formatRelative } from '../i18n/format';
import type { ChatMessage, PendingReplyItem, QueueItem, StreamingAnswer } from '../lib/chatLogic';

interface Props {
  messages: ChatMessage[];
  pendingReplies: PendingReplyItem[];
  streams: StreamingAnswer[];
  queue: QueueItem[];
  navigation: any;
}

const StatusDot = ({ status, testID }: { status: SideChainCard['status']; testID: string }) => (
  <View testID={testID} style={[styles.dot, { backgroundColor: CHAIN_COLORS[status], borderColor: CHAIN_COLORS[status] }]} />
);

export default function SideChainPanel({ messages, pendingReplies, streams, queue, navigation }: Props) {
  const { t, i18n } = useTranslation();
  const railState = useSyncExternalStore(railStore.subscribe, railStore.get, railStore.get);
  const archive = useSyncExternalStore(chainArchive.subscribe, chainArchive.get, chainArchive.get);
  // 단독 뷰 = {세션, 루트}를 한 몸으로 저장 — 세션 전환 시 effect 리셋(setState-in-effect) 없이
  // 대조 실패가 곧 닫힘(이전 세션 스레드가 새 세션에 붙을 수 없음, ThreadRail 수명 계약과 동일).
  const [openSel, setOpenSel] = useState<{ sid: string | null; rootId: string } | null>(null);
  const [undoMsg, setUndoMsg] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoSnapshot = useRef<ArchiveMap | null>(null);
  // 세션 전환 = 단독 뷰 자동 종료: openSel에 저장한 세션과 현재 세션이 다르면 열린 적 없는 것과 같다
  // (setState-in-effect 리셋 없이 파생 — ThreadRail의 effect 리셋보다 수명 계약이 강하다).
  const openRootId = openSel && openSel.sid === railState.sessionId ? openSel.rootId : null;
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const cards = useMemo(
    () => buildSideChainCards(railState.threads, buildQuestionTracker(messages, pendingReplies, streams, { queue }).rows, new Set(Object.keys(archive))),
    [railState.threads, messages, pendingReplies, streams, queue, archive],
  );
  // 이동·카운터 스코프 = 열린(미클로즈) 카드만 — 닫힌 체인은 'n closed' 재개방 경로로만 접근한다.
  const active = cards.filter((c) => !c.closed);
  const open = openRootId ? active.find((c) => c.rootId === openRootId) ?? null : null;
  const openIndex = open ? active.findIndex((c) => c.rootId === open!.rootId) : -1;
  const stepTo = (delta: number) => {
    if (openIndex < 0) return;
    const next = active[openIndex + delta];
    if (next) setOpenSel({ sid: railState.sessionId, rootId: next.rootId });
  };
  const flashUndo = (count: number, snapshot: ArchiveMap) => {
    undoSnapshot.current = snapshot;
    setUndoMsg(t('chain.undoToast', { countText: formatNumber(count, i18n.language) }));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoMsg(null), 3000);
  };
  const undo = () => {
    if (undoSnapshot.current) chainArchive.undo(undoSnapshot.current);
    undoSnapshot.current = null;
    setUndoMsg(null);
  };
  const closeAll = () => {
    const ids = closableConfirmedIds(cards);
    if (!ids.length) return;
    const snap = chainArchive.closeMany(ids);
    // 단독 뷰로 열어둔 체인이 일괄 닫기 대상이면 리스트로 복귀(닫힌 체인의 컴포저가 살아있으면 안 됨)
    if (open && ids.includes(open.rootId)) setOpenSel(null);
    flashUndo(ids.length, snap);
  };

  // ── 단독 뷰 (요구4): 계보 헤더(#높이 · 원 질문 발췌 · fork 시각) + ← · ↔ 이동 · 닫기 ──
  if (open && railState.meta) {
    const closeDisabledReason = open.status === 'pending' ? t('chain.closeBusy') : open.status === 'stalled' ? t('chain.closeWaiting') : null;
    return (
      <View style={styles.container} testID="sidechain-detail">
        <View style={styles.detailHeader}>
          <Pressable accessibilityRole="button" onPress={() => setOpenSel(null)} testID="sidechain-back" hitSlop={8} style={styles.iconBtn}>
            <Text style={styles.iconText}>←</Text>
          </Pressable>
          <View style={styles.detailHeadBody}>
            {/* 계보 헤더 = #높이(원 질문 블록 번호) + 발췌 + 상태색 (fork 시점 시각은 사이드체인 생성 시각: 마지막 답글 활동) */}
            <View style={styles.detailTitleRow}>
              <StatusDot status={open.status} testID="detail-status-dot" />
              {/* 높이(순번) 없음 = 루트가 실질 질문 행 밖(예: 에이전트 카드 스레드) — #0 대신 생략 (ThreadRail과 동일 가드) */}
              {open.seq > 0 && <Text style={styles.detailHeight} testID="detail-chain-height">{t('chain.height', { height: open.seq })}</Text>}
            </View>
            <Text numberOfLines={2} style={styles.detailExcerpt}>{open.excerpt || t('queue.photoQuestion')}</Text>
            <Text style={styles.detailMeta} testID="detail-chain-forked-at">
              {open.lastActivity ? t('chain.forkedAt', { when: formatRelative(new Date(open.lastActivity), i18n.language) }) : '—'}
              {' · '}{t('queue.replyCount', { countText: formatNumber(open.replyCount, i18n.language) })}
            </Text>
          </View>
          <View style={styles.detailNav}>
            <Pressable accessibilityRole="button" onPress={() => stepTo(-1)} disabled={openIndex <= 0} testID="sidechain-prev" style={[styles.iconBtn, openIndex <= 0 && styles.iconBtnOff]}>
              <Text style={styles.iconText}>◀</Text>
            </Pressable>
            <Text style={styles.detailCounter}>{formatNumber(openIndex + 1, i18n.language)}/{formatNumber(active.length, i18n.language)}</Text>
            <Pressable accessibilityRole="button" onPress={() => stepTo(1)} disabled={openIndex < 0 || openIndex >= active.length - 1} testID="sidechain-next" style={[styles.iconBtn, openIndex >= active.length - 1 && styles.iconBtnOff]}>
              <Text style={styles.iconText}>▶</Text>
            </Pressable>
          </View>
          {/* 닫기 = confirmed(초록) 전용. 진행 중 체인을 닫아 소멸시키는 일 없음(대표님 10/4 계약 1). */}
          <Pressable
            accessibilityRole="button"
            testID="sidechain-close"
            disabled={!canCloseChain(open)}
            onPress={() => { chainArchive.close(open.rootId); setOpenSel(null); }}
            style={[styles.closeBtn, !canCloseChain(open) && styles.closeBtnOff]}
            accessibilityLabel={closeDisabledReason ?? t('chain.close')}
          >
            <Text style={[styles.closeText, !canCloseChain(open) && { color: colors.text3 }]}>{t('chain.close')}</Text>
          </Pressable>
        </View>
        {!canCloseChain(open) && closeDisabledReason && <Text style={styles.closeHint} testID="sidechain-close-hint">{closeDisabledReason}</Text>}
        {/* 체인 본문 = ThreadPanel(원본 고정 + 답글 행 + 컴포저) — 사이드체는 메인 본문을 복제하지 않는다.
            onBack=← 와 동일(리스트 복귀). ThreadRail과 같은 재사용 계약(Panel은 소유권 없음). */}
        <View style={styles.detailBody}>
          <ThreadPanel
            navigation={navigation}
            target={{ sessionId: railState.sessionId ?? undefined, rootMessageId: open.rootId, ...railState.meta }}
            onBack={() => setOpenSel(null)}
          />
        </View>
      </View>
    );
  }

  // ── 카드 리스트 (요구3): 색 3종만, 단계바 없음('이 정도만') ──
  const closedCount = Object.keys(archive).length;
  return (
    <View style={styles.container} testID="sidechain-panel">
      <View style={styles.header}>
        <Text style={styles.title}>{t('chain.sideChains')}</Text>
        {closableConfirmedIds(cards).length > 0 && (
          <Pressable accessibilityRole="button" onPress={closeAll} testID="sidechain-close-all" hitSlop={6}>
            <Text style={styles.seeAll}>{t('chain.closeAll')}</Text>
          </Pressable>
        )}
      </View>
      {/* undo 3s ('완료된 것 정리' 실행 후) — 탭하면 직전 스냅샷으로 복원 (실행 후 undo 안내 계약) */}
      {undoMsg && (
        <Pressable onPress={undo} accessibilityRole="button" testID="sidechain-undo"><Text style={styles.undo}>{undoMsg}</Text></Pressable>
      )}
      {active.length === 0 && (
        <Text style={styles.empty} testID="sidechain-empty">{closedCount ? t('chain.allClosed') : t('queue.threadsEmpty')}</Text>
      )}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {active.map((c) => (
          <Pressable key={c.rootId} onPress={() => setOpenSel({ sid: railState.sessionId, rootId: c.rootId })} testID={`sidechain-card-${c.rootId}`}
            accessibilityRole="button" accessibilityLabel={c.excerpt}
            style={({ pressed }) => [styles.card, { borderColor: CHAIN_COLORS[c.status] }, pressed && { backgroundColor: colors.surfaceHover }]}>
            <StatusDot status={c.status} testID={`sidechain-dot-${c.rootId}`} />
            <View style={styles.cardBody}>
              <Text numberOfLines={1} style={styles.cardText}>{c.excerpt || t('queue.photoQuestion')}</Text>
              <Text style={styles.cardMeta}>
                {c.seq > 0 ? `${t('chain.height', { height: c.seq })} · ` : ''}{t('queue.replyCount', { countText: formatNumber(c.replyCount, i18n.language) })}
                {c.lastActivity ? ` · ${formatRelative(new Date(c.lastActivity), i18n.language)}` : ''}
              </Text>
            </View>
          </Pressable>
        ))}
        {closedCount > 0 && (() => {
          const closedCards = cards.filter((c) => c.closed);
          return (
            <View style={styles.closedGroup}>
              {/* n closed 카운터 — 재개방하면 상태 회복(빨강/주황 복귀 가능)이므로 영구 아카이브 아님 */}
              <Text style={styles.closedText} testID="sidechain-closed-count">{t('chain.closedCount', { countText: formatNumber(closedCount, i18n.language) })}</Text>
              {closedCards.map((c) => (
                <Pressable key={c.rootId} onPress={() => { chainArchive.reopen(c.rootId); setOpenSel({ sid: railState.sessionId, rootId: c.rootId }); }}
                  testID={`sidechain-reopen-${c.rootId}`} accessibilityRole="button"
                  style={({ pressed }) => [styles.closedRow, pressed && { backgroundColor: colors.surfaceHover }]}>
                  <Text numberOfLines={1} style={styles.closedItemText}>{c.excerpt || t('queue.photoQuestion')}</Text>
                  <Text style={styles.reopenText}>{t('chain.reopen')}</Text>
                </Pressable>
              ))}
            </View>
          );
        })()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: 340, flexShrink: 0, backgroundColor: colors.surface, borderLeftWidth: 1, borderLeftColor: colors.border, paddingHorizontal: spacing.sp4, paddingTop: spacing.sp5, gap: spacing.sp3 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sp2 },
  title: { ...typography.subhead, fontWeight: '700', color: colors.text1, letterSpacing: 0 },
  seeAll: { ...typography.caption, fontWeight: '600', color: colors.accent },
  undo: { ...typography.caption, color: colors.accent },
  empty: { ...typography.caption, color: colors.text3, paddingTop: spacing.sp2 },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.sp3, gap: spacing.sp2 },
  // 카드는 색점+테두리 3종만 — 대표님 '이 정도만' (배지·단계바·추가 색 소스 금지)
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sp2, borderWidth: 1, borderRadius: radii.md, padding: spacing.sp3 },
  dot: { width: 10, height: 10, borderRadius: radii.full, marginTop: 4, borderWidth: 1 },
  cardBody: { flex: 1, minWidth: 0 },
  cardText: { ...typography.body, color: colors.text1 },
  cardMeta: { ...typography.micro, color: colors.text3 },
  closedGroup: { gap: 2, paddingTop: spacing.sp1 },
  closedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sp2, paddingHorizontal: spacing.sp2, paddingVertical: spacing.sp1, borderRadius: radii.sm },
  closedText: { ...typography.caption, color: colors.text3 },
  closedItemText: { ...typography.caption, color: colors.text3, flex: 1, minWidth: 0 },
  reopenText: { ...typography.micro, color: colors.accent },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sp2 },
  detailHeadBody: { flex: 1, minWidth: 0, gap: 2 },
  detailTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp1 },
  detailHeight: { ...typography.caption, fontWeight: '700', color: colors.text1, fontVariant: ['tabular-nums'] },
  detailExcerpt: { ...typography.bodyBold, color: colors.text1 },
  detailMeta: { ...typography.micro, color: colors.text3 },
  detailNav: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  detailCounter: { ...typography.micro, color: colors.text3, fontVariant: ['tabular-nums'] },
  iconBtn: { paddingHorizontal: spacing.sp1, paddingVertical: 2 },
  iconBtnOff: { opacity: 0.3 },
  iconText: { ...typography.subhead, color: colors.text2 },
  closeBtn: { paddingHorizontal: spacing.sp2, paddingVertical: 3, borderRadius: radii.sm, backgroundColor: colors.accentTint, alignSelf: 'flex-start' },
  closeBtnOff: { backgroundColor: colors.surfaceRaise },
  closeText: { ...typography.caption, fontWeight: '700', color: colors.accent },
  closeHint: { ...typography.micro, color: colors.text3 },
  detailBody: { flex: 1, minHeight: 0 },
});
