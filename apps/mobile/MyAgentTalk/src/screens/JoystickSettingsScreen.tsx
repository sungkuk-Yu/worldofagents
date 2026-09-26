// Screen: 조이스틱 커스터마이징 (JoystickSettingsScreen) — 카드 t_ced38e19 요구 1/2/5/6
// - 3x3 레이아웃: 8방향 슬롯(탭 → 동작 풀 시트) + 중앙(녹음 고정, 편집 불가 — 요구 5)
// - 프리셋 chips(기본/한손) + 초기화
// - 저장은 useJoystickMap → lib/userPrefs (서버 preferences.joystickMap + 낙관적 로컬 폴백)
// - 제스처 엔진/의미 분리 유지: 이 화면은 맵만 편집, 실행은 각 화면의 dispatcher.
import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Modal,
  Animated,
} from 'react-native';
import { colors, radii, spacing, typography, iconSize, webScreenMotion } from '../theme';
import { DIRECTION_ARROWS } from '../lib/gesture';
import { JoystickDirectionKey } from '../lib/joystickMapping';
import { JOYSTICK_MODES, JoystickMode } from '../lib/joystickMode';
import { useJoystickMap } from '../hooks/useJoystickMap';
import { useTranslation } from 'react-i18next';

interface Props {
  navigation: any;
}

// 3x3 배치 (row-major) — 인덱스 4 = 중앙(녹음 고정·요구 5)
const GRID: (JoystickDirectionKey | 'CENTER')[] = [
  'DIR_UPLEFT', 'DIR_UP', 'DIR_UPRIGHT',
  'DIR_LEFT', 'CENTER', 'DIR_RIGHT',
  'DIR_DOWNLEFT', 'DIR_DOWN', 'DIR_DOWNRIGHT',
];

// 모드 미리보기 카드 — 각 입력 방식의 핵심 동작을 루프 애니메이션으로 보여준다 (카드 본문 ③ '미리보기 애니메이션').
//   joystick: 원형 스틱 이 좌↔우 스냅 / pad: 지점이 플릭 궤적(←→) 순환 / hybrid: 패드 위 스틱  동시
function ModePreview({ variant, active }: { variant: JoystickMode; active: boolean }) {
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active) { anim.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0, duration: 1400, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, anim]);

  const translate = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-9, 9, -9] });
  const flickX = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-13, 13, -13] });
  const flickOpacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.25, 1, 0.25] });

  return (
    <View style={previewStyles.frame} testID={`joystick-mode-preview-${variant}`}>
      {variant !== 'joystick' && (
        <View style={previewStyles.padMini}>
          {variant === 'hybrid' && <View style={previewStyles.thumbMini} />}
          {variant === 'pad' && (
            <Animated.View style={[previewStyles.flickDot, { opacity: flickOpacity, transform: [{ translateX: flickX }] }]} />
          )}
        </View>
      )}
      {variant !== 'pad' && (
        <View style={[previewStyles.stickMini, variant === 'hybrid' && previewStyles.stickOverlay]}>
          <Animated.View style={[previewStyles.knobMini, { transform: [{ translateX: translate }] }]} />
        </View>
      )}
    </View>
  );
}

