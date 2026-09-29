import { resolveLanguage } from './language';
const tag = (locale: string) => resolveLanguage(locale) === 'ko' ? 'ko-KR' : 'en-US';
export function formatTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), { hour: resolveLanguage(locale) === 'ko' ? '2-digit' : 'numeric', minute: '2-digit', hour12: resolveLanguage(locale) !== 'ko' }).format(date);
}
export function formatDayLabel(date: Date, locale: string, now = new Date()): string {
  if (date.toDateString() === now.toDateString()) return formatTime(date, locale);
  if (resolveLanguage(locale) === 'en') return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
  const parts = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).formatToParts(date);
  return parts.map((p) => p.type === 'month' ? `${p.value}월 ` : p.type === 'day' ? `${p.value}일 ` : '').join('') + formatTime(date, locale);
}
/** 날짜 구분선 헤더 라벨 (t_34f3e92c 백로그②, 텔레그램 기준):
 *  오늘/어제 (i18n 주입) · 6일 이내 요일(short) · 같은 해 MM.DD · 그 외 YY.MM.DD (ko),
 *  en은 Today/Yesterday/ weekday short / 'Sep 26' / 'Sep 26, 2025'. 순수 함수 — t() 미의존. */
export function formatDateSeparator(date: Date, locale: string, labels: { today: string; yesterday: string }, now = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000); // 시각 오차(서머타임) 보정 round
  if (diffDays <= 0) return labels.today;      // 오늘+미래 시계 오차_clamp
  if (diffDays === 1) return labels.yesterday;
  if (diffDays < 7) return new Intl.DateTimeFormat(tag(locale), { weekday: 'short' }).format(date);
  if (resolveLanguage(locale) === 'ko') {
    const p = new Intl.DateTimeFormat('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(date)
      .reduce((acc, x) => (x.type !== 'literal' ? { ...acc, [x.type]: x.value } : acc), {} as Record<string, string>);
    return date.getFullYear() === now.getFullYear() ? `${p.month}.${p.day}` : `${p.year}.${p.month}.${p.day}`;
  }
  return new Intl.DateTimeFormat('en-US', date.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale)).format(value);
}
export function formatRelative(date: Date, locale: string, now = new Date()): string {
  const seconds = (date.getTime() - now.getTime()) / 1000;
  const unit = Math.abs(seconds) >= 86400 ? 'day' : Math.abs(seconds) >= 3600 ? 'hour' : 'minute';
  const divisor = unit === 'day' ? 86400 : unit === 'hour' ? 3600 : 60;
  return new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto' }).format(Math.round(seconds / divisor), unit);
}
