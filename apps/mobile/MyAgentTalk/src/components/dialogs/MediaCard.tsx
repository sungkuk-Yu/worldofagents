// media 카드 — Wave 1 #3 (사진/영상 인라인, 인스타 피드 감성의 기본 골격)
// 이미지: expo-image 인라인(카드폭·비율 유지) → 탭 전체화면 라이트박스(탭 확대/원복, ✕ 닫기) →
//   롱프레스 저장/공유 (네이티브: expo-media-library(안드로이드)+Share / 웹: 다운로드 앵커).
// 영상: expo-video 플레이어 인라인(네이티브 컨트롤: 재생/시크/전체화면), poster 오버레이, 자동재생 금지.
// URL은 safeFileUrl(https 전용) 통과분만 렌더 — 악의 스킴 차단. 미지원/실패 시 본문 문구 폴백.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Share, StyleSheet, Text as RNText, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { VideoPlayer } from 'expo-video';
import { useTranslation } from 'react-i18next';
import type { CardProps } from '../../cards/types';
import { cardStyles as s } from '../../cards/styles';
import { displayValue, safeFileUrl } from '../../cards/payload';
import { colors, radii, spacing, typography } from '../../theme';

interface MediaSpec { type: 'image' | 'video'; url: string; poster?: string; width?: number; height?: number; caption?: string }

function parseMedia(payload: CardProps['payload']): MediaSpec | null {
  const type = payload?.media_type === 'image' || payload?.media_type === 'video' ? payload.media_type : null;
  const url = safeFileUrl(payload?.url);
  if (!type || !url) return null;
  return {
    type, url,
    poster: safeFileUrl(payload?.poster) ?? undefined,
    width: typeof payload?.width === 'number' && payload.width > 0 ? payload.width : undefined,
    height: typeof payload?.height === 'number' && payload.height > 0 ? payload.height : undefined,
    caption: displayValue(payload?.caption) || undefined,
  };
}

/** 첫 재생 신호 추적 — 포스터 오버레이를 숨기는 기준 (player.playingChange 구독) */
function usePlayerStarted(player: VideoPlayer): boolean {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const subscription = player.addListener('playingChange', (payload) => { if (payload.isPlaying) setStarted(true); });
    return () => subscription.remove();
  }, [player]);
  return started;
}

/** 저장/공유 — 네이티브: 갤러리 저장(안드로이드)+시스템 공유 / 웹: 다운로드 앵커 */
async function saveOrShare(url: string, caption: string | undefined): Promise<'saved' | 'shared' | 'failed'> {
  if (Platform.OS === 'web') {
    try {
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = caption || 'media'; anchor.target = '_blank'; anchor.rel = 'noopener';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      return 'saved';
    } catch { return 'failed'; }
  }
  try {
    if (Platform.OS === 'android') {
      // expo-media-library는 정적 import 시 웹 번들에서 네이티브 모듈 크래시 — 안드 전용 동적 로드
      const MediaLibrary = await import('expo-media-library');
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (permission.granted) await MediaLibrary.saveToLibraryAsync(url);
    } // iOS: 공유 시트의 "Save to Photos"가 갤러리로 간다 — 별도 권한 불요
    await Share.share({ url, message: caption });
    return 'shared';
  } catch { return 'failed'; }
}

function Lightbox({ media, onClose }: { media: MediaSpec; onClose: () => void }) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const player = useVideoPlayer(media.type === 'video' ? media.url : null, (p) => { p.loop = false; p.play(); });
  return <Modal visible transparent animationType="fade" onRequestClose={onClose} testID="media-lightbox">
    <View style={styles.lightbox}>
      <TouchableOpacity style={styles.lightboxClose} onPress={onClose} accessibilityLabel={t('cards.closeViewer')} testID="media-close">
        <RNText style={styles.lightboxCloseText}>✕</RNText>
      </TouchableOpacity>
      {media.type === 'image' ? (
        <TouchableOpacity activeOpacity={1} style={styles.lightboxBody} onPress={() => setScale((prev) => (prev > 1 ? 1 : 2))}>
          {/* 탭 = 2배 확대/원복 — 라이트박스 핀치 폴백 (#52: 제스처 최소화, 스와이프는 닫기만) */}
          <Image source={{ uri: media.url }} style={[styles.lightboxMedia, { transform: [{ scale }] }]} contentFit="contain" transition={180} />
        </TouchableOpacity>
      ) : (
        <VideoView style={styles.lightboxMedia} player={player} contentFit="contain" nativeControls />
      )}
      {!!media.caption && <RNText style={styles.lightboxCaption}>{media.caption}</RNText>}
    </View>
  </Modal>;
}

