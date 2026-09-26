// chart 카드 순수 로직 — Wave 1 #2 (victory-native 데이터 정규화)
// payload 방어적 검증 + 시리즈 on/off 토글 + 표 전환용 행 변환. UI는 이 함수들만 tüket한다.
import { isRecord } from './chatLogic';
import type { StructuredPayload } from '../types';

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter';
export const CHART_TYPES: readonly ChartType[] = ['bar', 'line', 'pie', 'scatter'];

export interface ChartSeries { name: string; color?: string; data: { x: string | number; y: number }[] }
export interface ChartSpec {
  chartType: ChartType;
  series: ChartSeries[];
  labels: string[];
  unit: string;
  title: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** 파레트 — 시리즈 미지정 시 순환 (시각화 식별색 계열, design tokens와 무관한 차트 전용 상수) */
export const CHART_PALETTE = ['#00A86B', '#7C5CE0', '#0891B2', '#E8912D', '#F43F5E', '#16A34A', '#5B8CFF'];

/** 서버 JSONB → ChartSpec. 데이터 1점 이상 + 라벨/시리즈 정합. 실패 시 null(FallbackCard). */
export function parseChartSpec(payload: StructuredPayload | undefined): ChartSpec | null {
  if (!payload) return null;
  const chartType = CHART_TYPES.includes(payload.chart_type as ChartType) ? (payload.chart_type as ChartType) : null;
  const rawSeries = Array.isArray(payload.series) ? payload.series.filter(isRecord) : [];
  const labels = Array.isArray(payload.labels) ? payload.labels.map(str).filter((l) => l !== '') : [];
  if (!chartType || !rawSeries.length) return null;
  const series: ChartSeries[] = [];
  for (const item of rawSeries) {
    const name = str(item.name) || `series-${series.length + 1}`;
    const data: { x: string | number; y: number }[] = [];
    const values = Array.isArray(item.data) ? item.data : [];
    for (let i = 0; i < values.length; i++) {
      const y = num(values[i]);
      if (y === null) continue;
      data.push({ x: labels[i] ?? i, y });
    }
    if (data.length) series.push({ name, color: str(item.color) || undefined, data });
  }
  if (!series.length) return null;
  return { chartType, series, labels, unit: str(payload.unit), title: str(payload.title) };
}

/** 시리즈 가시성 토글 — 비활성화된 이름 집합 반환. 전부 꺼지려 하면 그 시리즈는 유지(빈 차트 방지). */
export function toggleSeriesHidden(hidden: string[], name: string): string[] {
  return hidden.includes(name) ? hidden.filter((h) => h !== name) : [...hidden, name];
}

/** "표로 보기" 전환 — 라벨 × 시리즈 행 변환 (spreadsheet payload 규격과 동일 형태). */
export function chartToTableRows(spec: ChartSpec, hidden: string[]): { columns: string[]; rows: (string | number)[][] } {
  const visible = spec.series.filter((s) => !hidden.includes(s.name));
  const labelCount = Math.max(0, ...visible.map((s) => s.data.length));
  const columns = [spec.labels.length ? (spec.chartType === 'scatter' ? 'x' : 'label') : 'index', ...visible.map((s) => s.name)];
  const rows: (string | number)[][] = [];
  for (let i = 0; i < labelCount; i++) {
    const row: (string | number)[] = [spec.labels[i] ?? i];
    for (const s of visible) row.push(s.data[i]?.y ?? '');
    rows.push(row);
  }
  return { columns, rows };
}

/** 툴팁/축 값 포맷 — unit 접미사 + 천단위 콤마 (localed는 호출부 i18n 포매터 주입). */
export function formatChartValue(y: number, unit: string, thousands: (n: number) => string): string {
  const text = thousands(y);
  return unit ? `${text}${unit}` : text;
}

/** mini preview — 접힘 상태용 요약 텍스트 (첫 시리즈 이름 + N점) */
export function chartSummary(spec: ChartSpec): string {
  const total = spec.series.reduce((sum, s) => sum + s.data.length, 0);
  return `${spec.series.map((s) => s.name).join(', ')} · ${total}`;
}
