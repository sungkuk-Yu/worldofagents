// 카드 미리보기 추출 — 대표님 지시 #51 (기능형 카드 펼치기/접기 유연성)
// 순수 함수 모듈(UI 의존 없음): dialogue_type별 접힘 상태 요약을 만든다.
// 백엔드가 새 카드 타입을 추가해도 폴백(제목+요약)으로 기본 렌더 — 프론트 재배포 없이 유연성 유지.
import type { StructuredPayload } from '../types';
import { displayValue, records } from './payload';

export interface CardPreview {
  /** 미리보기 제목 (payload.title 우선, 없으면 유형 라벨 키 등 컴포넌트가 보완) */
  title: string;
  /** 한 줄 요약 */
  summary: string;
  /** 데이터 행/항목 수 — "N행 더" 배지용 (0이면 배지 생략) */
  moreCount: number;
  /** 상태 배지 텍스트 키 값 (task 등) — 없으면 빈 문자열 */
  badge: string;
  /** 펼침 핸들 표시 여부: 접었을 때 이미 전부 보이면 false (#51 규칙 4) */
  expandable: boolean;
  /** 미등록 유형 폴백 여부 — FallbackCard(제목+JSON 접기)로 렌더 */
  unknownType: boolean;
}

// 짧은 텍스트는 확장 UI 생략 기준 (한 화면에 다 보이는 길이)
export const LONG_TEXT_THRESHOLD = 140;
// 접힘 미리보기에 노출하는 테이블 행 수
export const PREVIEW_ROWS = 2;

const rowText = (row: unknown, columns: unknown[], limit = 3): string => {
  const cells = Array.isArray(row)
    ? row.slice(0, limit).map(displayValue)
    : typeof row === 'object' && row !== null
      ? columns.slice(0, limit).map((col) => displayValue((row as Record<string, unknown>)[displayValue(col)]))
      : [displayValue(row)];
  return cells.filter(Boolean).join(' · ');
};

const firstSentence = (text: string, max = 80): string => {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
};

/**
 * 미리보기 규칙 (#51 규칙 5):
 *  info → 제목 + 한 줄 요약 / data → 첫 행 + "N행 더" / file → 파일명 + 종류·크기
 *  task → 작업명 + 상태 배지 / multi-agent → 참여 에이전트 나열 / text → 장문만 펼침
 *  미등록 유형 → 제목 + 요약 폴백 (unknownType=true, JSON 접기는 FallbackCard가 담당)
 */
export function buildCardPreview(
  dialogueType: string | null | undefined,
  payload: StructuredPayload | undefined,
  content: string,
  knownType: boolean,
): CardPreview {
  const title = displayValue(payload?.title ?? payload?.name);
  const base = { title, summary: '', moreCount: 0, badge: '', expandable: false, unknownType: false };

  if (!knownType) {
    // 모르는 dialogue_type — 깨지지 않는 폴백: 제목(또는 콘텐츠 첫 줄) + JSON 접기
    const hasPayload = !!payload && Object.keys(payload).length > 0;
    return {
      ...base,
      title: title || firstSentence(content, 40),
      summary: hasPayload ? '' : firstSentence(content),
      expandable: hasPayload || content.length > LONG_TEXT_THRESHOLD,
      unknownType: true,
    };
  }

  switch (dialogueType) {
    case 'info_card': {
      const fields = records(payload?.fields);
      const first = fields[0];
      const summary = first
        ? firstSentence(`${displayValue(first.label ?? first.name)}: ${displayValue(first.value)}`)
        : firstSentence(content);
      return { ...base, title, summary, expandable: fields.length > 1 || (!fields.length && content.length > LONG_TEXT_THRESHOLD) };
    }
    case 'spreadsheet': {
      const columns = Array.isArray(payload?.columns) ? payload.columns : [];
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      if (!rows.length) return { ...base, title, summary: firstSentence(content), expandable: content.length > LONG_TEXT_THRESHOLD };
      const moreCount = Math.max(0, rows.length - PREVIEW_ROWS);
      return {
        ...base,
        title: title || columns.map((c) => displayValue(c)).filter(Boolean).join(' · '),
        summary: rows.slice(0, PREVIEW_ROWS).map((row) => rowText(row, columns)).filter(Boolean).join(' / '),
        moreCount,
        expandable: moreCount > 0 || !!title,
      };
    }
    case 'file': {
      const mime = displayValue(payload?.mime_type);
      const size = displayValue(payload?.size);
      const summary = [mime, size].filter(Boolean).join(' · ');
      return { ...base, title, summary, expandable: !!content.trim() || !!payload?.url };
    }
    case 'task_flow': {
      const items = records(payload?.items);
      const first = items[0];
      const done = items.filter((item) => item.status === 'completed' || item.status === 'done').length;
      return {
        ...base,
        title: title || (first ? displayValue(first.title) : ''),
        summary: items.length > 1 ? displayValue(first?.title) : '',
        moreCount: Math.max(0, items.length - 1),
        badge: items.length ? `${done}/${items.length}` : '',
        expandable: items.length > 1 || !!title,
      };
    }
    case 'multi_agent': {
      const agents = records(payload?.agents);
      const names = agents.map((agent) => displayValue(agent.name)).filter(Boolean);
      return {
        ...base,
        title: title || names.join(', '),
        summary: firstSentence(displayValue(agents[0]?.content ?? agents[0]?.result) || content),
        moreCount: Math.max(0, agents.length - 1),
        expandable: agents.length > 0 || content.length > LONG_TEXT_THRESHOLD,
      };
    }
    case 'text':
    default: {
      return { ...base, title, summary: firstSentence(content), expandable: content.length > LONG_TEXT_THRESHOLD };
    }
  }
}
