// 이어보기(크로스 디바이스 커서) 순수 로직 — 카드 t_eded715c 요구 2 / 백엔드 t_d75ca81c 계약
// GET /api/sessions/resume 항목 → 화면 DTO, 읽기 커서 클램프. 단위테스트 대상.

export interface ResumeItemRaw {
  session_id: string;
  agent_id?: string | null;
  agent_name?: string | null;
  title?: string | null;
  status?: string | null;
  last_activity_at?: string | null;
  last_read_turn_index?: number | null;
  latest_turn_index?: number | null;
  latest_message_at?: string | null;
  unread_count?: number | null;
  first_unread_turn_index?: number | null;
  live_devices?: string[] | null;
}

export interface ResumeItem extends ResumeItemRaw {
  session_id: string;
  unread: number;
  liveDevices: string[];
  recommended: boolean;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 백엔드 응답 행 방어적 정규화 — 오염 필드가 있어도 목록 렌더가 죽지 않는다 */
export function normalizeResumeItems(env: unknown): { items: ResumeItem[]; recommended: string | null; total: number } {
  const data = (env && typeof env === 'object' ? (env as { data?: unknown }).data : null) as
    { items?: unknown; recommended_session_id?: unknown; total?: unknown } | null;
  const raw = Array.isArray(data?.items) ? data!.items as ResumeItemRaw[] : [];
  const recommended = typeof data?.recommended_session_id === 'string' ? data.recommended_session_id : null;
  const items = raw
    .filter((r): r is ResumeItemRaw => !!r && typeof r.session_id === 'string')
    .map((r) => ({
      ...r,
      unread: Math.max(0, num(r.unread_count)),
      liveDevices: strList(r.live_devices),
      recommended: r.session_id === recommended,
    }));
  return { items, recommended: recommended ?? (items[0]?.session_id ?? null), total: num(data?.total, items.length) };
}

/** '이 기기' 배지 판정 — own이 unknown이면 다른 기기 목록에 unknown을 그대로 노출(모호함 숨기지 않음) */
export function foreignDevicesOf(liveDevices: string[], own: string | null): string[] {
  if (!own) return [...new Set(liveDevices)];
  return [...new Set(liveDevices.filter((d) => d !== own))];
}

/**
 * 이 화면에서 '읽음'으로 커밋할 최대 turn_index — 서버 커서는 max 병합이지만
 * 프론트도 음수/NaN/미확정(스트리밍 중) 값을 보내지 않는다. 보낼 값이 없으면 null(스킵).
 */
export function readCursorFor(messages: { turnIndex?: number; pending?: boolean; status?: string }[]): number | null {
  let max = -1;
  for (const m of messages) {
    if (m.pending || m.status === 'failed') continue;
    if (typeof m.turnIndex === 'number' && Number.isFinite(m.turnIndex) && m.turnIndex > max) max = m.turnIndex;
  }
  return max >= 0 ? max : null;
}

/** 디바운스된 커서 PUT Dedup — 마지막 전송값과 같으면 생략 (멱등이지만 요청 낭비 방지) */
export function shouldSendCursor(lastSent: number | null, next: number | null): boolean {
  return next !== null && (lastSent === null || next > lastSent);
}
