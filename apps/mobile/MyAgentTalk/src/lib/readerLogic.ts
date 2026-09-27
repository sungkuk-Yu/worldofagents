// 리더 모드 + 펼침 기본화 순수 로직 (t_3116c5bc) — UI 의존 없음, 단위테스트 대상.
// 대표님 9/28深夜 좌표: "카드는 기본 펼침, 1 화면(약 1200px) 초과만 '더 보기'. 긴 카드는 전체 읽기 리더."
// 리더 타이포 = 블로그 가독성 원칙: 행 길이 38~42자, 행간 1.6, 어절 유지(keep-all), 숫자+단위 비브레이크.

import type { ChatMessage } from '../types';

/** 펼침 기본 판정 기준선 — 대표님 명시 '약 1200px'. */
export const ONE_SCREEN_PX = 1200;
/** 리더 본문 행 길이 ~40자(한글 16px ≈ 640px) — 그 이상은 눈이 줄을 잃는다. */
export const READER_MAX_WIDTH = 640;
export const READER_BODY_FONT = 16;
export const READER_LINE_HEIGHT = Math.round(READER_BODY_FONT * 1.6); // 26

/**
 * 실측 전 길이 추정(가드) — 측정 가능한 카드가 '길다'고 확정되면 첫 프레임부터 접힌다.
 * false negative는 1프레임 후 실측이 교정(저비용), false positive는 내용이 가려지므로 보수적으로.
 */
export function guessLong(message: ChatMessage): boolean {
  const content = message.content ?? '';
  // 모바일 390px 기준 1200px ≈ 50행 ≈ 한글 1000자 — 그 아래 추정은 실측이 교정한다(첫 프레임 펼침→측정).
  if (content.replace(/\s+/g, '').length > 950) return true;
  const p = message.payload;
  if (!p || typeof p !== 'object') return false;
  const size = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const tableish = size(p.rows) + size(p.items) + size(p.fields) + size(p.agents) + size(p.labels);
  return tableish >= 30;
}

const UNITS = '%|만원|억|달러|엔|시간|분|초|일|주|개월|년|개|명|회|배|권|통|곳|살|번|등|kg|g|km|m|px|MB|GB|KB|bps|원';
/** "1200 만원" → "1200\u00A0만원" — 숫자와 단위가 줄 끝에 갈라지지 않는다 (비브레이크 NBSP). */
export function joinNumericUnits(text: string): string {
  return text.replace(new RegExp(`(\\d)[ \\t]+(${UNITS})`, 'g'), '$1\u00A0$2')
    .replace(new RegExp(`(\\d)[ ]+(~|〜)[ ]+(\\d)`, 'g'), '$1 $2 $3');
}

/** 펼침 3상태 해석 — 사용자 선택 우선, 없으면 auto(실측>기준선이면 접힘). */
export function resolveExpanded(choice: boolean | undefined, height: number, guessed: boolean, threshold = ONE_SCREEN_PX): boolean {
  if (choice !== undefined) return choice;
  const long = height > 0 ? height > threshold : guessed;
  return !long;
}

// ── 리더 본문 재흐름(리플로우) ─────────────────────────────
// 표·목록형 payload를 '사람이 잘 읽을 수 있는' 블록 스트림으로 푼다 (전체 읽기 전용).
// 백엔드 exportDoc.ts의 블록 규칙과 동일 좌표 — 한쪽만 바꾸면 내보내기/리더가 어긋난다.
export type ReaderBlock =
  | { kind: 'para'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'list'; items: { text: string; done?: boolean }[] };

const disp = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const recs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);

export function buildReaderBlocks(message: ChatMessage): ReaderBlock[] {
  const out: ReaderBlock[] = [];
  const p = message.payload ?? {};
  const content = (message.content ?? '').trim();
  const pushContent = () => { for (const para of content.split(/\n{2,}/)) { const s = para.trim(); if (s) out.push({ kind: 'para', text: s }); } };
  const colName = (c: unknown): string => {
    if (typeof c === 'string' || typeof c === 'number') return disp(c);
    const r = c as Record<string, unknown>;
    return disp(r?.title ?? r?.label ?? r?.key) || disp(Object.values(r ?? {})[0]);
  };
  switch (message.dialogueType ?? 'text') {
    case 'spreadsheet': {
      const head = Array.isArray(p.columns) ? p.columns.map(colName).filter(Boolean) : [];
      const rows = (Array.isArray(p.rows) ? p.rows : []).map((row: unknown) =>
        (Array.isArray(row) ? row : typeof row === 'object' && row ? Object.values(row) : [row]).map(disp));
      if (rows.length) out.push({ kind: 'table', head, rows });
      pushContent();
      break;
    }
    case 'chart': {
      const labels = Array.isArray(p.labels) ? p.labels.map(disp) : [];
      const series = recs(p.series);
      const rows = labels.map((label, i) => [label || `#${i + 1}`, ...series.map((s) => disp(Array.isArray(s.data) ? s.data[i] : ''))]);
      out.push({ kind: 'table', head: [disp(p.x_label) || '', ...series.map((s) => disp(s.name))].map((x) => x || undefined).filter((x): x is string => !!x), rows });
      pushContent();
      break;
    }
    case 'info_card': {
      const fields = recs(p.fields);
      if (fields.length) out.push({ kind: 'list', items: fields.map((f) => ({ text: `${disp(f.label ?? f.name)}: ${disp(f.value)}` })) });
      pushContent();
      break;
    }
    case 'task_flow': {
      const items = recs(p.items);
      if (items.length) out.push({ kind: 'list', items: items.map((it) => ({ text: disp(it.title ?? it.text), done: it.status === 'completed' || it.status === 'done' })) });
      pushContent();
      break;
    }
    case 'multi_agent': {
      const agents = recs(p.agents);
      for (const a of agents) { const name = disp(a.name); const text = disp(a.content ?? a.result); if (name || text) out.push({ kind: 'para', text: name ? `${name} — ${text}` : text }); }
      pushContent();
      break;
    }
    default:
      pushContent();
  }
  if (!out.length && content) out.push({ kind: 'para', text: content });
  return out;
}