/** 접힘 미리보기 (#51/Wave1 공통규칙: media 접힘=poster) — poster 이미지만 렌더, 클릭 금지 */
export function MediaPoster({ payload }: CardProps) {
  const { t } = useTranslation();
  const media = useMemo(() => parseMedia(payload), [payload]);
  const poster = media?.poster ?? (media?.type === 'image' ? media.url : undefined);
  const ratio = media?.width && media?.height ? media.width / media.height : 16 / 9;
  if (!poster) return <Text style={s.micro}>{t('cards.mediaImage')}</Text>;
  return <View style={styles.frame}>
    <Image source={{ uri: poster }} style={[styles.media, { aspectRatio: ratio }]} contentFit="cover" transition={200}
      accessibilityLabel={media?.caption || t('cards.mediaImage')} />
  </View>;
}

export default function MediaCard({ message, payload }: CardProps) {
  const { t } = useTranslation();
  const media = useMemo(() => parseMedia(payload), [payload]);
  const [viewer, setViewer] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const player = useVideoPlayer(media?.type === 'video' ? media.url : null, (p) => { p.loop = false; });
  const started = usePlayerStarted(player);
  const onLongPress = useCallback(() => {
    if (!media) return;
    void saveOrShare(media.url, media.caption).then((result) => {
      if (result === 'failed') { setNotice(t('cards.mediaSaveFailed')); return; }
      if (result === 'saved') { setNotice(t('cards.mediaSaved')); setTimeout(() => setNotice(null), 2000); }
    });
  }, [media, t]);

  if (!media) return <Text style={s.body}>{message.content || t('cards.noContent')}</Text>;
  const ratio = media.width && media.height ? media.width / media.height : 16 / 9;

  return <View>
    <TouchableOpacity activeOpacity={0.92} onPress={() => setViewer(true)} onLongPress={onLongPress}
      delayLongPress={450} style={styles.frame} testID="media-tap">
      {media.type === 'image' ? (
        <Image source={{ uri: media.url }} style={[styles.media, { aspectRatio: ratio }]}
          contentFit="cover" transition={200} recyclingKey={message.id}
          accessibilityLabel={media.caption || t('cards.mediaImage')} />
      ) : (
        <View style={{ aspectRatio: ratio }}>
          <VideoView style={styles.media} player={player} contentFit="cover" nativeControls={Platform.OS === 'web' ? true : undefined} />
          {/* 포스터: expo-video에 poster prop 없음(v57) — 첫 재생 전 expo-image 오버레이 */}
          {media.poster && !started && <Image source={{ uri: media.poster }} style={StyleSheet.absoluteFill as never} contentFit="cover" pointerEvents="none" transition={150} />}
        </View>
      )}
    </TouchableOpacity>
    {!!media.caption && <Text style={s.micro}>{media.caption}</Text>}
    {!!notice && <Text style={styles.notice} testID="media-notice">{notice}</Text>}
    <Text style={s.micro}>{t('cards.mediaHint')}</Text>
    {viewer && <Lightbox media={media} onClose={() => setViewer(false)} />}
  </View>;
}

const styles = StyleSheet.create({
  frame: { backgroundColor: colors.surfaceRaise, borderRadius: radii.md, overflow: 'hidden' },
  media: { width: '100%', height: '100%', borderRadius: radii.md },
  notice: { ...typography.caption, color: colors.statusOk, marginTop: spacing.sp1 },
  lightbox: { flex: 1, backgroundColor: 'rgba(17,24,39,0.94)', alignItems: 'center', justifyContent: 'center' },
  lightboxBody: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  lightboxMedia: { width: '100%', height: '70%' },
  lightboxClose: { position: 'absolute', top: spacing.sp10, right: spacing.sp4, padding: spacing.sp2, zIndex: 2 },
  lightboxCloseText: { color: colors.onPrimary, fontSize: 22 },
  lightboxCaption: { ...typography.caption, color: colors.onPrimary, marginTop: spacing.sp3, paddingHorizontal: spacing.sp4 },
});
