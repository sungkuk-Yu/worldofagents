// 대화 목록과 에이전트 선택은 서버의 실제 데이터를 카드로 표시한다.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, SafeAreaView, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { api, getApiConfig, SessionSummary, AgentSummary } from '../lib/api';
import { errorKey } from '../lib/errorKeys';
import { parseForkOrigin } from '../lib/cardLogic';
import { formatDayLabel } from '../i18n/format';

interface Props { navigation: any; route?: any }
export default function DialogueListScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [starting, setStarting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agentTitle = (agent?: AgentSummary) => agent?.preset?.titleKey && i18n.exists(agent.preset.titleKey)
    ? t(agent.preset.titleKey) : agent?.name || t('common.agent');
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (!getApiConfig().token) throw new Error('errors.auth');
      await api.health();
      const [agentEnv, sessionEnv] = await Promise.all([api.listAgents(), api.listSessions()]);
      if (!agentEnv.ok || !sessionEnv.ok) throw new Error('errors.request');
      setAgents(agentEnv.data ?? []); setSessions(sessionEnv.data ?? []); setConnected(true);
    } catch (e) { setConnected(false); setError(errorKey(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(timer); }, [refresh]);
  useEffect(() => navigation.addListener('focus', () => { void refresh(); }), [navigation, refresh]);
  const startChat = async (selected?: AgentSummary) => {
    setStarting(true); setError(null);
    try {
      if (!getApiConfig().token) throw new Error('errors.auth');
      const agent = selected ?? (await api.createAgent(t('dialogueList.defaultName'), t('dialogueList.defaultDescription'))).data;
      if (!agent) throw new Error('errors.agent');
      const env = await api.ensureSession(agent.id);
      if (!env.ok || !env.data?.id) throw new Error('errors.session');
      setChoosing(false);
      navigation.navigate('Chat', { sessionId: env.data.id, agentId: agent.id, agentName: agent.name, presetCategory: agent.preset?.category, presetTitleKey: agent.preset?.titleKey });
      void refresh();
    } catch (e) { setError(errorKey(e)); }
    finally { setStarting(false); }
  };
  const offline = !connected && !loading;
  return <SafeAreaView style={styles.container}>
    <View style={styles.header}>
      <Text style={styles.headerTitle} numberOfLines={1}>{t('common.app')}</Text>
      <View style={styles.headerRight}>
        {offline && <View style={styles.demoBadge}><Text style={styles.demoBadgeText}>{t('dialogueList.offline')}</Text></View>}
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} testID="settings-button" style={styles.settingsButton} accessibilityLabel={t('common.settings')}><Text style={styles.settingsIcon}>{t('common.settingsIcon')}</Text></TouchableOpacity>
      </View>
    </View>
    {error && <TouchableOpacity style={styles.errorBar} onPress={() => error === 'errors.auth' ? navigation.navigate('Login') : void refresh()} testID="login-hint">
      <Text style={styles.errorText}>{error === 'errors.auth' ? t('dialogueList.loginHint', { error: t(error) }) : t(error)}</Text>
    </TouchableOpacity>}
    <TouchableOpacity style={styles.newChatButton} onPress={() => agents.length ? setChoosing(!choosing) : void startChat()} disabled={starting || loading || offline} accessibilityLabel={t('dialogueList.new')} testID="new-chat-button">
      {starting && <ActivityIndicator size="small" color={colors.onPrimary} />}
      <Text style={styles.newChatText}>{t(starting ? 'dialogueList.preparing' : 'dialogueList.new')}</Text>
    </TouchableOpacity>
    {loading ? <ActivityIndicator color={colors.accent} /> : offline ? <View style={styles.empty} testID="offline-panel">
      <Text style={styles.emptyText}>{t('dialogueList.unavailable')}</Text>
      <Text style={styles.emptySubtext}>{t(error || 'dialogueList.check')}</Text>
      <TouchableOpacity style={styles.offlineAction} onPress={() => void refresh()} testID="retry-button"><Text style={styles.offlineActionText}>{t('common.retry')}</Text></TouchableOpacity>
    </View> : choosing ? <FlatList data={agents} keyExtractor={(item) => item.id} contentContainerStyle={styles.listContent}
      ListHeaderComponent={<Text style={styles.emptyText}>{t('dialogueList.choose')}</Text>}
      renderItem={({ item }) => <TouchableOpacity style={[styles.dialogueCard, { borderLeftColor: colors.accent }]} disabled={starting} onPress={() => void startChat(item)} accessibilityLabel={agentTitle(item)}>
        {item.preset?.icon && <Text style={styles.segIconText} accessibilityElementsHidden>{item.preset.icon}</Text>}
        <View style={styles.dialogueBody}><Text style={styles.dialogueTitle} numberOfLines={2}>{agentTitle(item)}</Text>
          {item.preset?.subtitleKey && i18n.exists(item.preset.subtitleKey) ? <Text style={styles.emptySubtext} numberOfLines={3}>{t(item.preset.subtitleKey)}</Text> : item.preset?.subtitle ? <Text style={styles.emptySubtext} numberOfLines={3}>{item.preset.subtitle}</Text> : null}
        </View>
      </TouchableOpacity>} /> : <FlatList data={sessions} keyExtractor={(item) => item.id} contentContainerStyle={styles.listContent} testID="session-list"
      renderItem={({ item }) => {
        const origin = parseForkOrigin(item.forked_from);
        const agent = agents.find((a) => a.id === item.agent_id);
        const agentName = agentTitle(agent);
        const date = item.last_activity_at ? new Date(item.last_activity_at) : null;
        return <TouchableOpacity style={[styles.dialogueCard, { borderLeftColor: colors.accent }]} testID="session-card"
          onPress={() => navigation.navigate('Chat', { sessionId: item.id, sessionTitle: item.title, forkedFrom: origin, agentId: item.agent_id, agentName: agent?.name, presetCategory: agent?.preset?.category, presetTitleKey: agent?.preset?.titleKey })}
          accessibilityLabel={t('dialogueList.continue', { agentName })}>
          <View style={styles.dialogueBody}><View style={styles.dialogueHeader}>
            <Text style={[styles.dialogueType, { color: colors.accent }]} numberOfLines={1}>{agentName}</Text>
            <Text style={styles.dialogueTime}>{date && Number.isFinite(date.getTime()) ? formatDayLabel(date, i18n.language) : null}</Text>
          </View><Text style={styles.dialogueTitle} numberOfLines={2}>{item.title || t('dialogueList.title', { agentName })}</Text>
          {origin && <><Text style={styles.dialogueType}>{t('fork.badge')}</Text><Text style={styles.emptySubtext} numberOfLines={1}>{t('fork.lineage', { origin: origin.title || sessions.find((session) => session.id === origin.session_id)?.title || t('fork.original') })}</Text></>}
          </View>
        </TouchableOpacity>;
      }} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t('dialogueList.empty')}</Text><Text style={styles.emptySubtext}>{t('dialogueList.start')}</Text></View>} />}
  </SafeAreaView>;
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
    flexShrink: 1,
    minWidth: 0,
    fontSize: typography.title1.fontSize,
    fontWeight: '700',
    color: colors.text1,
  },
  demoBadge: {
    backgroundColor: colors.surfaceRaise,
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
    backgroundColor: colors.surfaceRaise,
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
    flexShrink: 1,
    minWidth: 0,
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
    minWidth: 0,
    flex: 1,
  },
  dialogueHeader: {
    flexWrap: 'wrap',
    gap: spacing.sp2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dialogueType: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 11,
    fontWeight: '700',
  },
  dialogueTime: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 11,
    color: colors.text3,
  },
  dialogueTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 15,
    color: colors.text1,
    fontWeight: '500',
  },
  empty: {
    paddingHorizontal: spacing.sp4,
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
    flexShrink: 1,
    minWidth: 0,
    fontSize: 17,
    color: colors.text2,
    fontWeight: '600',
    marginBottom: spacing.sp2,
  },
  emptySubtext: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 13,
    color: colors.text3,
  },
  offlineAction: {
    marginTop: spacing.sp3,
    backgroundColor: colors.accent,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp5,
    paddingVertical: spacing.sp3,
    alignItems: 'center',
    minWidth: 200,
  },
  offlineActionText: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
});
