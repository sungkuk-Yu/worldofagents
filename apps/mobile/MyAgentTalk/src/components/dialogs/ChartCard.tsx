// chart 카드 — Wave 1 #2 (엑셀처럼 인터랙티브 그래프, Perplexity 카드 감성)
// victory-native v37(react-native-svg 기반) — 웹/모바일 동일 코드.
// 인터랙션: 탭/호버 툴팁(VictoryVoronoiContainer + VictoryTooltip), 데이터 많을 때 pinch-zoom
//   (VictoryZoomContainer via createContainer), 범례 탭 시리즈 on/off,
//   "표로 보기" 토글(chart↔데이터테이블 전환 — 엑셀 감성의 핵심).
// 숫자 포맷: unit 접미사 + 천단위 콤마 + ko/en 로케일(i18n formatNumber 연동).
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import {
  VictoryBar, VictoryChart, VictoryLine, VictoryPie, VictoryScatter, VictoryTooltip,
  VictoryVoronoiContainer, createContainer,
} from 'victory-native';
import type { CardProps } from '../../cards/types';
import { cardStyles as s } from '../../cards/styles';
import { chartToTableRows, CHART_PALETTE, ChartSpec, formatChartValue, parseChartSpec, toggleSeriesHidden } from '../../lib/chartLogic';
import { formatNumber } from '../../i18n/format';
import { colors, spacing, typography } from '../../theme';
import { useReduceMotion } from '../../lib/motion';

/** 줌 + 툴팁 조합 컨테이너 (victory-standardcontainers 패턴). */
const VictoryZoomVoronoiContainer = createContainer('zoom', 'voronoi');

function ChartTable({ spec, hidden }: { spec: ChartSpec; hidden: string[] }) {
  const { i18n } = useTranslation();
  const { columns, rows } = chartToTableRows(spec, hidden);
  return <ScrollView horizontal>
    <View>
      <View style={s.row}>{columns.map((col, i) => <Text key={i} style={[styles.cell, s.title]} numberOfLines={1}>{col}</Text>)}</View>
      {rows.map((row, i) => <View key={i} style={s.row}>{row.map((cell, j) => (
        <Text key={j} style={[styles.cell, s.body]} numberOfLines={1}>{j === 0 || cell === '' ? String(cell) : formatChartValue(Number(cell), spec.unit, (n) => formatNumber(n, i18n.language))}</Text>
      ))}</View>)}
    </View>
  </ScrollView>;
}

