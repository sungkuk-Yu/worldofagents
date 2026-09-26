// 세그먼트 히스토리 바 (SegmentHistoryBar)
// 설계: agenttalk-figma/SPEC.md §5 · dialogue-functionality-spec.md §4.4
// 결과 캔버스 하단 고정 레일 — 대화 세그먼트(컴포넌트 스택)를 연결 레일로 시각화
//  탭=복원 / 롱프레스=삭제 / 좌우 스와이프=페이징 / 10개 초과 시 +N 접기
import React, { useRef, useState, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  PanResponder,
  TouchableOpacity,
  ScrollView,
  GestureResponderEvent,
  PanResponderGestureState,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography, iconSize, segmentMeta } from '../theme';
import type { SegmentHistoryEntry } from '../types';

export type { SegmentHistoryEntry };

interface Props {
  history: SegmentHistoryEntry[];
  currentIndex: number;        // 현재 복원된 세그먼트 인덱스
  onSelect: (index: number) => void;   // 탭 → 복원
  onRemove: (index: number) => void;   // 롱프레스 → 삭제
  onSwipe: (direction: 'prev' | 'next') => void; // 좌/우 스와이프 페이징
}

const SWIPE_THRESHOLD = 50;
const MAX_VISIBLE = 10;

export default function SegmentHistoryBar({
  history,
  currentIndex,
  onSelect,
  onRemove,
  onSwipe,
}: Props) {
  const { t } = useTranslation();
  const [longPressed, setLongPressed] = useState(false);
  const deleteCountdown = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // 롱프레스 삭제 모드: 700ms 유지 시 삭제 실행
  const startLongPress = (index: number) => {
    setLongPressed(true);
    deleteCountdown.current = setTimeout(() => {
      onRemove(index);
      setLongPressed(false);
      deleteCountdown.current = null;
    }, 700);
  };
  const cancelLongPress = () => {
    if (deleteCountdown.current) {
      clearTimeout(deleteCountdown.current);
      deleteCountdown.current = null;
    }
    setLongPressed(false);
  };

  // 좌/우 스와이프 페이징
  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_e: GestureResponderEvent, gs: PanResponderGestureState) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 && Math.abs(gs.dx) > 12,
      onPanResponderRelease: (_e, gs) => {
        if (gs.dx <= -SWIPE_THRESHOLD) onSwipe('next');
        else if (gs.dx >= SWIPE_THRESHOLD) onSwipe('prev');
      },
    }),
    [onSwipe]
  );

  if (history.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t('segment.empty')}</Text>
      </View>
    );
  }

  const showOverflow = history.length > MAX_VISIBLE;
  const visible = showOverflow ? history.slice(history.length - MAX_VISIBLE) : history;
  const visibleOffset = history.length - visible.length;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {visible.map((entry, i) => {
          const meta = segmentMeta(entry.type);
          const displayLabel = entry.label ?? t(`segment.type.${entry.type}`);
          const absoluteIndex = i + visibleOffset;
          const isCurrent = absoluteIndex === currentIndex;
          const isPast = absoluteIndex < currentIndex;
          const isDeleteTarget = longPressed && isCurrent;

          return (
            <React.Fragment key={entry.id}>
              {/* 연결선 (완료 구간 = 세그먼트색 55%, 미래 = border-strong) */}
              {i > 0 && (
                <View
                  style={[
                    styles.connector,
                    { backgroundColor: isPast ? withAlpha(meta.color, 0.55) : colors.borderStrong },
                  ]}
                />
              )}

              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.node}
                onPress={() => {
                  cancelLongPress();
                  if (!isCurrent) onSelect(absoluteIndex);
                }}
                onLongPress={() => (isCurrent ? startLongPress(absoluteIndex) : undefined)}
                onPressOut={cancelLongPress}
                accessibilityLabel={t('segment.a11y', { label: displayLabel, suffix: isCurrent ? t('segment.currentSuffix') : '' })}
                accessibilityRole="button"
              >
                <View
                  style={[
                    styles.iconTile,
                    isCurrent && { backgroundColor: meta.color, borderColor: meta.color },
                    isCurrent && styles.currentTileGlow,
                    !isCurrent && { borderColor: colors.borderStrong },
                  ]}
                >
                  <Text
                    style={[
                      styles.iconText,
                      { color: isCurrent ? colors.onPrimary : meta.color },
                    ]}
                  >
                    {meta.icon}
                  </Text>
                </View>

                {/* 뉴 닷 (신규 세그먼트) */}
                {entry.isNew && !isCurrent && <View style={styles.newDot} />}

                {/* 롱프레스 삭제 배지 */}
                {isDeleteTarget && (
                  <View style={styles.deleteBadge}>
                    <Text style={styles.deleteBadgeText}>× {t('segment.delete')}</Text>
                  </View>
                )}

                <Text
                  numberOfLines={1}
                  style={[styles.label, isCurrent ? styles.labelCurrent : styles.labelPast]}
                >
                  {displayLabel}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          );
        })}

        {/* 오버플로우 +N 노드 */}
        {showOverflow && (
          <>
            <View style={[styles.connector, { backgroundColor: colors.borderStrong }]} />
            <TouchableOpacity style={styles.node} onPress={() => onSelect(history.length - 1)}>
              <View style={[styles.iconTile, styles.overflowTile]}>
                <Text style={styles.overflowText}>+{history.length - MAX_VISIBLE}</Text>
              </View>
              <Text style={styles.labelPast}>{t('segment.past')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// 헥스 알파 처리 (연결선 55% 완료 표현)
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sp2,
  },
  emptyContainer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sp4,
    paddingHorizontal: spacing.sp4,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.caption,
    color: colors.text3,
  },
  scrollContent: {
    paddingHorizontal: spacing.sp4,
    alignItems: 'flex-end',
  },
  connector: {
    width: 12,
    height: 1.5,
    marginBottom: 18,
  },
  node: {
    alignItems: 'center',
    marginRight: 12,
    width: 48,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentTileGlow: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  iconText: {
    ...typography.subhead,
    fontSize: iconSize.tileSm,
    fontWeight: '600',
  },
  newDot: {
    position: 'absolute',
    top: -2,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.segInfo,
  },
  deleteBadge: {
    position: 'absolute',
    top: -6,
    right: 4,
    backgroundColor: colors.statusErr,
    borderRadius: radii.xs,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  deleteBadgeText: {
    ...typography.microXs,
    color: '#fff',
  },
  label: {
    ...typography.micro,
    marginTop: 4,
    maxWidth: 44,
  },
  labelCurrent: {
    color: colors.text1,
    fontWeight: '700',
  },
  labelPast: {
    color: colors.text3,
  },
  overflowTile: {
    backgroundColor: colors.surfaceRaise,
    borderColor: colors.borderStrong,
  },
  overflowText: {
    ...typography.micro,
    fontWeight: '700',
    color: colors.text2,
  },
});