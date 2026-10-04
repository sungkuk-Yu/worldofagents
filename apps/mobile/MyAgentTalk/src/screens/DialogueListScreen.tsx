// 대화 목록과 에이전트 선택은 서버의 실제 데이터를 카드로 표시한다.
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, SafeAreaView, FlatList, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography, iconSize, webScreenMotion } from '../theme';
import { api, getApiConfig, SessionSummary, AgentSummary } from '../lib/api';
import ResumeBanner from '../components/ResumeBanner';
import SessionTitleDialog from '../components/SessionTitleDialog';
// t_710b5d28 — FavoritesModal은 첫 열림 때 동적 로드: 정적 import가 chatLogic(→카드 스택)을
// 부트 그래프에 끌여 __common(969KB)을 eager script 태그로 만든다(실측 10/4). visible=false일
// 때 렌더 0이던 기존 동작과 DOM 동일 — 열리기 전에는 존재하지 않는다.
import { errorKey } from '../lib/errorKeys';
import { parseForkOrigin } from '../lib/forkLogic'; // t_710b5d28 — 부트 그래프 경량(카드 스택 import 금지)
import { newChatTapAction, newChatQueuedAction } from '../lib/newChatTap';
import { readSessionCache, writeSessionCache } from '../lib/sessionCache';
import { prefetchSessionMessages, consumeBootLists } from '../lib/sessionPrefetch';
import { formatDayLabel } from '../i18n/format';
import { BoardIcon, FeedIcon, GearIcon, MicIcon, StarIcon } from '../components/Icon';

// t_710b5d28 — 즐겨찾기 모달은 App의 asyncScreens 단일 루트 멤버로 로드 (별도 import()는
// 별도 청크 경계를 만들어 공유 코드를 다시 hoist시킨다 — 루트는 하나만)
const LazyFavoritesModal = lazy(async () => ({ default: (await import('./asyncScreens')).FavoritesModal }));

