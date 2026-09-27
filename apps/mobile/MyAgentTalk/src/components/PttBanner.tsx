// PTT 입력 배너 — 녹음 중 화면 하단 고정 상태 표시 (확정 ④: 웨이브폼 + 말하세요).
// PC: 키 라벨(V 등 재매핑 가능) 힌트도 노출. 네이티브는 이 컴포넌트를 쓰지 않는다.
// t_4b1bd4c2 요구 1: 입력창 옆 마이크 홀드 버튼(PttMicButton) 폐기 — 음성 진입은 조이스틱 탭/PTT 키로만.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import Waveform from './Waveform';
import { colors, radii, spacing, typography } from '../theme';

interface Props {
  active: boolean;
  keyLabel?: string;
  mode: 'hold' | 'toggle';
  error?: string | null;
}

export default function PttBanner({ active, keyLabel, mode, error }: Props) {
  const { t } = useTranslation();
  if (error) {
    return <View style={[styles.bar, styles.errorBar]} testID="ptt-error"><Text style={styles.errorText}>{t(error)}</Text></View>;
  }
  if (!active) return null;
  return (
    <View style={styles.bar} testID="ptt-banner">
      <View style={styles.waveWrap} pointerEvents="none">
        <Waveform active={active} color={colors.onPrimary} barCount={22} height={22} />
      </View>
      <Text style={styles.text} numberOfLines={1}>
        {mode === 'hold'
          ? (keyLabel ? t('chat.pttHold', { key: keyLabel }) : t('chat.pttRecording'))
          : t('chat.pttToggle')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp3,
    marginHorizontal: spacing.sp3,
    marginBottom: spacing.sp2,
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp2,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  errorBar: { backgroundColor: colors.surfaceRaise },
  errorText: { ...typography.caption, color: colors.statusErr, flexShrink: 1, minWidth: 0 },
  waveWrap: { width: 120, opacity: 0.9 },
  text: { ...typography.bodyBold, color: colors.onPrimary, flex: 1, minWidth: 0 },
});
