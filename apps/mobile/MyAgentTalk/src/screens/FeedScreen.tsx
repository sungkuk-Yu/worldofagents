// FeedScreen — 인스타 피드 공유 (t_4497cfce P0-2): 즐겨찾기(=저장) 소스의 이미지/영상 그리드.
// 백엔드 feed 테이블 없음(카드 결정: 파생 뷰) → GET /api/favorites를 toFeedPost로 사영.
// 세그먼트 all·photo·media · 2단 격자 · 탭 = 전체화면 뷰어(저장/즐겨찾기 해제) · 원본 세션 딥링크.
// 개인정보: 세션 컨텍스트 비노출(카드 본문/이미지만), form_response는 격자에서 제외.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { FeedVideo } from '../components/FeedVideo';
import { api, FavoriteEntry } from '../lib/api';
import { errorKey } from '../lib/errorKeys';
import { FeedPost, FeedSegment, filterFeedPosts, isVideoUrl, toFeedPost } from '../lib/photoLogic';
import { downloadUrlWeb } from '../lib/photoCapture';
import { FeedIcon, StarIcon } from '../components/Icon';
import { colors, radii, spacing, typography, iconSize } from '../theme';

const PAGE = 100; // 파생 뷰 — 즐겨찾기 전량(서버 cap 200/회 + has_more 루프)

