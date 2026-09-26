// 상단 세그먼트 진행바 (SegmentProgressBar)
// 설계: ui-interaction-spec.md §2.1 · 화면 10
// "다음 결과로 넘어갈 수 있음"을 암시하는 상단 얇은 진행바 — 하단 히스토리 바와 동일 데이터
import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { colors, spacing, typography, SegmentType, segmentMeta } from '../theme';

export interface SegmentProgressItem {
  id: string;
  type: SegmentType;
}

interface Props {
  items: SegmentProgressItem[];
  currentIndex: number;
}

export default function SegmentProgressBar({ items, currentIndex }: Props) {
  if (items.length <= 1) {
    // 단일 결과: 현재 세그먼트 식별색으로 채운 얇은 바
    const meta = items[0]
      ? segmentMeta(items[0].type)
      : { color: colors.border };
    return (
      <View style={styles.container}>
        <View style={[styles.segment, { backgroundColor: meta.color }]} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {items.map((item, i) => {
        const meta = segmentMeta(item.type);
        const isCurrent = i === currentIndex;
        const isPast = i < currentIndex;
        return (
          <View key={item.id} style={styles.segmentWrap}>
            <View
              style={[
                styles.segment,
                {
                  backgroundColor: isPast
                    ? withAlpha(meta.color, 0.55)
                    : isCurrent
                    ? meta.color
                    : colors.border,
                },
              ]}
            />
            {isCurrent && (
              <Text style={styles.currentLabel}>{meta.label}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp2,
    gap: 4,
    alignItems: 'center',
  },
  segmentWrap: {
    flex: 1,
    alignItems: 'center',
  },
  segment: {
    height: 3,
    borderRadius: 2,
    width: '100%',
  },
  currentLabel: {
    ...typography.microSm,
    marginTop: 4,
    color: colors.text2,
  },
});