// Screen 6: 대화 목록 (Dialogue List) — Phase 2: 백엔드 실연결
// 설계: agenttalk-screen-spec.md 화면 2/6 패턴 — 사각 카드 + 세그먼트 식별색 뱃지
// 동작: 기동 시 GET /api/sessions 실조회 → 세션 카드 렌더. 연결 실패 시에만 목업(데모) 표시.
//   "새 채팅" 버튼: 에이전트 확보(목록→없으면 생성) → POST /api/sessions/ensure → ChatScreen
import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Dialogue, DialogType } from '../types';
import { colors, radii, spacing, typography, segmentMeta } from '../theme';
import { api, getApiConfig, SessionSummary } from '../lib/api';

// 임시 목업 데이터 — 백엔드 연결 실패(데모) 시에만 표시
const MOCK_DIALOGUES: Dialogue[] = [
  {
    id: '1',
    type: 'information',
    title: '오늘 서울 날씨 확인',
    createdAt: new Date('2026-09-25T09:00:00'),
    updatedAt: new Date('2026-09-25T09:30:00'),
    activeNeurons: [],
  },
  {
    id: '2',
    type: 'data',
    title: 'Q3 매출 분석 요청',
    createdAt: new Date('2026-09-25T10:00:00'),
    updatedAt: new Date('2026-09-25T10:15:00'),
    activeNeurons: [],
  },
  {
    id: '3',
    type: 'file',
    title: '계약서 검토',
    createdAt: new Date('2026-09-24T14:00:00'),
    updatedAt: new Date('2026-09-24T14:45:00'),
    activeNeurons: [],
  },
  {
    id: '4',
    type: 'task',
    title: '회식비 정산',
    createdAt: new Date('2026-09-24T11:00:00'),
    updatedAt: new Date('2026-09-24T11:30:00'),
    activeNeurons: [],
  },
];

interface Props {
  navigation: any;
  route?: any;
}

interface SessionRow {
  id: string;
  title: string;
  type: DialogType;
  updatedAt: Date;
  agentId: string;
  agentName: string;
}

const SEGMENT_CYCLE: DialogType[] = ['information', 'data', 'file', 'task', 'multi-agent'];

function sessionToRow(s: SessionSummary, index: number, agentNames: Record<string, string>): SessionRow {
  const agentName = agentNames[s.agent_id] || '에이전트';
  return {
    id: s.id,
    title: `${agentName}와의 대화`,
    // 세션 목록 API에는 유형이 없음 — MVP에서는 인덱스 로테이션 뱃지 (실분류는 백엔드 dialogue_type 연동 시 교체)
    type: SEGMENT_CYCLE[index % SEGMENT_CYCLE.length],
    updatedAt: s.last_activity_at ? new Date(s.last_activity_at) : new Date(),
    agentId: s.agent_id,
    agentName,
  };
}

