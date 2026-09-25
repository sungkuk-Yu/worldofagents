// 다이얼로그 컴포넌트: 데이터 조작형 (SpreadsheetView) — 세그먼트: 데이터
// 설계: agenttalk-modern-ux-plan.md §3.1-B · dialogue-functionality-spec.md §3.2
// 엑셀형 편집 가능한 스프레드시트 뷰 — "노션이 아니라 엑셀" 원칙
import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { colors, radii, spacing } from '../../theme';

// 목업 데이터
const MOCK_COLUMNS = ['항목', '1월', '2월', '3월', '합계'];
const MOCK_ROWS = [
  ['매출', '120', '135', '142', '397'],
  ['비용', '82', '79', '85', '246'],
  ['영업이익', '38', '56', '57', '151'],
];

const SEG = colors.segData;

export default function SpreadsheetView() {
  return (
    <View style={styles.container}>
      <View style={styles.cardHeader}>
        <View style={[styles.segIcon, { backgroundColor: withAlpha(SEG, 0.16) }]}>
          <Text style={[styles.segIconText, { color: SEG }]}>▦</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardType}>데이터 · 스프레드시트</Text>
          <Text style={styles.cardTitle}>분기 매출 분석</Text>
        </View>
      </View>

      <Text style={styles.description}>
        셀을 탭해 편집하세요. 말로도 수정할 수 있습니다:{"\n"}“3행 매출 500만으로 바꿔줘”
      </Text>

      {/* 스프레드시트 목업 */}
      <View style={styles.spreadsheetContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {/* 헤더 행 */}
            <View style={styles.headerRow}>
              {MOCK_COLUMNS.map((col) => (
                <View key={col} style={[styles.cell, styles.headerCell]}>
                  <Text style={styles.headerText}>{col}</Text>
                </View>
              ))}
            </View>

            {/* 데이터 행 */}
            {MOCK_ROWS.map((row, ri) => (
              <View key={ri} style={[styles.dataRow, ri === MOCK_ROWS.length - 1 && styles.totalRow]}>
                {row.map((val, ci) => (
                  <View
                    key={`${ri}-${ci}`}
                    style={[
                      styles.cell,
                      ci === 0 && styles.rowHeaderCell,
                      ci === row.length - 1 && { backgroundColor: withAlpha(SEG, 0.10) },
                    ]}
                  >
                    <Text
                      style={[
                        styles.cellText,
                        ci === 0 && styles.rowHeaderText,
                        ci === row.length - 1 && { color: SEG, fontWeight: '700' },
                      ]}
                    >
                      {val}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* AI 인사이트 한 줄 */}
      <View style={[styles.insightBar, { borderLeftColor: SEG }]}>
        <Text style={styles.insightLabel}>AI 인사이트</Text>
        <Text style={styles.insightText}>3월 매출이 전월 대비 5.2% 상승했습니다. 영업이익률 40.1%.</Text>
      </View>

      {/* 도구 모음 */}
      <View style={styles.toolbar}>
        {['정렬', '필터', '차트', '수식', '내보내기'].map((tool) => (
          <TouchableOpacity key={tool} style={styles.toolButton}>
            <Text style={styles.toolText}>{tool}</Text>
          </TouchableOpacity>
        ))}
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
    fontSize: 22,
    fontWeight: '700',
    color: colors.text1,
  },
  description: {
    fontSize: 13,
    color: colors.text2,
    lineHeight: 19,
    marginBottom: spacing.sp4,
  },
  spreadsheetContainer: {
    backgroundColor: colors.surfaceRaise,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sp3,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceHover,
  },
  dataRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalRow: {
    backgroundColor: colors.surface,
  },
  cell: {
    width: 76,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sp2,
  },
  headerCell: {
    backgroundColor: colors.surfaceHover,
  },
  rowHeaderCell: {
    width: 60,
    backgroundColor: colors.surfaceRaise,
    alignItems: 'flex-start',
    paddingLeft: spacing.sp3,
  },
  headerText: {
    fontSize: 12,
    color: colors.text2,
    fontWeight: '700',
  },
  rowHeaderText: {
    fontSize: 12,
    color: colors.text2,
    fontWeight: '600',
  },
  cellText: {
    fontSize: 13,
    color: colors.text1,
  },
  insightBar: {
    backgroundColor: colors.surfaceRaise,
    borderLeftWidth: 3,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp3,
    marginBottom: spacing.sp4,
  },
  insightLabel: {
    fontSize: 10,
    color: SEG,
    fontWeight: '700',
    marginBottom: 2,
  },
  insightText: {
    fontSize: 12,
    color: colors.text2,
    lineHeight: 17,
  },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.sp2,
    flexWrap: 'wrap',
  },
  toolButton: {
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  toolText: {
    fontSize: 12,
    color: colors.text2,
    fontWeight: '500',
  },
});