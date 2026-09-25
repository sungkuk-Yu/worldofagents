// 다이얼로그 컴포넌트: 파일 처리형 (FileViewer) — 세그먼트: 파일
// 설계: agenttalk-modern-ux-plan.md §3.1-C · dialogue-functionality-spec.md §3.3
// 파일 프리뷰 + AI 분석 패널 — 세그먼트 식별색 #FFB454
import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { colors, radii, spacing } from '../../theme';

const SEG = colors.segFile;

export default function FileViewer() {
  return (
    <View style={styles.container}>
      <View style={styles.cardHeader}>
        <View style={[styles.segIcon, { backgroundColor: withAlpha(SEG, 0.16) }]}>
          <Text style={[styles.segIconText, { color: SEG }]}>▥</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardType}>파일 · 보고서</Text>
          <Text style={styles.cardTitle}>계약서_2026.pdf</Text>
        </View>
        <Text style={styles.fileMeta}>PDF · 2.4MB · 12쪽</Text>
      </View>

      {/* 파일 프리뷰 영역 (목업) */}
      <View style={styles.previewArea}>
        <View style={[styles.fileIconWrap, { backgroundColor: withAlpha(SEG, 0.14) }]}>
          <Text style={[styles.fileIcon, { color: SEG }]}>▥</Text>
        </View>
        <Text style={styles.fileName}>계약서_2026.pdf</Text>
        <Text style={styles.filePage}>1 / 12 · 탭하여 전체화면</Text>
        <View style={styles.previewLines}>
          <View style={[styles.previewLine, { width: '90%' }]} />
          <View style={[styles.previewLine, { width: '75%' }]} />
          <View style={[styles.previewLine, { width: '85%' }]} />
        </View>
      </View>

      {/* AI 분석 패널 */}
      <View style={styles.analysisPanel}>
        <Text style={[styles.analysisTitle, { color: SEG }]}>AI 분석</Text>
        <View style={styles.analysisItem}>
          <Text style={styles.analysisLabel}>요약</Text>
          <Text style={styles.analysisValue} numberOfLines={2}>
            총 12쪽 계약서. 주요 조항: 기간 1년, 위약금 10%, 자동 갱신 조항 포함.
          </Text>
        </View>
        <View style={styles.analysisItem}>
          <Text style={styles.analysisLabel}>핵심 포인트</Text>
          <Text style={styles.analysisValue} numberOfLines={2}>
            · 3조: 정기 결제 조건 변경 가능{"\n"}· 7조: 해지 통보 30일 전
          </Text>
        </View>
      </View>

      {/* 액션 */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionText}>하이라이트</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: SEG }]}>
          <Text style={[styles.actionText, styles.primaryActionText]}>AI에게 질문</Text>
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
    marginBottom: spacing.sp3,
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
    fontSize: 20,
    fontWeight: '700',
    color: colors.text1,
  },
  fileMeta: {
    fontSize: 11,
    color: colors.text3,
    marginLeft: spacing.sp2,
  },
  previewArea: {
    backgroundColor: colors.surfaceRaise,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sp5,
    alignItems: 'center',
    marginBottom: spacing.sp3,
  },
  fileIconWrap: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sp3,
  },
  fileIcon: {
    fontSize: 26,
    fontWeight: '700',
  },
  fileName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text1,
    marginBottom: 4,
  },
  filePage: {
    fontSize: 11,
    color: colors.text3,
    marginBottom: spacing.sp4,
  },
  previewLines: {
    alignSelf: 'stretch',
    gap: 6,
    paddingHorizontal: spacing.sp3,
  },
  previewLine: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
  },
  analysisPanel: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sp4,
    marginBottom: spacing.sp4,
  },
  analysisTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: spacing.sp2,
  },
  analysisItem: {
    paddingVertical: spacing.sp2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  analysisLabel: {
    fontSize: 11,
    color: colors.text3,
    fontWeight: '600',
    marginBottom: 2,
  },
  analysisValue: {
    fontSize: 13,
    color: colors.text1,
    lineHeight: 18,
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