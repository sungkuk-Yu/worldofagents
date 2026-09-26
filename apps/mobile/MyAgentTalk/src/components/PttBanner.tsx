// PTT 입력 배너 — 녹음 중 화면 하단 고정 상태 표시 (확정 ④: 웨이브폼 + 말하세요).
// PC: 키 라벨(V) 힌트도 노출. 모바일 웹: 홀드 힌트. 네이티브는 이 컴포넌트를 쓰지 않는다.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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

/** 입력창 옆 홀드 마이크 버튼 (모바일 웹 PTT + PC 마우스 겸용 — 클릭 홀드 동일 동작) */
export function PttMicButton({ active, onPressIn, onPressOut, onCancelLong, label }: {
  active: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
  onCancelLong?: () => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.micWrap}>
      <PressableMic active={active} onPressIn={onPressIn} onPressOut={onPressOut} onCancelLong={onCancelLong} label={label} t={t} />
    </View>
  );
}

function PressableMic({ active, onPressIn, onPressOut, onCancelLong, label, t }: {
  active: boolean; onPressIn: () => void; onPressOut: () => void; onCancelLong?: () => void; label: string;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="ptt-mic-button"
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onLongPress={onCancelLong}
      style={[styles.micButton, active && styles.micActive]}
    >
      <Text style={[styles.micIcon, active && { color: colors.onPrimary }]}>🎤</Text>
      <Text style={[styles.micText, active && { color: colors.onPrimary }]} numberOfLines={1}>
        {t(active ? 'chat.pttRecording' : 'chat.pttIdle')}
      </Text>
    </Pressable>
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
  micWrap: { alignSelf: 'center' },
  micButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  micActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  micIcon: { fontSize: 18 },
  micText: { ...typography.microXs, color: colors.text3, marginTop: 1 },
});
