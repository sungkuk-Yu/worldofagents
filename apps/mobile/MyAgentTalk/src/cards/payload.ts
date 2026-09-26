import { isRecord } from '../lib/chatLogic';
export const displayValue = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
export const records = (value: unknown) => Array.isArray(value) ? value.filter(isRecord) : [];
export const safeFileUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : undefined; }
  catch { return undefined; }
};
