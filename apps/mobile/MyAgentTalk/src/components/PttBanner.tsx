// PTT 입력 배너 — 녹음 중 화면 하단 고정 상태 표시 (확정 ④: 웨이브폼 + 말하세요).
// PC: 키 라벨(V) 힌트도 노출. 모바일 웹: 홀드 힌트. 네이티브는 이 컴포넌트를 쓰지 않는다.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import Waveform from './Waveform';
import { MicIcon } from './Icon';
import { colors, iconSize, radii, spacing, typography } from '../theme';

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

/** 입력창 옆 홀드 마이크 버튼 (모바일 웹 PTT + PC 마우스 겸용 — 클릭 홀드 동일 동작)
 *  t_64af90b0 #2/#4: 🎤 이모지 + '길게 눌러 말하기' 장문 라벨 → SVG 마이크 아이콘 버튼.
 *  홀드 동작 안내는 accessibilityLabel과 PTT 배너가 담당 (입력창 폭 확보 → placeholder 전체 표시). */
export function PttMicButton({ active, onPressIn, onPressOut, onCancelLong, label }: {
  active: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
  onCancelLong?: () => void;
  label: string;
}) {
  return (
    <View style={styles.micWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="ptt-mic-button"
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onLongPress={onCancelLong}
        style={[styles.micButton, active && styles.micActive]}
      >
        <MicIcon size={iconSize.glyphLg} color={active ? colors.onPrimary : colors.text2} />
      </Pressable>
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
  micWrap: { alignSelf: 'center' },
  micButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  micActive: { backgroundColor: colors.accent, borderColor: colors.accent },
});
