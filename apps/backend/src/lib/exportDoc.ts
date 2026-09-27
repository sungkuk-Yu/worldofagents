// 카드 내보내기 문서 모델 (t_3116c5bc) — messages 행 → 블록 스트림 정규화.
// 순수 함수 모듈: fastify/DB 의존 없음 → 단위테스트 가능. 프론트 cards/preview.ts의 요약 규칙과
// 동일 좌표계(정보=라벨:값, 스프레드시트=표, 태스크=체크리스트, 멀티에이전트=발화 나열).
// 법률 메타(ai_generated 등)는 원본 필드 보존 — 내보내기에서도 삭제 금지.
import { MessagesRow } from '../types/db';

export type ExportBlock =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'code'; text: string };

export interface ExportMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  author: string;            // agent면 '에이전트', user면 '사용자' (라벨은 포맷터가 로케일로 치환)
  aiGenerated: boolean;
  time: string;              // ISO (created_at)
  dialogueType: string;
  blocks: ExportBlock[];
}

export interface ExportDocument {
  title: string;
  sessionId: string;
  exportedAt: string;
  messageCount: number;
  /** 즐겨찾기 필터 적용 여부 — 파일 메타/ 헤더 문구용 */
  favoritesOnly: boolean;
  messages: ExportMessage[];
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
const rec = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 셀 값: 문자열화 후 개행/탭은 공백으로 — 표·CSV 구조 보존. */
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    // 행 요소가 {키:값} 객체(스프레드시트 rows)일 수 있다 — displayValue 규칙과 동일하게 스칼라만.
    const r = rec(v);
    if (r) return Object.values(r).map(str).filter(Boolean).join(' · ');
    return '';
  }
  return str(v).replace(/[\r\n\t]+/g, ' ');
};

export function payloadOf(row: MessagesRow): Record<string, unknown> {
  return rec(row.structured_payload) ?? {};
}

/** dialogue_type별 본문 블록 생성 — 알 수 없는 유형은 content + JSON 요약 폴백(#51 유연성 좌표). */
export function blocksFor(row: MessagesRow): ExportBlock[] {
  const payload = payloadOf(row);
  const content = (row.content ?? '').trim();
  const title = str(payload.title) || str(payload.name);
  const out: ExportBlock[] = [];
  if (title) out.push({ kind: 'heading', level: 2, text: title });

  const pushContent = () => { if (content) out.push({ kind: 'paragraph', text: content }); };

  switch (String(row.dialogue_type ?? 'text')) {
    case 'spreadsheet': {
      const columns = arr(payload.columns).map((c) => {
        const r = rec(c);
        return str(r?.title ?? r?.label ?? r?.key) || str(c) || '';
      });
      const rows = arr(payload.rows).map((r) => {
        if (Array.isArray(r)) return columns.map((_, i) => cell(r[i]));
        const o = rec(r);
        return o ? columns.map((_, i) => cell(arr(Object.values(o))[i])) : [cell(r)];
      });
      if (columns.length && rows.length) out.push({ kind: 'table', columns, rows });
      else pushContent();
      break;
    }
    case 'info_card': {
      const fields = arr(payload.fields).map(rec).filter(Boolean) as Record<string, unknown>[];
      if (fields.length) out.push({ kind: 'list', items: fields.map((f) => [str(f.label ?? f.name), str(f.value)].filter(Boolean).join(': ')) });
      else pushContent();
      break;
    }
    case 'task_flow': {
      const items = arr(payload.items).map(rec).filter(Boolean) as Record<string, unknown>[];
      if (items.length) out.push({ kind: 'list', items: items.map((it) => `[${it.status === 'completed' || it.status === 'done' ? 'x' : ' '}] ${str(it.title)}`) });
      else pushContent();
      break;
    }
    case 'multi_agent': {
      const agents = arr(payload.agents).map(rec).filter(Boolean) as Record<string, unknown>[];
      if (agents.length) out.push({ kind: 'list', items: agents.map((a) => [str(a.name), str(a.content ?? a.result)].filter(Boolean).join(': ')) });
      else pushContent();
      break;
    }
    case 'form': {
      pushContent();
      const fields = arr(payload.fields).map(rec).filter(Boolean) as Record<string, unknown>[];
      if (fields.length) out.push({ kind: 'list', items: fields.map((f) => `${str(f.label ?? f.id)}${f.required ? ' *' : ''}`) });
      break;
    }
    case 'chart': {
      const labels = arr(payload.labels).map(cell);
      const series = arr(payload.series).map(rec).filter(Boolean) as Record<string, unknown>[];
      if (labels.length && series.length) {
        out.push({ kind: 'table', columns: ['', ...labels], rows: series.map((s) => [str(s.name), ...arr(s.data).map(cell)]) });
      } else pushContent();
      break;
    }
    case 'file': {
      const meta = [str(payload.mime_type), str(payload.size) ? `${payload.size}B` : ''].filter(Boolean).join(' · ');
      out.push({ kind: 'paragraph', text: [str(payload.name ?? payload.url ?? row.content), meta].filter(Boolean).join(' — ') });
      break;
    }
    case 'media': {
      pushContent();
      const url = str(payload.url);
      if (url) out.push({ kind: 'paragraph', text: url });
      break;
    }
    case 'photo_edit': {
      pushContent();
      // 편집 지시 요약 — crop/annotation 수치를 텍스트로 (원본 이미지 바이트는 담지 않는다)
      const p = rec(payload);
      if (p) {
        const bits: string[] = [];
        if (p.crop) bits.push(`crop ${JSON.stringify(p.crop)}`);
        if (Array.isArray(p.annotations) && p.annotations.length) bits.push(`annotations ${p.annotations.length}`);
        if (bits.length) out.push({ kind: 'paragraph', text: bits.join(' · ') });
      }
      break;
    }
    case 'text':
    default: {
      pushContent();
      if (row.dialogue_type && out.length === 0) out.push({ kind: 'paragraph', text: content });
      break;
    }
  }
  return out;
}

export function normalizeMessages(rows: MessagesRow[]): ExportMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    author: row.role === 'agent' ? 'agent' : row.role === 'user' ? 'user' : 'system',
    aiGenerated: row.ai_generated === true || (row.role === 'agent' && row.source_neuron != null) || row.ai_generated == null && row.role === 'agent',
    time: row.created_at ?? '',
    dialogueType: String(row.dialogue_type ?? 'text'),
    blocks: blocksFor(row),
  }));
}

export function buildExportDocument(opts: {
  rows: MessagesRow[];
  sessionId: string;
  title: string;
  favoritesOnly: boolean;
  exportedAt?: string;
}): ExportDocument {
  const messages = normalizeMessages(opts.rows);
  return {
    title: opts.title,
    sessionId: opts.sessionId,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    messageCount: messages.length,
    favoritesOnly: opts.favoritesOnly,
    messages,
  };
}
