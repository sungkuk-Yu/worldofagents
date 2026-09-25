// 다이얼로그 컴포넌트: 정보 응답형 (InfoCard) — 세그먼트: 정보
// 설계: agenttalk-modern-ux-plan.md §3.1-A · dialogue-functionality-spec.md §3.1
// 풀스크린 사각 카드 — 채팅버블 없음, 세그먼트 식별색(#4CC9F0)은 아이콘·테두리 한정
import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { colors, radii, spacing, typography } from '../../theme';

export default function InfoCard() {
  return (
    <View style={styles.container}>
      <View style={styles.cardHeader}>
        <View style={[styles.segIcon, { backgroundColor: withAlpha(colors.segInfo, 0.16) }]}>
          <Text style={[styles.segIconText, { color: colors.segInfo }]}>ⓘ</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardType}>정보 · 결과 카드</Text>
          <Text style={styles.cardTitle}>오늘 서울 날씨</Text>
        </View>
      </View>

      {/* 날씨 카드 목업 (3단 세로 레이아웃) */}
      <View style={styles.weatherHero}>
        <Text style={styles.weatherTemp}>24°C</Text>
        <Text style={styles.weatherDesc}>맑음 · 습도 40% · 미세먼지 좋음</Text>
        <View style={styles.weatherRange}>
          <Text style={styles.weatherRangeText}>최저 17°</Text>
          <View style={styles.weatherDivider} />
          <Text style={styles.weatherRangeText}>최고 26°</Text>
        </View>
      </View>

      {/* 요일별 예보 */}
      <View style={styles.forecastRow}>
        {['오늘', '내일', '모레', '금'].map((day, i) => (
          <View key={day} style={styles.forecastCell}>
            <Text style={styles.forecastDay}>{day}</Text>
            <Text style={[styles.forecastIcon, { color: i === 0 ? colors.segInfo : colors.text3 }]}>
              {i === 0 ? '☀' : i === 1 ? '⛅' : '☁'}
            </Text>
            <Text style={styles.forecastTemp}>{i === 0 ? '24°' : i === 1 ? '22°' : '20°'}</Text>
          </View>
        ))}
      </View>

      {/* 출처/신뢰도 */}
      <View style={styles.sourceRow}>
        <Text style={styles.sourceLabel}>교차검증</Text>
        <View style={styles.verifiedBadge}>
          <Text style={styles.verifiedText}>✅ 2개 모델 일치</Text>
        </View>
      </View>

      {/* 액션 */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionText}>공유</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionText}>저장</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.segInfo }]}>
          <Text style={[styles.actionText, styles.primaryActionText]}>후속 질문</Text>
        </TouchableOpacity>
      </View>
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
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sp4,
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
    fontSize: 18,
    fontWeight: '700',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardType: {
    fontSize: 11,
    color: colors.text3,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: typography.title2.fontSize,
    fontWeight: '700',
    color: colors.text1,
  },
  weatherHero: {
    backgroundColor: colors.surfaceRaise,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sp5,
    alignItems: 'center',
    marginBottom: spacing.sp4,
  },
  weatherTemp: {
    fontSize: 64,
    fontWeight: '700',
    color: colors.text1,
    lineHeight: 72,
  },
  weatherDesc: {
    fontSize: 14,
    color: colors.text2,
    marginBottom: spacing.sp4,
  },
  weatherRange: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weatherRangeText: {
    fontSize: 13,
    color: colors.text2,
    fontWeight: '500',
  },
  weatherDivider: {
    width: 1,
    height: 12,
    backgroundColor: colors.borderStrong,
    marginHorizontal: spacing.sp3,
  },
  forecastRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sp3,
    marginBottom: spacing.sp3,
  },
  forecastCell: {
    flex: 1,
    alignItems: 'center',
  },
  forecastDay: {
    fontSize: 12,
    color: colors.text3,
    fontWeight: '500',
    marginBottom: spacing.sp1,
  },
  forecastIcon: {
    fontSize: 18,
    marginBottom: spacing.sp1,
  },
  forecastTemp: {
    fontSize: 13,
    color: colors.text2,
    fontWeight: '600',
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sp1,
    marginBottom: spacing.sp4,
  },
  sourceLabel: {
    fontSize: 12,
    color: colors.text3,
  },
  verifiedBadge: {
    backgroundColor: withAlpha(colors.statusOk, 0.12),
    borderRadius: radii.full,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp1,
  },
  verifiedText: {
    fontSize: 11,
    color: colors.statusOk,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sp3,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.sp3,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  actionText: {
    fontSize: 13,
    color: colors.text1,
    fontWeight: '500',
  },
  primaryActionText: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
});