// 채팅 앱바 (t_70cbbd6b: ChatScreen JSX 순수 추출 — 렌더/DOM/testID 1:1)
// 커스텀 헤더 — 웹 export에서 Paper Appbar 아이콘 글리프 깨짐 방지 (다른 화면과 동일한 ← 텍스트 패턴)
// 선택 모드(대표님 9/26): 좌측 ✕ / 제목 = "N개 선택" / 우측 전체선택·전체해제
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n/format';
import DevicePresenceBadge from '../DevicePresenceBadge';
import { PendingReplyIcon, TrackerIcon } from '../Icon';
import { colors, iconSize } from '../../theme';
import { styles } from '../../screens/chatScreenStyles';
import type { ChatSelection } from '../../hooks/useChatSelection';
import { QUEUE_VIS } from '../../lib/featureFlags';

interface Props {
  selection: ChatSelection;
  sessionTitle: string;
  isDemo: boolean;
  peers: string[];
  connection: 'live' | 'connecting' | 'reconnecting' | 'offline';
  activeThreadCount: number;
  /** 답변 대기 건수 (t_363c0faa) — 답글 버튼 관례: 0이면 배지 없음(버튼은 유지), >0 amber 배지 */
  pendingReplyCount: number;
  /** 내 질문 트래커 '현황' 버튼 노출 (t_fd869e5b) — wide 웹은 우측 패널이 담당하므로 숨김 */
  showTrackerButton?: boolean;
  /** 진행 중 질문 전역 큐 입구 배지 (t_140ecc15 ②) — QueueView 파생 스냅샷 그대로.
   *  pending(답변 중+대기)>0 = 주황 숫자, stopped≥1 = 빨강, backlog 0 = 숫자 숨김(버튼 유지).
   *  PC wide에서도 렌더 — 탭 = 우측 패널 백로그 섹션 스크롤 앵커. */
  queueBadge?: { pendingCount: number; stoppedCount: number; backlogCount: number };
  /** PC wide = '진행 중 질문' 텍스트 라벨(대표님 문구 그대로 노출), 좁은 화면/네이티브 = 아이콘 (t_140ecc15 ②) */
  showQueueLabel?: boolean;
  onBack: () => void;
  onOpenThreads: () => void;
  onOpenPending: () => void;
  onOpenTracker?: () => void;
  onOpenQueue?: () => void;
  onBeginSelection: () => void;
  /** 제목 수정 진입 (t_8917ca0d ③ — 헤더 탭). 데모/세션 없음 화면에서는 미전달 = 비활성. */
  onRequestRename?: () => void;
}

