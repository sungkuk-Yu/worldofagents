// 채팅 앱바 (t_70cbbd6b: ChatScreen JSX 순수 추출 — 렌더/DOM/testID 1:1)
// 커스텀 헤더 — 웹 export에서 Paper Appbar 아이콘 글리프 깨짐 방지 (다른 화면과 동일한 ← 텍스트 패턴)
// 선택 모드(대표님 9/26): 좌측 ✕ / 제목 = "N개 선택" / 우측 전체선택·전체해제
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n/format';
import DevicePresenceBadge from '../DevicePresenceBadge';
import { colors } from '../../theme';
import { styles } from '../../screens/chatScreenStyles';
import type { ChatSelection } from '../../hooks/useChatSelection';

interface Props {
  selection: ChatSelection;
  sessionTitle: string;
  isDemo: boolean;
  peers: string[];
  connection: 'live' | 'connecting' | 'reconnecting' | 'offline';
  activeThreadCount: number;
  onBack: () => void;
  onOpenThreads: () => void;
  onBeginSelection: () => void;
}

export default function ChatAppBar({ selection, sessionTitle, isDemo, peers, connection, activeThreadCount, onBack, onOpenThreads, onBeginSelection }: Props) {
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
      <View style={styles.headerBody}>
        <Text style={styles.appbarTitle} numberOfLines={1}>{selection.active ? t('selection.count', { countText: formatNumber(selection.ids.length, i18n.language) }) : sessionTitle}</Text>
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