interface Props { navigation: any; route?: any; variant?: 'full' | 'sidebar' | 'home' }
export default function DialogueListScreen({ navigation, variant = 'full' }: Props) {
  const { t, i18n } = useTranslation();
  const isSidebar = variant === 'sidebar';
  const isHome = variant === 'home';
  // 헤더 워드마크 노출 임계 (t_3c882443 요구2) — 모바일 폭은 마크 단독, 넓은 화면만 마크+워드마크.
  const { width: headerWidth } = useWindowDimensions();
  // t_710b5d28 낙관 시드 — localStorage 스냅샷을 최초 state로(lazy initializer: effect 없이
  // 렌더 전 판정, react-hooks/set-state-in-effect 규칙 준수). 서버 응답이 도착하면 조용히 대체
  // 된다(캐논=서버). 사모드/파손/타 계정 = 미스 → 빈 배열(현행 스피너 경로와 동일).
  const [sessions, setSessions] = useState<SessionSummary[]>(() => readSessionCache(getApiConfig().token)?.sessions ?? []);
  const [agents, setAgents] = useState<AgentSummary[]>(() => readSessionCache(getApiConfig().token)?.agents ?? []);
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
  // 제목 수정 (t_8917ca0d ③) — 목록 행 롱프레스 → SessionTitleDialog. 저장 성공 시 로컬 행 즉시 갱신
  // (refocus 시 서버 재fetch가 캐논, 낙관 반영은 목록 잔상 제거용).
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  // t_710b5d28 — 즐겨찾기 상단 모달 (t_fd869e5b 요구3) — 첫 열림 때 동적 로드(위 주석), 미열림 = 렌더 0.
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const agentTitle = (agent?: AgentSummary) => agent?.preset?.titleKey && i18n.exists(agent.preset.titleKey)
    ? t(agent.preset.titleKey) : agent?.name || t('common.agent');
  const refreshGen = useRef(0);      // t_710b5d28 health 병렬 응답의 최신 런 가드
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const token = getApiConfig().token;
    if (!token) {
      // 토큰 없음 = 온보딩. 네트워크 판정(connected)을 건드리지 않고 로그인 배너만 띄운다.
      setConnected(false); setError('errors.auth'); setLoading(false); return;
    }
    // t_710b5d28 (10/4 속도 P0 실측) — 부트 워터폴: health 선행 직렬 왕복(0.7~1.1s)이 목록
    // 데이터를 잡았다. health는 connected(오프라인 배지) 전용 용도이므로 agents/sessions과
    // 병렬로 내리고, 목록 페인트는 데이터 응답만 기다린다. 판정 계약:
    //  · errors.auth(401) — request 매핑 그대로 data 요청에서 던져진다(기존 경로 1:1).
    //  · offline — 데이터 요청 자체가 실패한 경우만(아래 render). connected 지연은 배지/배너만
    //    관할: 목록 성공 + health 지연 시 오프라인 패널이 목록을 덮는 플래시 회귀 차단.
    const gen = ++refreshGen.current;
    void api.health().then(() => { if (gen === refreshGen.current) setConnected(true); })
      .catch(() => { if (gen === refreshGen.current) setConnected(false); });
    try {
      // t_710b5d28 — 부트 prefetch 소비(스플래시 병렬로 출발한 왕복): 1회만. focus 재refresh는
      // 캐논 보장을 위해 반드시 서버를 새로 읽는다.
      const prefetched = await consumeBootLists();
      const [agentEnv, sessionEnv] = prefetched
        ? [prefetched.agents, prefetched.sessions]
        : await Promise.all([api.listAgents(), api.listSessions()]);
      if (!agentEnv.ok || !sessionEnv.ok) throw new Error('errors.request');
      setAgents(agentEnv.data ?? []); setSessions(sessionEnv.data ?? []);
      // 낙관 캐시: 다음 부트(서버 응답 전)에 이 스냅샷으로 즉시 렌더 — 스피너 창 제거.
      writeSessionCache(token, sessionEnv.data ?? [], agentEnv.data ?? []);
    } catch (e) {
      const key = errorKey(e);
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
  // error 확정 시 폐기(t_cb8 드레인 계약): 실패한 starting의 재자동 실행 루프 금지 — 오류 배너 확인 후 사용자 판단.
  useEffect(() => {
    if (loading || !queuedTap.current) return;
    queuedTap.current = false;
    if (error) return; // 실패/온보딩 = 드레인 폐기 (t_cb8 계약, signedOut 포함)
    // t_710b5d28: connected(health 병렬)가 목록 페인트보다 늦을 수 있으므로 드레인은
    // error 단일 소스로 판정 — 구 `!connected` 게이트는 health 지연 시 큐잉 드랍 회귀를 만든다.
    if (newChatQueuedAction(agents.length > 0) === 'chooserOpen') setChoosing(true);
    else void startChat();
  }, [loading, connected, error, agents.length]);
  // 미로그인(error=auth)은 온보딩, 오프라인은 네트워크/서버 실제 실패에만 (t_c0fb3b22 P0)
  // t_710b5d28: health가 병렬화되었으므로 connected는 목록 게이트에서 하차 — 패널 판정은
  // 데이터 요청 실패(error) 단일 소스. 목록 성공+health 지연 구간의 오프라인 패널 플래시 차단.
  const signedOut = error === 'errors.auth' && !loading;
  const offline = !!error && !loading && !signedOut;
  return <SafeAreaView style={[styles.container, isSidebar && styles.sidebarShell, webScreenMotion('mat-slide-from-right')]}>
    {!isSidebar && <View style={styles.header}>
      {/* t_3c882443 요구2 (대표님 10/4 "왼쪽 상단도 MAT는 My Agent Talk라고 해주고, 우리 로고를 크게 넣어줘"):
          t_64af90b0 #11의 'MAT' 텍스트 워드마크 → g3 확정 마크(wide-A+직립 i+버블, repo brand 자산) 대형 + MyAgentTalk 워드마크.
          워드마크는 브랜드 영문 고정이므로 미번역 (라틴은 Inter 700).
          폭 좁은 모바일(<640)은 아이콘 버튼 6종이 우측을 점유 — 워드마크 대신 마크 단독(브랜드 승계). */}
      <View style={styles.brandRow} testID="header-brand">
        <Image source={require('../../assets/logo-mark-g3.png')} style={styles.headerMark} contentFit="contain" accessibilityLabel={t('common.app')} />
        {headerWidth >= 640 && <Text style={styles.headerWordmark} numberOfLines={1}>MyAgentTalk</Text>}
      </View>
      <View style={styles.headerRight}>
        {offline && <View style={styles.demoBadge}><Text style={styles.demoBadgeText}>{t('dialogueList.offline')}</Text></View>}
        {/* t_64af90b0 #2 — 이모지/문자 글리프 버튼 → SVG 아이콘 (접근성 라벨 유지) */}
        {/* 즐겨찾기 (t_fd869e5b 요구3): 헤더 탭 = 상단 모달(라우트 push 아님) — ★ 탭 → 즉시 목록 열람.
            Favorites 라우트는 조이스틱 매크로 등 타 진입점 호환 위해 보존. */}
        <TouchableOpacity onPress={() => setFavoritesOpen(true)} testID="favorites-button" style={styles.settingsButton} accessibilityLabel={t('favorites.title')}><StarIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
        {/* 피드 진입 (t_4497cfce P0-2): 즐겨찾기 소스 이미지/영상 그리드 */}
        <TouchableOpacity onPress={() => navigation.navigate('Feed')} testID="feed-button" style={styles.settingsButton} accessibilityLabel={t('feed.title')}><FeedIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
        {/* t_fd869e5b 요구2 (대표님 10/4): 볼트 노트 UI 폐기 — 사용자는 보지 않고 서버 내부 저장만 유지.
            물리 파일·API(t_d469fac3 사이드카) 그대로, 진입 버튼만 제거. 보드는 유지. */}
        <TouchableOpacity onPress={() => navigation.navigate('Board')} testID="board-button" style={styles.settingsButton} accessibilityLabel={t('board.title')}><BoardIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
        {/* 음성 홈 진입 (t_5de18a91 — 3모드 입력 실사용/검증 경로. Phase 1부터 화면만 있고 진입점이 없었음) */}
        <TouchableOpacity onPress={() => navigation.navigate('VoiceHome')} testID="voice-button" style={styles.settingsButton} accessibilityLabel={t('common.voice')}><MicIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} testID="settings-button" style={styles.settingsButton} accessibilityLabel={t('common.settings')}><GearIcon size={iconSize.glyph} color={colors.text2} /></TouchableOpacity>
      </View>
    </View>}
    {isSidebar && <View style={styles.sidebarHeader}>
      {/* 사이드바 레일(폭 300)도 동일 브랜드 — 마크는 레일용 축소, testID 유지 (shot_drfix_e2e 단언) */}
      <View style={styles.brandRow} testID="header-brand">
        <Image source={require('../../assets/logo-mark-g3.png')} style={styles.sidebarMark} contentFit="contain" accessibilityLabel={t('common.app')} testID="sidebar-logo" />
        <Text style={styles.sidebarWordmark} numberOfLines={1}>MyAgentTalk</Text>
      </View>
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
        starting(스피너 노출 중)/offline(패널 안내)만 비활성. (t_cb8e978a 인라인 큐잉은 lib/newChatTap 단일 구현으로 흡수) */}
    <TouchableOpacity style={styles.newChatButton} onPress={onNewChatTap} disabled={starting || offline} accessibilityLabel={t('dialogueList.new')} testID="new-chat-button">
      {starting && <ActivityIndicator size="small" color={colors.onPrimary} />}
      <Text style={styles.newChatText}>{t(starting ? 'dialogueList.preparing' : 'dialogueList.new')}</Text>
    </TouchableOpacity>
    {/* t_710b5d28 낙관 시드: 캐시 스냅샷이 있으면 로딩 중에도 목록을 먼저 렌더(행tap·스크롤 가능,
        서버 응답 도착 시 조용히 대체). 행이 없을 때만 스피너 — 기존 첫 로그인 경로는 불변. */}
    {loading && !sessions.length ? <ActivityIndicator color={colors.accent} /> : signedOut ? <View style={styles.empty} testID="onboarding-panel">
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
          onPress={() => { prefetchSessionMessages(item.id); navigation.navigate('Chat', { sessionId: item.id, sessionTitle: item.title, forkedFrom: origin, agentId: item.agent_id, agentName: agent?.name, presetCategory: agent?.preset?.category, presetTitleKey: agent?.preset?.titleKey }); }}
          onLongPress={() => setRenameTarget(item)} delayLongPress={450}
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
    {/* 제목 수정 다이얼로그 (t_8917ca0d ③) — 저장 성공 시 행 제목만 낙관 갱신(서버가 캐논) */}
    {renameTarget && <SessionTitleDialog
      sessionId={renameTarget.id}
      title={renameTarget.title || ''}
      onClose={() => setRenameTarget(null)}
      onRenamed={(next) => setSessions((cur) => cur.map((s) => (s.id === renameTarget.id ? { ...s, title: next } : s)))}
    />}
    {/* 즐겨찾기 상단 모달 (t_fd869e5b 요구3) — transparent Modal: FlatList 히트 압도 회고(t_3116c5bc)로
        Modal 래퍼 유지. 딥링크 탭 = 세션 이동 + focusMessageId 하이라이트 (기존 화면과 동일 경로). */}
    {favoritesOpen && <Suspense fallback={null}>
      <LazyFavoritesModal visible={favoritesOpen} onClose={() => setFavoritesOpen(false)} navigation={navigation} />
    </Suspense>}
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
  // t_3c882443 요구2 — 헤더 브랜드 락업: g3 확정 마크(이미지, 대형) + MyAgentTalk 워드마크.
  // 마크는 초록 원체(brand 자산), 워드마크는 텍스트1(흑) — 컬러 마크 + 중립 워드 표준 락업.
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
    flexShrink: 1,
    minWidth: 0,
  },
  headerMark: { width: 40, height: 40 },
  headerWordmark: {
    ...typography.title1,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
    color: colors.text1,
  },
  // 레일(폭 300) — 마크/워드마크 축소, 한 줄 유지
  sidebarMark: { width: 30, height: 30 },
  sidebarWordmark: {
    ...typography.headline,
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
    color: colors.text1,
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