export default function ChatAppBar({ selection, sessionTitle, isDemo, peers, connection, activeThreadCount, pendingReplyCount, showTrackerButton = false, queueBadge, showQueueLabel = false, onBack, onOpenThreads, onOpenPending, onOpenTracker, onOpenQueue, onBeginSelection, onRequestRename }: Props) {
  const { t, i18n } = useTranslation();
  // 앱바 서브타이틀 — 에이전트를 "살아있는 존재"로: 처리 중이면 자연어 상태를 그대로 노출
  const connectionColor = connection === 'live' ? colors.accent : connection === 'offline' ? colors.statusErr : colors.statusWarn;
  const subtitle = isDemo ? t('chat.demoSubtitle') : {
    connecting: t('chat.connecting'), live: t('chat.live'), reconnecting: t('chat.reconnecting'), offline: t('chat.offline'),
  }[connection];
  return (
    <View style={styles.appbar} testID="chat-appbar">
      <TouchableOpacity onPress={selection.active ? selection.exit : onBack} style={styles.backButton} accessibilityLabel={t(selection.active ? 'common.cancel' : 'common.back')}>
        <Text style={styles.backText}>{selection.active ? '✕' : t('common.backIcon')}</Text>
      </TouchableOpacity>
      {/* 답변 대기 (t_363c0faa) — 앱바 좌측 유지 버튼(대표님 9/28 지시): 발췌+예/아니오 빠른 회신 모달로.
          답글 버튼과 동일 관례 — 배지 = 미해소 건수, 0이면 숫자 없이 아이콘만. */}
      {!selection.active && (
        <TouchableOpacity onPress={onOpenPending} style={styles.backButton} accessibilityLabel={t('pending.button')} testID="pending-open">
          <View style={styles.pendingButtonFace}>
            <PendingReplyIcon size={iconSize.tileSm} color={pendingReplyCount > 0 ? colors.statusWarn : colors.text2} />
            {pendingReplyCount > 0 && <Text style={styles.pendingBadge} testID="pending-count">{formatNumber(pendingReplyCount, i18n.language)}</Text>}
          </View>
        </TouchableOpacity>
      )}
      {/* 내 질문 트래커 '현황' (t_fd869e5b) — 390px/네이티브: 우측 패널 미렌더 대체 진입점 (하단 시트 오픈).
          wide 웹은 상시 패널이 담당 → 버튼 렌더 제외. 답글 버튼 관례: 아이콘+활성 건수 배지(0이면 아이콘만). */}
      {!selection.active && showTrackerButton && (
        <TouchableOpacity onPress={onOpenTracker} style={styles.backButton} accessibilityLabel={t('tracker.button')} testID="tracker-open">
          <TrackerIcon size={iconSize.tileSm} color={colors.text2} />
        </TouchableOpacity>
      )}
      <View style={styles.headerBody}>
        {/* 제목 탭 = 대화 제목 수정 (t_8917ca0d ③). 데모/미전달 시 순수 텍스트로 무해. */}
        <TouchableOpacity testID="rename-session-open" disabled={!onRequestRename} onPress={onRequestRename} accessibilityLabel={t('rename.title')}>
          <Text style={styles.appbarTitle} numberOfLines={1} testID="chat-appbar-title">{selection.active ? t('selection.count', { countText: formatNumber(selection.ids.length, i18n.language) }) : sessionTitle}</Text>
        </TouchableOpacity>
        {!selection.active && <View style={styles.subtitleRow}>
          <Text
            style={[styles.appbarSubtitle, { color: isDemo ? colors.statusWarn : connectionColor }]}
            numberOfLines={1}
            testID="chat-status-line"
          >
            {t('chat.statusIndicator', { status: subtitle })}
          </Text>
          {/* 크로스 디바이스 presence — 같은 세션을 다른 기기가 실시간으로 보는 중 (t_eded715c) */}
          {!isDemo && <DevicePresenceBadge peers={peers} />}
        </View>}
      </View>
      {/* 진행 중 질문 전역 큐 입구 (t_140ecc15 ②, 대표님 10/4) — 우측 상단 버튼 + pending 수 배지.
          주황 = 답변 중+대기 수, 멈춤 ≥1 = 빨강, 0건 = 숫자 없이 버튼만(답글 관례).
          PC wide = '진행 중 질문' 텍스트 라벨(우측 패널 스크롤 앵커), 좁은 화면 = 아이콘(시트 오픈). */}
      {!selection.active && QUEUE_VIS && onOpenQueue && (
        <TouchableOpacity onPress={onOpenQueue} style={styles.backButton} testID="queue-open"
          accessibilityLabel={t('queueView.buttonAria', { countText: formatNumber(queueBadge?.pendingCount ?? 0, i18n.language), stopText: formatNumber(queueBadge?.stoppedCount ?? 0, i18n.language) })}>
          <View style={styles.queueButtonFace}>
            {showQueueLabel
              ? <Text style={[styles.queueLabel, (queueBadge?.stoppedCount ?? 0) > 0 ? styles.queueLabelStop : (queueBadge?.pendingCount ?? 0) > 0 ? styles.queueLabelWarn : styles.queueLabel]} numberOfLines={1}>{t('queueView.button')}</Text>
              : <TrackerIcon size={iconSize.tileSm} color={(queueBadge?.stoppedCount ?? 0) > 0 ? colors.statusErr : (queueBadge?.pendingCount ?? 0) > 0 ? colors.statusWarn : colors.text2} />}
            {(queueBadge?.backlogCount ?? 0) > 0 && (
              <View style={styles.queueBadges}>
                {(queueBadge!.pendingCount) > 0 && (
                  <Text style={[styles.queueBadge, styles.queueBadgeWarn]} testID="queue-badge-warn">
                    {formatNumber(queueBadge!.pendingCount, i18n.language)}
                  </Text>
                )}
                {(queueBadge!.stoppedCount) > 0 && (
                  <Text style={[styles.queueBadge, styles.queueBadgeStop]} testID="queue-badge-stop">
                    {formatNumber(queueBadge!.stoppedCount, i18n.language)}
                  </Text>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>
      )}
      {/* 답글 스레드 목록 (t_2f45ccb1 확장 3) — 앱바 우측 버튼, 배지 = 활성 스레드 수, 0이면 배지 없음 */}
      {!selection.active && (
        <TouchableOpacity onPress={onOpenThreads} style={styles.backButton} accessibilityLabel={t('queue.threadsTitle')} testID="threads-open">
          <Text style={styles.backText}>{t('common.thread')}{activeThreadCount > 0 ? ` ${formatNumber(activeThreadCount, i18n.language)}` : ''}</Text>
        </TouchableOpacity>
      )}
      {selection.active ? <TouchableOpacity
        onPress={() => (selection.allSelected ? selection.clear() : selection.selectAll())}
        style={styles.backButton}
        accessibilityLabel={t(selection.allSelected ? 'selection.clearAll' : 'selection.selectAll')}
        testID="selection-toggle-all"
      >
        <Text style={styles.backText}>{t(selection.allSelected ? 'selection.clearAll' : 'selection.selectAll')}</Text>
      </TouchableOpacity> : <TouchableOpacity
        onPress={onBeginSelection}
        style={styles.backButton}
        accessibilityLabel={t('selection.enter')}
        testID="selection-enter"
      >
        <Text style={styles.backText}>{t('selection.enter')}</Text>
      </TouchableOpacity>}
    </View>
  );
}
