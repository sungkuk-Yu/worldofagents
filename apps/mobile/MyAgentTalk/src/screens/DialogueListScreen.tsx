// 대화 목록과 에이전트 선택은 서버의 실제 데이터를 카드로 표시한다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, SafeAreaView, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography, iconSize, webScreenMotion } from '../theme';
import { api, getApiConfig, SessionSummary, AgentSummary } from '../lib/api';
import ResumeBanner from '../components/ResumeBanner';
import { errorKey } from '../lib/errorKeys';
import { parseForkOrigin } from '../lib/cardLogic';
import { newChatTapAction, newChatQueuedAction } from '../lib/newChatTap';
import { formatDayLabel } from '../i18n/format';
import { BoardIcon, FeedIcon, GearIcon, MicIcon, StarIcon, VaultIcon } from '../components/Icon';

interface Props { navigation: any; route?: any; variant?: 'full' | 'sidebar' | 'home' }
export default function DialogueListScreen({ navigation, variant = 'full' }: Props) {
  const { t, i18n } = useTranslation();
  const isSidebar = variant === 'sidebar';
  const isHome = variant === 'home';
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // 상태 분리 (t_c0fb3b22 P0): signedOut(error=auth) vs offline(connected=false) 구분.
  // 미로그인은 정상 온보딩 상태 — 서버 다운("unavailable")과 절대 혼용하지 않는다.
  const [connected, setConnected] = useState(false);
  const [starting, setStarting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  // 탭 큐잉 (t_5058e15f ①/9/30 실패로그 #1): 라이브 첫 refresh(DNS+TLS 수 초) 동안의 '새 대화'
  // 탭이 disabled에 조용히 흡수됨(재탭 2~5회 실측) — 흡수 대신 큐잉하고 로딩 해지 시점의
  // 데이터로 그 순간 실행(재탭과 동일 결과). 실행은 loading→!loading 전환 useEffect에서.
  const queuedTap = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const agentTitle = (agent?: AgentSummary) => agent?.preset?.titleKey && i18n.exists(agent.preset.titleKey)
    ? t(agent.preset.titleKey) : agent?.name || t('common.agent');
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    if (!getApiConfig().token) {
      // 토큰 없음 = 온보딩. 네트워크 판정(connected)을 건드리지 않고 로그인 배너만 띄운다.
      setConnected(false); setError('errors.auth'); setLoading(false); return;
    }
    try {
      await api.health();
      const [agentEnv, sessionEnv] = await Promise.all([api.listAgents(), api.listSessions()]);
      if (!agentEnv.ok || !sessionEnv.ok) throw new Error('errors.request');
      setAgents(agentEnv.data ?? []); setSessions(sessionEnv.data ?? []); setConnected(true);
    } catch (e) {
      const key = errorKey(e);
      setConnected(false);
      if (key === 'errors.auth') setError('errors.auth'); // 401/403 = 세션 만료, 서버 다운 아님
      else setError(key); // 네트워크/5xx = 진짜 오프라인
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(timer); }, [refresh]);
  useEffect(() => navigation.addListener('focus', () => { void refresh(); }), [navigation, refresh]);
  const startChat = async (selected?: AgentSummary) => {
    setStarting(true); setError(null);
    try {
      if (!getApiConfig().token) { navigation.navigate('Login'); return; } // 미로그인 탭 = 온보딩 경로 (t_c0fb3b22 요구 2)
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
  // '새 대화' 탭 (t_5058e15f ①): 상태 판정은 lib/newChatTap 순수 로직.
  // 로딩 중 탭 = 조용한 흡수 대신 큐잉 — 로딩 해지 시점의 데이터로 실행(재탭과 동일 결과).
  const onNewChatTap = () => {
    const action = newChatTapAction({ starting, loading, offline, hasAgents: agents.length > 0, choosing });
    if (action === 'queue') { queuedTap.current = true; return; }
    if (action === 'chooserOpen') { setChoosing(true); return; }
    if (action === 'chooserClose') { setChoosing(false); return; }
    if (action === 'start') void startChat();
  };
  // 큐잉 해지: loading이 끝난 순간의 agents/연결 상태 기준으로 그 자리에서 실행.
  // 오프라인 해지(서버 실패)면 폐기 — 원래 버튼이 비활성인 상태와 동일(오프라인 패널이 안내).
  useEffect(() => {
    if (loading || !queuedTap.current) return;
    queuedTap.current = false;
    const signedOutNow = error === 'errors.auth' && !loading;
    if (!connected && !signedOutNow) return;
    if (newChatQueuedAction(agents.length > 0) === 'chooserOpen') setChoosing(true);
    else void startChat();
  }, [loading, connected, error, agents.length]);
  // 미로그인(error=auth)은 온보딩, 오프라인은 네트워크/서버 실제 실패에만 (t_c0fb3b22 P0)
  const signedOut = error === 'errors.auth' && !loading;
  const offline = !connected && !loading && !signedOut;
  return <SafeAreaView style={[styles.container, isSidebar && styles.sidebarShell, webScreenMotion('mat-slide-from-right')]}>
    {!isSidebar && <View style={styles.header}>
      {/* t_64af90b0 #11 — 검은 굵은 '마이에이전트톡' 텍스트 로고 → 초록 MAT 워드마크 (Round 7 확정 전까지 sans 통일) */}
      <Text style={styles.headerLogo} numberOfLines={1}>{t('common.logo')}</Text>
      <View style={styles.headerRight}>
        {offline && <View style={styles.demoBadge}><Text style={styles.demoBadgeText}>{t('dialogueList.offline')}</Text></View>}
        {/* t_64af90b0 #2 — 이모지/문자 글리프 버튼 → SVG 아이콘 (접근성 라벨 유지) */}
        <TouchableOpacity onPress={() => navigation.navigate('Favorites')} testID="favorites-button" style={styles.settingsButton} accessibilityLabel={t('favorites.title')}><StarIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
        {/* 피드 진입 (t_4497cfce P0-2): 즐겨찾기 소스 이미지/영상 그리드 */}
        <TouchableOpacity onPress={() => navigation.navigate('Feed')} testID="feed-button" style={styles.settingsButton} accessibilityLabel={t('feed.title')}><FeedIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
        {/* 볼트/보드 진입 (Wave2 t_174b66d2 — "옵시디언과 칸반을 모두 적용" 대표님 지시) */}
        <TouchableOpacity onPress={() => navigation.navigate('Vault')} testID="vault-button" style={styles.settingsButton} accessibilityLabel={t('vault.title')}><VaultIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Board')} testID="board-button" style={styles.settingsButton} accessibilityLabel={t('board.title')}><BoardIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
        {/* 음성 홈 진입 (t_5de18a91 — 3모드 입력 실사용/검증 경로. Phase 1부터 화면만 있고 진입점이 없었음) */}
        <TouchableOpacity onPress={() => navigation.navigate('VoiceHome')} testID="voice-button" style={styles.settingsButton} accessibilityLabel={t('common.voice')}><MicIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} testID="settings-button" style={styles.settingsButton} accessibilityLabel={t('common.settings')}><GearIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
      </View>
    </View>}
    {isSidebar && <View style={styles.sidebarHeader}>
      <Text style={styles.headerLogo} numberOfLines={1} testID="sidebar-logo">{t('common.logo')}</Text>
      <View style={styles.headerRight}>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} testID="sidebar-settings-button" accessibilityLabel={t('common.settings')}><GearIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
      </View>
    </View>}
    {/* 이어보기 배너 (t_eded715c): PC 홈(중앙)에서만 — 다른 기기 미읽음 세션으로 즉시 이동 */}
    {isHome && connected && <ResumeBanner onOpen={(item) => navigation.navigate('Chat', { sessionId: item.session_id, sessionTitle: item.title ?? undefined, agentId: item.agent_id ?? undefined, agentName: item.agent_name ?? undefined })} />}
    {error && <TouchableOpacity style={styles.errorBar} onPress={() => error === 'errors.auth' ? navigation.navigate('Login') : void refresh()} testID="login-hint">
      <Text style={styles.errorText}>{error === 'errors.auth' ? t('dialogueList.loginHint', { error: t(error) }) : t(error)}</Text>
    </TouchableOpacity>}
    {/* t_5058e15f ①: 로딩 중에는 disabled 대신 탭 큐잉(onPress가 queue로 흡수) — 첫 탭 무반응 결함 제거.
        starting(스피너 노출 중)/offline(패널 안내)만 비활성. */}
    <TouchableOpacity style={styles.newChatButton} onPress={onNewChatTap} disabled={starting || offline} accessibilityLabel={t('dialogueList.new')} testID="new-chat-button">
      {starting && <ActivityIndicator size="small" color={colors.onPrimary} />}
      <Text style={styles.newChatText}>{t(starting ? 'dialogueList.preparing' : 'dialogueList.new')}</Text>
    </TouchableOpacity>
    {loading ? <ActivityIndicator color={colors.accent} /> : signedOut ? <View style={styles.empty} testID="onboarding-panel">
      <Text style={styles.emptyText}>{t('errors.auth')}</Text>
      <Text style={styles.emptySubtext}>{t('dialogueList.loginSub')}</Text>
      <TouchableOpacity style={styles.offlineAction} onPress={() => navigation.navigate('Login')} testID="signin-button"><Text style={styles.offlineActionText}>{t('dialogueList.signin')}</Text></TouchableOpacity>
    </View> : offline ? <View style={styles.empty} testID="offline-panel">
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
          <View style={styles.dialogueBody}><Text style={[styles.dialogueType, { color: colors.accent }]} numberOfLines={1}>{agentName}</Text>
            {/* t_64af90b0 #6 — 제목 한 줄 ellipsis + word-break:keep-all(한글 어절 유지, 세로 줄바꿈 파손 방지),
                시간은 우하 캡션으로 이동 (우상단 초소형 회색 폐기) */}
            <View style={styles.dialogueTitleRow}>
              <Text style={styles.dialogueTitle} numberOfLines={1}>{item.title || t('dialogueList.title', { agentName })}</Text>
              <Text style={styles.dialogueTime}>{date && Number.isFinite(date.getTime()) ? formatDayLabel(date, i18n.language) : null}</Text>
            </View>
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
  // PC 사이드바 변형 (t_eded715c): 레일은 surface 배경 + 구분선, 헤더는 컴팩트
  sidebarShell: { backgroundColor: colors.surface },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sp3,
    paddingHorizontal: spacing.sp3,
    paddingBottom: spacing.sp2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // t_64af90b0 #7 — 상단 여백과 '새 대화' 버튼 여백 균형 (위 좁고 아래 넓음 시정)
    paddingTop: spacing.sp5,
    paddingHorizontal: spacing.sp4,
    paddingBottom: spacing.sp2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
  },
  headerTitle: {
    ...typography.title1,
    flexShrink: 1,
    minWidth: 0,
    color: colors.text1,
  },
  // t_64af90b0 #11 — 목록 헤더 로고: 초록 MAT 워드마크 (sans, 굵게). 라운드7 확정 시 이미지 로고로 교체.
  headerLogo: {
    ...typography.title1,
    fontSize: 22,
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
    color: colors.accent,
  },
  demoBadge: {
    backgroundColor: colors.surfaceRaise,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp2,
    paddingVertical: 3,
  },
  demoBadgeText: {
    ...typography.microSm,
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
    ...typography.headline,
    fontSize: iconSize.glyph,
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
    ...typography.caption,
    color: colors.statusErr,
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sp2,
    marginHorizontal: spacing.sp4,
    marginTop: spacing.sp2,
    marginBottom: spacing.sp3,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.sp3 + 2,
  },
  newChatIcon: {
    ...typography.headline,
    fontSize: iconSize.glyph,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  newChatText: {
    ...typography.bodyBold,
    flexShrink: 1,
    minWidth: 0,
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
    ...typography.body,
    fontSize: iconSize.tile,
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
  // t_64af90b0 #6 — 제목(좌) + 시간 캡션(우하) 한 줄 행
  dialogueTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sp2,
    minWidth: 0,
  },
  dialogueType: {
    ...typography.micro,
    fontWeight: '700',
    flexShrink: 1,
    minWidth: 0,
  },
  dialogueTime: {
    ...typography.caption,
    color: colors.text3,
    flexShrink: 0,
  },
  dialogueTitle: {
    ...typography.body,
    fontWeight: '600',
    flexShrink: 1,
    minWidth: 0,
    color: colors.text1,
    // 한글 어절 유지 — '내/변호사와의 대화' 식 세로 파절 방지 (웹: word-break keep-all)
    ...(Platform.OS === 'web' ? { wordBreak: 'keep-all' } as never : {}),
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
    ...typography.title1,
    fontSize: iconSize.hero,
  },
  emptyText: {
    ...typography.headline,
    flexShrink: 1,
    minWidth: 0,
    color: colors.text2,
    marginBottom: spacing.sp2,
  },
  emptySubtext: {
    ...typography.subhead,
    flexShrink: 1,
    minWidth: 0,
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
    ...typography.bodyBold,
    flexShrink: 1,
    minWidth: 0,
    color: colors.onPrimary,
  },
});