export default function ChartCard({ message, payload }: CardProps) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReduceMotion();
  const spec = useMemo(() => parseChartSpec(payload), [payload]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [asTable, setAsTable] = useState(false);

  if (!spec) return <Text style={s.body}>{message.content || t('cards.noContent')}</Text>;
  const visible = spec.series.filter((series) => !hidden.includes(series.name));
  const pointCount = visible.reduce((sum, series) => sum + series.data.length, 0);
  const zoomEnabled = pointCount > 24; // 데이터 많을 때만 핀치/팬 — 작은 차트에서 스크롤 충돌 방지
  const thousands = (n: number) => formatNumber(n, i18n.language);
  const colorOf = (series: { color?: string }, index: number) => series.color || CHART_PALETTE[index % CHART_PALETTE.length];
  const dataFor = (series: { data: { x: string | number; y: number }[] }, seriesIndex: number) =>
    spec.chartType === 'scatter'
      ? series.data.map((point) => ({ ...point, name: spec.series[seriesIndex].name }))
      : series.data.map((point, i) => ({ x: spec.labels[i] ?? point.x, y: point.y, name: spec.series[seriesIndex].name }));

  const elements = visible.map((series) => {
    const index = spec.series.indexOf(series);
    const fill = colorOf(series, index);
    const data = dataFor(series, index);
    const tooltip = <VictoryTooltip
      cornerRadius={4} flyoutStyle={{ fill: colors.surfaceRaise, stroke: colors.border }} flyoutPadding={6}
      style={{ fill: colors.text1, fontSize: typography.micro.fontSize as number }} />;
    switch (spec.chartType) {
      case 'pie':
        return <VictoryPie key={series.name} data={data} colorScale={CHART_PALETTE.slice(index, index + 1).concat(CHART_PALETTE.slice(0, index))}
          innerRadius={44} padAngle={2} labelRadius={58}
          style={{ labels: { fill: colors.text2, fontSize: 11 } }}
          labels={(d) => `${d.x}`} labelComponent={tooltip} />;
      case 'line':
        return <VictoryLine key={series.name} data={data} style={{ data: { stroke: fill, strokeWidth: 2 } }} />;
      case 'scatter':
        return <VictoryScatter key={series.name} data={data} size={6} style={{ data: { fill } }} labels={(d) => `${d.name}: ${formatChartValue(d.y, spec.unit, thousands)}`} labelComponent={tooltip} />;
      default: // bar
        return <VictoryBar key={series.name} data={data} style={{ data: { fill } }} barRatio={0.8} labels={(d) => `${d.name}: ${formatChartValue(d.y, spec.unit, thousands)}`} labelComponent={tooltip} />;
    }
  });

  const container = zoomEnabled
    ? <VictoryZoomVoronoiContainer labels={(d) => `${d.name}: ${formatChartValue(d.y, spec.unit, thousands)}`} zoomDimension="x" />
    : <VictoryVoronoiContainer labels={(d) => `${d.name}: ${formatChartValue(d.y, spec.unit, thousands)}`} />;

  return <View>
    <View style={styles.headRow}>
      {!!spec.title && <Text style={s.title}>{spec.title}</Text>}
      <Button compact mode="text" onPress={() => setAsTable((v) => !v)} textColor={colors.accent} testID="chart-table-toggle">
        {asTable ? t('cards.chartView') : t('cards.tableView')}
      </Button>
    </View>
    {asTable ? (
      <ChartTable spec={spec} hidden={hidden} />
    ) : (
      <View style={styles.chartWrap} testID="chart-canvas">
        {spec.chartType === 'pie'
          ? <VictoryChart height={240} animate={!reduceMotion ? { duration: 300 } : undefined} containerComponent={container}>{elements}</VictoryChart>
          : <VictoryChart height={240} animate={!reduceMotion ? { duration: 300 } : undefined} containerComponent={container}
            domainPadding={{ x: 16 }}>{elements}</VictoryChart>}
      </View>
    )}
    {/* 범례 탭 = 시리즈 on/off (여러 카드 동시 비교 패턴 — #51 규칙 6 계보) */}
    <View style={styles.legend} testID="chart-legend">
      {spec.series.map((series) => {
        const off = hidden.includes(series.name);
        return <Button key={series.name} compact mode="text" testID={`chart-legend-${series.name}`} accessibilityState={{ selected: !off }}
          onPress={() => setHidden((prev) => toggleSeriesHidden(prev, series.name))}
          textColor={off ? colors.text3 : colors.text1} style={styles.legendItem}>
          {off ? '○' : '●'} {series.name}
        </Button>;
      })}
    </View>
    <Text style={styles.hint}>{t(zoomEnabled ? 'cards.chartHintZoom' : 'cards.chartHint', { countText: thousands(pointCount) })}</Text>
  </View>;
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sp2, flexWrap: 'wrap' },
  chartWrap: { backgroundColor: colors.surface },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp1, marginTop: spacing.sp1 },
  legendItem: { paddingHorizontal: spacing.sp1 },
  cell: { minWidth: spacing.sp10 * 3, maxWidth: spacing.sp10 * 5, padding: spacing.sp2, borderBottomWidth: 1, borderColor: colors.border },
  hint: { ...typography.microSm, color: colors.text3, marginTop: spacing.sp1 },
});