export default function DialogueListScreen({ navigation, route }: Props) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const demoRequested = Boolean(route?.params?.demo);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!getApiConfig().token) throw new Error('로그인 필요');
      await api.health();
      // 에이전트 이름 맵 (세션 카드 타이틀/채팅 헤더용)
      let agentNames: Record<string, string> = {};
      try {
        const agents = await api.listAgents();
        for (const a of agents?.data ?? []) agentNames[a.id] = a.name;
      } catch {
        /* 이름 조회 실패는 치명적이지 않음 */
      }
      const env = await api.listSessions();
      const rows = (env?.data ?? []).map((s, i) => sessionToRow(s, i, agentNames));
      setSessions(rows);
      setConnected(true);
    } catch (e) {
      setConnected(false);
      setError(demoRequested ? null : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [demoRequested]);

  useEffect(() => {
    // effect 본문의 동기 setState 방지 (react-hooks/set-state-in-effect) — 다음 틱에 스케줄
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  // 새 채팅 시작 — 에이전트 확보 → 세션 ensure → ChatScreen
  const startNewChat = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      if (!getApiConfig().token) throw new Error('로그인이 필요합니다.');
      let agentId: string | null = null;
      let agentName = '에이전트';
      const agents = await api.listAgents();
      agentId = agents?.data?.[0]?.id ?? null;
      agentName = agents?.data?.[0]?.name || agentName;
      if (!agentId) {
        const created = await api.createAgent('나의 그림자 비서', '채팅 MVP 기본 에이전트');
        agentId = created?.data?.id ?? null;
        agentName = created?.data?.name || agentName;
      }
      if (!agentId) throw new Error('에이전트를 확보하지 못했습니다.');
      const env = await api.ensureSession(agentId);
      const sid = env?.data?.id;
      if (!sid) throw new Error('세션을 만들지 못했습니다.');
      setConnected(true);
      navigation.navigate('Chat', { sessionId: sid, agentId, agentName });
      void refresh();
    } catch {
      // 연결 실패 → 데모 채팅으로 진입 (화면 내 데모 폴백이 응답 시뮬레이션)
      navigation.navigate('Chat', { agentName: '데모 에이전트' });
    } finally {
      setStarting(false);
    }
  }, [navigation, refresh]);

  const openSession = useCallback(
    (row: SessionRow) => {
      navigation.navigate('Chat', { sessionId: row.id, agentId: row.agentId, agentName: row.agentName });
    },
    [navigation]
  );

  const renderSession = ({ item }: { item: SessionRow }) => {
    const meta = segmentMeta(item.type as DialogType);
    return (
      <TouchableOpacity
        style={[styles.dialogueCard, { borderLeftColor: meta.color }]}
        onPress={() => openSession(item)}
        accessibilityLabel={`${meta.label} 대화: ${item.title}`}
        testID="session-card"
      >
        <View style={[styles.segIcon, { backgroundColor: withAlpha(meta.color, 0.12) }]}>
          <Text style={[styles.segIconText, { color: meta.color }]}>{meta.icon}</Text>
        </View>
        <View style={styles.dialogueBody}>
          <View style={styles.dialogueHeader}>
            <Text style={[styles.dialogueType, { color: meta.color }]}>{meta.label}</Text>
            <Text style={styles.dialogueTime}>
              {item.updatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          <Text style={styles.dialogueTitle}>{item.title}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const showMock = !connected;
  const listData: (SessionRow | Dialogue)[] = showMock ? MOCK_DIALOGUES : sessions;

  const renderMock = ({ item }: { item: Dialogue }) => {
    const meta = segmentMeta(item.type as DialogType);
    return (
      <TouchableOpacity
        style={[styles.dialogueCard, { borderLeftColor: meta.color, opacity: 0.75 }]}
        onPress={() => navigation.navigate('Chat', { agentName: '데모 에이전트' })}
        accessibilityLabel={`데모 대화: ${item.title}`}
      >
        <View style={[styles.segIcon, { backgroundColor: withAlpha(meta.color, 0.12) }]}>
          <Text style={[styles.segIconText, { color: meta.color }]}>{meta.icon}</Text>
        </View>
        <View style={styles.dialogueBody}>
          <View style={styles.dialogueHeader}>
            <Text style={[styles.dialogueType, { color: meta.color }]}>{meta.label}</Text>
            <Text style={styles.dialogueTime}>
              {item.updatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          <Text style={styles.dialogueTitle}>{item.title}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>에이전트톡</Text>
        <View style={styles.headerRight}>
          {!connected && !loading && (
            <View style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>데모</Text>
            </View>
          )}
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings')}
            style={styles.settingsButton}
            accessibilityLabel="설정"
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {error && (
        <TouchableOpacity style={styles.errorBar} onPress={() => navigation.navigate('Login')} testID="login-hint">
          <Text style={styles.errorText}>{error} — 탭하여 로그인</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.newChatButton, starting && { opacity: 0.6 }]}
        onPress={() => void startNewChat()}
        disabled={starting}
        accessibilityLabel="새 채팅 시작"
        testID="new-chat-button"
      >
        {starting ? (
          <ActivityIndicator size="small" color={colors.onPrimary} />
        ) : (
          <Text style={styles.newChatIcon}>＋</Text>
        )}
        <Text style={styles.newChatText}>{starting ? '세션 준비 중…' : '새 채팅 시작'}</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={listData as any[]}
          renderItem={(showMock ? renderMock : renderSession) as any}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Text style={styles.emptyIcon}>💬</Text>
              </View>
              <Text style={styles.emptyText}>대화가 없습니다</Text>
              <Text style={styles.emptySubtext}>
                {connected ? '새 채팅을 시작해보세요' : '백엔드 미연결 — 데모 데이터 표시 중'}
              </Text>
            </View>
          }
          testID="session-list"
        />
      )}
    </SafeAreaView>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sp3,
    paddingHorizontal: spacing.sp4,
    paddingBottom: spacing.sp3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
  },
  headerTitle: {
    fontSize: typography.title1.fontSize,
    fontWeight: '700',
    color: colors.text1,
  },
  demoBadge: {
    backgroundColor: 'rgba(217,119,6,0.12)',
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp2,
    paddingVertical: 3,
  },
  demoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.statusWarn,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    fontSize: 18,
    color: colors.text2,
  },
  errorBar: {
    marginHorizontal: spacing.sp4,
    marginBottom: spacing.sp2,
    backgroundColor: 'rgba(220,38,38,0.08)',
    borderRadius: radii.md,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
  },
  errorText: {
    fontSize: typography.caption.fontSize,
    color: colors.statusErr,
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sp2,
    marginHorizontal: spacing.sp4,
    marginBottom: spacing.sp3,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.sp3 + 2,
  },
  newChatIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  newChatText: {
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  loadingWrap: {
    paddingTop: 80,
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.sp4,
    paddingBottom: spacing.sp10,
    gap: spacing.sp3,
  },
  dialogueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sp4,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
  },
  segIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sp3,
  },
  segIconText: {
    fontSize: 16,
    fontWeight: '700',
  },
  dialogueBody: {
    flex: 1,
  },
  dialogueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dialogueType: {
    fontSize: 11,
    fontWeight: '700',
  },
  dialogueTime: {
    fontSize: 11,
    color: colors.text3,
  },
  dialogueTitle: {
    fontSize: 15,
    color: colors.text1,
    fontWeight: '500',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sp4,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyText: {
    fontSize: 17,
    color: colors.text2,
    fontWeight: '600',
    marginBottom: spacing.sp2,
  },
  emptySubtext: {
    fontSize: 13,
    color: colors.text3,
  },
});
