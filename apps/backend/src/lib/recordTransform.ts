/**
 * 대화 → 기록 변환 (마이그레이션 004, t_3b38c9be)
 * — 메시지 행을 옵시디언식 마크다운 노트 / 칸반 카드로 변환하는 순수 함수 모음.
 * LLM 없이 결정론적으로 동작하며(단위테스트 가능), from-message 라우트에서 사용한다.
 */
import { MessagesRow, SessionsRow } from '../types/db';

export interface MessageContext {
  message: MessagesRow;
  session: SessionsRow;
  /** 발화자 표시 이름 (user → 사용자, agent → 에이전트명). 라우트에서 조회해 전달. */
  agentName?: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  user: '사용자',
  agent: '에이전트',
  system: '시스템',
};

/** ISO 날짜를 'YYYY-MM-DD HH:mm' 형태로 간단 포맷 (타임존은 UTC 기준 표시). */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 폴더 경로를 정규화한다 — 항상 '/'로 시작, 끝 '/' 제거(루트 제외), 빈 세그먼트 정리. */
export function normalizeFolder(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '/';
  let path = raw.trim().replace(/\\/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
}

/**
 * 메시지를 옵시디언식 마크다운 노트로 변환.
 * 원문 content를 보존하고 상단에 메타(발화자/날짜/dialogue_type) 헤더를 붙인다.
 * title 미지정 시 content 첫 줄(또는 대화 요약)에서 파생.
 */
export function messageToNote(
  ctx: MessageContext,
  overrides?: { title?: string; folder?: string; tags?: string[] }
): { title: string; content: string; folder: string; tags: string[] } {
  const { message, session } = ctx;
  const roleLabel = ROLE_LABEL[message.role] || message.role;
  const speaker = message.role === 'agent' && ctx.agentName ? `${roleLabel} · ${ctx.agentName}` : roleLabel;
  const when = formatDate(message.created_at);
  const dialogue = message.dialogue_type || 'text';

  const body = message.content ?? '';
  const derivedTitle =
    overrides?.title?.trim() ||
    body.split(/\r?\n/).find(line => line.trim().length > 0)?.trim().replace(/^[#>\-*\s]+/, '').slice(0, 60) ||
    `대화 노트 ${when}`;

  const front = [
    '---',
    `source: 대화에서 저장`,
    `speaker: ${speaker}`,
    `date: ${when}`,
    `dialogue_type: ${dialogue}`,
    `session_id: ${session.id}`,
    `message_id: ${message.id}`,
    '---',
    '',
  ].join('\n');

  const content = `${front}${body}`;
  const folder = normalizeFolder(overrides?.folder ?? '/대화');
  const tags = Array.from(new Set(['대화저장', ...(overrides?.tags ?? [])]));
  return { title: derivedTitle, content, folder, tags };
}

/**
 * 메시지를 칸반 카드로 변환 — 제목(첫 줄 요약) + 본문(원문) + 라벨.
 * LLM 요약은 후속(선행 아님): 지금은 규칙 기반으로 제목을 파생한다.
 */
export function messageToCard(
  ctx: MessageContext,
  overrides?: { title?: string; body?: string; status?: string; assignee?: string | null; labels?: string[]; priority?: number }
): { title: string; body: string; status: string; priority: number; assignee: string | null; labels: string[] } {
  const { message } = ctx;
  const raw = overrides?.body ?? message.content ?? '';
  const derivedTitle =
    overrides?.title?.trim() ||
    raw.split(/\r?\n/).find(line => line.trim().length > 0)?.trim().replace(/^[#>\-*\s]+/, '').replace(/^\[[ xX]\]\s*/, '').slice(0, 60) ||
    '대화에서 생성한 카드';
  const dialogue = message.dialogue_type || 'text';
  const labels = Array.from(new Set(['from-message', dialogue, ...(overrides?.labels ?? [])]));
  const status = overrides?.status && ['todo', 'doing', 'review', 'done'].includes(overrides.status) ? overrides.status : 'todo';
  return {
    title: derivedTitle,
    body: raw,
    status,
    priority: typeof overrides?.priority === 'number' ? overrides.priority : 0,
    assignee: overrides?.assignee ?? null,
    labels,
  };
}