export default function FeedScreen({ navigation }: { navigation: any }) {
  const { t } = useTranslation();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [segment, setSegment] = useState<FeedSegment>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const acc: FavoriteEntry[] = [];
      let offset = 0;
      for (let guard = 0; guard < 10; guard++) {
        const env = await api.listFavorites({ limit: PAGE, offset });
        if (!env.ok) throw new Error(env.error?.code === 'AUTH_REQUIRED' ? 'errors.auth' : 'errors.request');
        acc.push(...(env.data ?? []));
        if (!env.meta?.has_more || !env.data?.length) break;
        offset += env.data.length;
      }
      const derived = acc
        .map((e) => toFeedPost({
          message: { id: e.message.id, content: e.message.content, created_at: e.message.created_at, dialogue_type: e.message.dialogue_type, structured_payload: e.message.structured_payload, attachments: e.message.attachments, favorite: e.message.favorite },
          session: { id: e.session.id, title: e.session.title, agent_name: e.session.agent_name },
        }))
        // form_response(PII 포함 가능)는 외부 스냅샷 금지 — 격자에서 제외 (세션 컨텍스트 비노출 원칙)
        .filter((p): p is FeedPost => !!p && p.kind !== 'form_response');
      setPosts(derived);
      setError(null);
    } catch (e) { setError(errorKey(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => navigation.addListener('focus', () => { void load(); }), [navigation, load]);

  const visible = useMemo(() => filterFeedPosts(posts.filter((p) => p.kind !== 'form_response'), segment), [posts, segment]);
  const viewer = useMemo(() => posts.find((p) => p.messageId === viewerId) ?? null, [posts, viewerId]);

  const unfavorite = useCallback((post: FeedPost) => {
    setPosts((prev) => prev.filter((p) => p.messageId !== post.messageId));
    setViewerId(null);
    api.setFavorite(post.messageId, false).catch(() => { setError('errors.favorite'); void load(); });
  }, [load]);

  const openSource = useCallback((post: FeedPost) => {
    setViewerId(null);
    navigation.navigate('Chat', { sessionId: post.sessionId, sessionTitle: post.sessionTitle || undefined, agentName: post.agentName || undefined, focusMessageId: post.messageId });
  }, [navigation]);

  const save = useCallback((post: FeedPost) => {
    const url = post.mediaUrls[0];
    if (url) void downloadUrlWeb(url, post.kind);
  }, []);

  if (loading) return <View style={st.center}><ActivityIndicator color={colors.accent} testID="feed-loading" /></View>;
  return (
    <View style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')} style={st.headerButton} testID="feed-back">
          <Text style={st.headerIcon}>{'\u2039'}</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>{t('feed.title')}</Text>
        <View style={st.headerButton} />
      </View>
      <View style={st.segments} testID="feed-segments">
        {(['all', 'photo', 'media'] as FeedSegment[]).map((s) => (
          <TouchableOpacity key={s} style={[st.segment, segment === s && st.segmentActive]} onPress={() => setSegment(s)} testID={`feed-segment-${s}`}>
            <Text style={[st.segmentText, segment === s && st.segmentTextActive]}>{t(`feed.segments.${s}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error && <TouchableOpacity style={st.errorBar} onPress={() => void load()} testID="feed-retry"><Text style={st.errorText}>{t(error)}</Text></TouchableOpacity>}
      {!visible.length && !error && (
        <View style={st.center}>
          <FeedIcon size={iconSize.hero} color={colors.borderStrong} />
          <Text style={st.emptyText}>{t('feed.empty')}</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={st.grid} testID="feed-grid">
        {visible.map((post) => {
          const cover = post.mediaUrls[0];
          const video = !!cover && isVideoUrl(cover);
          return (
            <TouchableOpacity key={post.messageId} style={st.tile} onPress={() => setViewerId(post.messageId)} testID={`feed-tile-${post.messageId}`} accessibilityLabel={post.caption || t('feed.title')}>
              {cover
                ? <Image source={{ uri: cover }} style={st.tileImage} contentFit="cover" transition={120} />
                : <View style={st.tileText}><Text style={st.tileTextBody} numberOfLines={5}>{post.caption}</Text></View>}
              {video && <View style={st.playBadge}><Text style={st.playBadgeText}>{'\u25B6'}</Text></View>}
              {post.editBadge && <View style={st.editBadge}><Text style={st.editBadgeText}>{t('feed.editBadge')}</Text></View>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {/* 전체화면 뷰어 — 저장(웹) · 원본 세션 딥링크 · 즐겨찾기 해제 */}
      <Modal visible={!!viewer} animationType="fade" transparent onRequestClose={() => setViewerId(null)}>
        {viewer && (
          <View style={st.viewer}>
            <View style={st.viewerHeader}>
              <TouchableOpacity onPress={() => setViewerId(null)} accessibilityLabel={t('common.close')} testID="feed-viewer-close"><Text style={st.viewerIcon}>{'\u2715'}</Text></TouchableOpacity>
              <Text style={st.viewerTitle} numberOfLines={1}>{t('feed.viewTitle')}</Text>
              <TouchableOpacity onPress={() => unfavorite(viewer)} accessibilityLabel={t('cards.unfavorite')} testID="feed-viewer-unstar"><StarIcon size={iconSize.glyphLg} color={colors.accent} filled /></TouchableOpacity>
            </View>
            <View style={st.viewerBody}>
              {viewer.mediaUrls.length === 0 && <Text style={st.viewerText}>{viewer.caption}</Text>}
              {viewer.mediaUrls.map((url) => (
                <View key={url} style={st.viewerMediaWrap} testID="feed-viewer-media">
                  {isVideoUrl(url)
                    ? <FeedVideo uri={url} />
                    : <Image source={{ uri: url }} style={st.viewerMedia} contentFit="contain" transition={120} />}
                </View>
              ))}
            </View>
            {!!viewer.caption && viewer.mediaUrls.length > 0 && <Text style={st.viewerCaption} numberOfLines={3}>{viewer.caption}</Text>}
            <View style={st.viewerActions}>
              {viewer.mediaUrls.length > 0 && Platform.OS === 'web' && (
                <TouchableOpacity style={st.viewerBtn} onPress={() => save(viewer)} testID="feed-viewer-save"><Text style={st.viewerBtnText}>{t('feed.save')}</Text></TouchableOpacity>
              )}
              {viewer.sessionId && (
                <TouchableOpacity style={st.viewerBtn} onPress={() => openSource(viewer)} testID="feed-viewer-open-source"><Text style={st.viewerBtnText}>{t('feed.openSource')}</Text></TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sp3, padding: spacing.sp6 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sp2, paddingVertical: spacing.sp2, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerButton: { padding: spacing.sp2, minWidth: iconSize.hero },
  headerIcon: { ...typography.display, color: colors.text1, lineHeight: 30 },
  headerTitle: { ...typography.title2, color: colors.text1, flex: 1, textAlign: 'center' },
  segments: { flexDirection: 'row', gap: spacing.sp2, padding: spacing.sp3, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  segment: { paddingHorizontal: spacing.sp4, paddingVertical: spacing.sp2, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  segmentActive: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  segmentText: { ...typography.caption, color: colors.text2 },
  segmentTextActive: { color: colors.accent },
  errorBar: { padding: spacing.sp3 },
  errorText: { ...typography.caption, color: colors.statusErr },
  emptyText: { ...typography.subhead, color: colors.text3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 2 },
  tile: { width: '50%', aspectRatio: 1, padding: 2, backgroundColor: colors.bg, position: 'relative' },
  tileImage: { width: '100%', height: '100%', borderRadius: radii.sm, backgroundColor: colors.surfaceRaise },
  tileText: { width: '100%', height: '100%', padding: spacing.sp3, justifyContent: 'center', backgroundColor: colors.surface, borderRadius: radii.sm },
  tileTextBody: { ...typography.caption, color: colors.text2 },
  playBadge: { position: 'absolute', left: spacing.sp4, bottom: spacing.sp4, backgroundColor: 'rgba(11,14,20,0.6)', borderRadius: radii.full, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  playBadgeText: { color: colors.onPrimary, fontSize: 11 },
  editBadge: { position: 'absolute', right: spacing.sp4, top: spacing.sp4, backgroundColor: 'rgba(11,14,20,0.6)', borderRadius: radii.xs, paddingHorizontal: spacing.sp2, paddingVertical: 2 },
  editBadgeText: { ...typography.microXs, color: colors.onPrimary },
  viewer: { flex: 1, backgroundColor: '#0B0E14' },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.sp3, paddingTop: spacing.sp6 },
  viewerIcon: { ...typography.headline, color: colors.onPrimary, paddingHorizontal: spacing.sp2 },
  viewerTitle: { ...typography.headline, color: colors.onPrimary, flex: 1, textAlign: 'center', minWidth: 0 },
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.sp3 },
  viewerMediaWrap: { width: '100%', alignItems: 'center', marginBottom: spacing.sp3 },
  viewerMedia: { width: '100%', maxHeight: 420, borderRadius: radii.sm },
  viewerText: { ...typography.body, color: colors.onPrimary, textAlign: 'center' },
  viewerCaption: { ...typography.caption, color: colors.onPrimary, opacity: 0.85, paddingHorizontal: spacing.sp4, paddingBottom: spacing.sp2, textAlign: 'center' },
  viewerActions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sp4, padding: spacing.sp5 },
  viewerBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: radii.full, paddingHorizontal: spacing.sp5, paddingVertical: spacing.sp2 },
  viewerBtnText: { ...typography.caption, color: colors.onPrimary },
});