export default function JoystickSettingsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { map, preset, assign, applyPreset, mode, setMode } = useJoystickMap();
  const [picker, setPicker] = useState<JoystickDirectionKey | null>(null);

  const actionLabel = (dir: JoystickDirectionKey) =>
    map[dir] === 'none' ? t('joystick.actionNone') : t(`joystick.actions.${map[dir]}`);

  return (
    <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel={t('common.back')} onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>{t('common.backIcon')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('joystick.title')}</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* 입력 모드 — 카드 본문 ③: 3종 카드(미리보기 애니메이션) + 즉시 적용 (t_5de18a91 요구 2) */}
        <Text style={styles.sectionTitle}>{t('joystick.modeTitle')}</Text>
        <View style={styles.modeRow} testID="joystick-modes">
          {JOYSTICK_MODES.map((m) => (
            <TouchableOpacity
              key={m}
              testID={`joystick-mode-${m}`}
              style={[styles.modeCard, mode === m && styles.modeCardActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === m }}
              onPress={() => setMode(m as JoystickMode)}
            >
              <ModePreview variant={m} active={mode === m} />
              <Text style={[styles.modeChipText, mode === m && styles.modeChipTextActive]}>{t(`joystick.modes.${m}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.modeDesc}>{t(`joystick.modeDesc.${mode}`)}</Text>

        <Text style={styles.sectionTitle}>{t('joystick.dirTitle')}</Text>
        <Text style={styles.hint}>{t('joystick.hint')}</Text>

        {/* 프리셋 chips — 요구 2 */}
        <View style={styles.presetRow} testID="joystick-presets">
          <TouchableOpacity
            testID="joystick-preset-default"
            style={[styles.presetChip, preset === 'default' && styles.presetChipActive]}
            accessibilityRole="radio" accessibilityState={{ selected: preset === 'default' }}
            onPress={() => applyPreset('default')}
          >
            <Text style={[styles.presetChipText, preset === 'default' && styles.presetChipTextActive]}>{t('joystick.presetDefault')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="joystick-preset-onehand"
            style={[styles.presetChip, preset === 'onehand' && styles.presetChipActive]}
            accessibilityRole="radio" accessibilityState={{ selected: preset === 'onehand' }}
            onPress={() => applyPreset('onehand')}
          >
            <Text style={[styles.presetChipText, preset === 'onehand' && styles.presetChipTextActive]}>{t('joystick.presetOneHand')}</Text>
          </TouchableOpacity>
          {preset === 'custom' && <Text style={styles.customTag}>{t('joystick.presetCustom')}</Text>}
        </View>

        {/* 3x3 슬롯 그리드 — 중앙은 녹음 고정(요구 5): 탭 불가, 라벨만 */}
        <View style={styles.grid} testID="joystick-grid">
          {GRID.map((cell) => {
            if (cell === 'CENTER') return (
              <View key="center" style={[styles.slot, styles.slotCenter]} testID="joystick-slot-center">
                <Text style={styles.slotArrow}>●</Text>
                <Text style={styles.slotAction} numberOfLines={1}>{t('joystick.centerRecord')}</Text>
                <Text style={styles.slotLocked}>{t('joystick.lockedNote')}</Text>
              </View>
            );
            return (
              <TouchableOpacity
                key={cell}
                testID={`joystick-slot-${cell}`}
                style={styles.slot}
                accessibilityRole="button"
                accessibilityLabel={`${t(`joystick.dir.${cell}`)} — ${actionLabel(cell)}`}
                onPress={() => setPicker(cell)}
              >
                <Text style={styles.slotArrow}>{DIRECTION_ARROWS[cell]}</Text>
                <Text style={styles.slotDirName}>{t(`joystick.dir.${cell}`)}</Text>
                <Text style={[styles.slotAction, map[cell] === 'none' && styles.slotActionNone]} numberOfLines={1}>
                  {actionLabel(cell)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.saveNote} testID="joystick-save-note">{t('joystick.saveNote')}</Text>
      </ScrollView>

      {/* 동작 풀 시트 — 요구 1 */}
      <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={() => setPicker(null)}>
          <View style={styles.sheet} testID="joystick-action-sheet">
            <Text style={styles.sheetTitle}>
              {picker ? `${t(`joystick.dir.${picker}`)} → ${t('joystick.pickAction')}` : ''}
            </Text>
            {picker && (
              <ScrollView style={styles.sheetList}>
                {(['record_stop', 'continuous_record', 'yes', 'no', 'cancel', 'keyboard', 'prev_segment', 'next_segment', 'open_thread', 'favorites', 'send', 'none'] as const).map((action) => (
                  <TouchableOpacity
                    key={action}
                    testID={`joystick-action-${action}`}
                    style={[styles.sheetRow, map[picker] === action && styles.sheetRowActive]}
                    accessibilityRole="button"
                    onPress={() => { assign(picker, action); setPicker(null); }}
                  >
                    <Text style={styles.sheetRowIcon}>{action === 'none' ? '—' : { keyboard: '⌨', yes: '✓', no: '✗', cancel: '✕', record_stop: '⏹', continuous_record: '🔁', open_thread: '💬', favorites: '⭐', send: '➤', prev_segment: '‹', next_segment: '›' }[action]}</Text>
                    <Text style={[styles.sheetRowLabel, map[picker] === action && styles.sheetRowLabelActive]}>
                      {action === 'none' ? t('joystick.actionNone') : t(`joystick.actions.${action}`)}
                    </Text>
                    {map[picker] === action && <Text style={styles.sheetRowCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setPicker(null)} testID="joystick-action-cancel">
              <Text style={styles.sheetCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2 },
  headerButton: { width: 44, alignItems: 'flex-start', padding: spacing.sp2 },
  headerButtonText: { ...typography.title2, fontSize: iconSize.glyphLg, color: colors.text1 },
  headerTitle: { ...typography.headline, color: colors.text1 },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: spacing.sp4, paddingBottom: spacing.sp8 },
  sectionTitle: { ...typography.subhead, fontWeight: '700', color: colors.text1, marginTop: spacing.sp2, marginBottom: spacing.sp2 },
  modeRow: { flexDirection: 'row', gap: spacing.sp2, marginBottom: spacing.sp2 },
  modeCard: {
    flex: 1, alignItems: 'center', gap: spacing.sp2,
    paddingVertical: spacing.sp3, paddingHorizontal: spacing.sp2,
    borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  modeCardActive: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  modeChipText: { ...typography.caption, fontWeight: '600', color: colors.text2 },
  modeChipTextActive: { color: colors.accent, fontWeight: '700' },
  modeDesc: { ...typography.caption, color: colors.text3, marginBottom: spacing.sp4 },
  hint: { ...typography.caption, color: colors.text2, marginBottom: spacing.sp4 },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, marginBottom: spacing.sp5 },
  presetChip: { paddingHorizontal: spacing.sp4, paddingVertical: spacing.sp2, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  presetChipActive: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  presetChipText: { ...typography.subhead, color: colors.text2 },
  presetChipTextActive: { color: colors.accent, fontWeight: '600' },
  customTag: { ...typography.caption, color: colors.text3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp2, justifyContent: 'center' },
  slot: {
    width: '30%', minHeight: 96, backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sp2,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  slotCenter: { borderStyle: 'dashed', backgroundColor: colors.surfaceHover },
  slotArrow: { ...typography.title2, color: colors.text1 },
  slotDirName: { ...typography.micro, color: colors.text3 },
  slotAction: { ...typography.subhead, fontWeight: '600', color: colors.accent },
  slotActionNone: { color: colors.text3, fontWeight: '400' },
  slotLocked: { ...typography.micro, color: colors.text3 },
  saveNote: { ...typography.caption, color: colors.text3, textAlign: 'center', marginTop: spacing.sp5 },
  sheetScrim: { flex: 1, backgroundColor: 'rgba(16,24,40,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, padding: spacing.sp4, maxHeight: '70%' },
  sheetTitle: { ...typography.headline, color: colors.text1, marginBottom: spacing.sp3 },
  sheetList: { flexGrow: 0 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp3, paddingVertical: spacing.sp3, paddingHorizontal: spacing.sp2, borderRadius: radii.sm },
  sheetRowActive: { backgroundColor: colors.accentTint },
  sheetRowIcon: { ...typography.subhead, width: 28, textAlign: 'center', color: colors.text1 },
  sheetRowLabel: { ...typography.body, color: colors.text1, flex: 1 },
  sheetRowLabelActive: { color: colors.accent, fontWeight: '600' },
  sheetRowCheck: { color: colors.accent, fontWeight: '700' },
  sheetCancel: { marginTop: spacing.sp3, paddingVertical: spacing.sp3, alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border },
  sheetCancelText: { ...typography.body, color: colors.text2 },
});

// 미리보기 카드 전용 스타일 — 실축소(스틱 8방향 스냅/패드 플릭/하이브리드 병행) 아이콘
const previewStyles = StyleSheet.create({
  frame: { width: 76, height: 56, alignItems: 'center', justifyContent: 'center' },
  padMini: {
    position: 'absolute', width: 72, height: 52, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaise,
    alignItems: 'center', justifyContent: 'center',
  },
  flickDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  thumbMini: { width: 20, height: 20, borderRadius: 10, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.border },
  stickMini: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  stickOverlay: { position: 'absolute', backgroundColor: 'transparent', borderWidth: 0 },
  knobMini: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent },
});
