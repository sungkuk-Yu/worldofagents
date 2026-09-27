// FeedVideo — 피드 뷰어의 영상 재생 래퍼 (t_4497cfce P0-2).
// expo-video SDK57: useVideoPlayer(source) + <VideoView player contentFit nativeControls> (웹 지원 포함).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

export function FeedVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.play(); });
  return (
    <View style={styles.wrap}>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#000000', borderRadius: 8, overflow: 'hidden' },
  video: { width: '100%', height: '100%' },
});
