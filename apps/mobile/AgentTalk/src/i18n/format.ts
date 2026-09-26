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
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale)).format(value);
}
export function formatRelative(date: Date, locale: string, now = new Date()): string {
  const seconds = (date.getTime() - now.getTime()) / 1000;
  const unit = Math.abs(seconds) >= 86400 ? 'day' : Math.abs(seconds) >= 3600 ? 'hour' : 'minute';
  const divisor = unit === 'day' ? 86400 : unit === 'hour' ? 3600 : 60;
  return new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto' }).format(Math.round(seconds / divisor), unit);
}
