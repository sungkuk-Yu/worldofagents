// 사진 편집 Wave 2 순수 로직 (t_4497cfce) — 크롭 기하·주석 정규화·에이전트 지시문·피드 파생.
// React/네트워크 의존 없음 → node --test 단위 대상. 캔버스 좌표는 0~1 정규화 (해상도 무관 — 카드 요구).

/** 정규화 크롭 사각형 — x,y = 좌상단, w,h = 너비/높이 (0~1). */
export interface CropRect { x: number; y: number; w: number; h: number }
/** 요소 이동 지시 주석 — "이걸 → 여기로". from/to 모두 0~1. */
export interface PhotoAnnotation { type: 'arrow' | 'pin' | 'text'; from: { x: number; y: number }; to?: { x: number; y: number }; note?: string }
/** 첨부 요약 — messages.attachments JSONB / POST /api/upload 응답 (백엔드 t_401c5bd1 계약). */
export interface AttachmentRef { id: string; url: string; mime: string; size: number; name: string | null }

export const MIN_CROP = 0.05;

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const unit = (v: unknown): number => Math.min(1, Math.max(0, num(v, 0)));

/** 프리셋 비율 — ratio=null 은 자유 비율. value 는 w/h. */
export const CROP_PRESETS = [
  { id: 'free', ratio: null },
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '16:9', ratio: 16 / 9 },
] as const;
export type CropPresetId = (typeof CROP_PRESETS)[number]['id'];
export const presetRatio = (id: string): number | null =>
  CROP_PRESETS.find((p) => p.id === id)?.ratio ?? null;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 임의 rect → 0~1 범위 내 클램프 + 최소 크기 보장. ratio(w/h) 주입 시 중심 유지로 수축. */
export function clampCrop(rect: Partial<CropRect>, ratio: number | null = null): CropRect {
  let x = clamp01(num(rect.x, 0)), y = clamp01(num(rect.y, 0));
  let w = Math.min(Math.max(num(rect.w, 1), MIN_CROP), 1);
  let h = Math.min(Math.max(num(rect.h, 1), MIN_CROP), 1);
  w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    // 비율 enforcement: 큰 축을 줄여 h = w/ratio (w가 캔버스 넘치면 w부터 자름).
    if (h > w / ratio) h = w / ratio; else w = h * ratio;
    if (x + w > 1) { w = 1 - x; h = w / ratio; }
    if (y + h > 1) { h = 1 - y; w = h * ratio; }
    if (w < MIN_CROP || h < MIN_CROP) return { x: +x.toFixed(4), y: +y.toFixed(4), w: 0, h: 0 };
  }
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}

/** 핸들 드래그 → 새 rect — 모서리 핸들(nw|ne|sw|se)은 대각점 고정, move는 평행이동. */
export function dragCrop(rect: CropRect, handle: 'nw' | 'ne' | 'sw' | 'se' | 'move', dx: number, dy: number, ratio: number | null = null): CropRect {
  const { x, y, w, h } = rect;
  if (handle === 'move') return clampCrop({ x: x + dx, y: y + dy, w, h }, ratio);
  const a = {
    nw: { ax: x + w, ay: y + h, mx: x + dx, my: y + dy },
    ne: { ax: x, ay: y + h, mx: x + w + dx, my: y + dy },
    sw: { ax: x + w, ay: y, mx: x + dx, my: y + h + dy },
    se: { ax: x, ay: y, mx: x + w + dx, my: y + h + dy },
  }[handle];
  return clampCrop({
    x: Math.min(a.ax, a.mx), y: Math.min(a.ay, a.my),
    w: Math.abs(a.ax - a.mx), h: Math.abs(a.ay - a.my),
  }, ratio);
}

/** 크롭 → 픽셀 드로잉 인자 (canvas drawImage 원본 좌표). */
export function cropToPixels(rect: CropRect, natural: { width: number; height: number }) {
  return {
    sx: Math.round(rect.x * natural.width), sy: Math.round(rect.y * natural.height),
    sw: Math.max(1, Math.round(rect.w * natural.width)), sh: Math.max(1, Math.round(rect.h * natural.height)),
  };
}

export function isAnnotation(v: unknown): v is PhotoAnnotation {
  const a = v as PhotoAnnotation;
  return !!a && (a.type === 'arrow' || a.type === 'pin' || a.type === 'text')
    && !!a.from && Number.isFinite(a.from.x) && Number.isFinite(a.from.y);
}

/** 서버/로컬 원시 배열 → 안전한 주석 리스트 (화살표는 to 필수). */
export function sanitizeAnnotations(list: unknown): PhotoAnnotation[] {
  if (!Array.isArray(list)) return [];
  const out: PhotoAnnotation[] = [];
  for (const raw of list) {
    if (!isAnnotation(raw)) continue;
    const a: PhotoAnnotation = { type: raw.type, from: { x: unit(raw.from.x), y: unit(raw.from.y) } };
    if (raw.type === 'arrow' || raw.type === 'text') {
      // text는 단일 앵커면 to 생략(그림 옆 라벨), arrow는 to 필수
      if (raw.to && Number.isFinite(raw.to.x) && Number.isFinite(raw.to.y)) a.to = { x: unit(raw.to.x), y: unit(raw.to.y) };
      if (raw.type === 'arrow' && !a.to) continue;
    }
    if (typeof raw.note === 'string' && raw.note.trim()) a.note = raw.note.trim().slice(0, 200);
    out.push(a);
  }
  return out;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 주석 → 사람이 읽는 지시 행 ("이걸 → 여기로"). */
function annotationLine(a: PhotoAnnotation): string {
  const at = (p: { x: number; y: number }) => `(${pct(p.x)}, ${pct(p.y)})`;
  const note = a.note ? ` "${a.note}"` : '';
  if (a.type === 'arrow' && a.to) return `화살표${note}: ${at(a.from)} → ${at(a.to)}`;
  if (a.type === 'pin') return `핀${note}: ${at(a.from)}`;
  return `텍스트${note}: ${at(a.from)}`;
}

/** 편집 결과 → 에이전트 전송 텍스트 (사람 요약 + 기계 파싱용 JSON 펜스 — 카드 §1 페이로드 계약). */
export function buildEditMessage(input: { crop: CropRect | null; annotations: PhotoAnnotation[]; caption?: string; editOf?: string | null }): string {
  const lines: string[] = [];
  if (input.caption?.trim()) lines.push(input.caption.trim());
  if (input.crop) lines.push(`크롭: x ${pct(input.crop.x)} · y ${pct(input.crop.y)} · ${pct(input.crop.w)}×${pct(input.crop.h)} (0~1 정규화)`);
  for (const a of input.annotations) lines.push(`이동 지시 — ${annotationLine(a)}`);
  if (!lines.length) lines.push('사진을 편집해 첨부했어요.');
  lines.push('```json', JSON.stringify({ photo_edit: { edit_of: input.editOf ?? null, crop: input.crop, annotations: input.annotations } }), '```');
  return lines.join('\n').slice(0, 4000);
}

// ── 첨부 / photo_edit 카드 페이로드 ─────────────────────

/** messages.attachments(JSONB 요약 배열) → AttachmentRef[] (잘못 행 드롭; URL은 http(s)만 — 인젝션/스크임 방지). */
export function normalizeAttachments(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value)) return [];
  const out: AttachmentRef[] = [];
  for (const raw of value) {
    const r = raw as Partial<AttachmentRef>;
    if (/^(https?):/i.test(r?.url ?? '') && !r.url!.includes('@') && typeof r.id === 'string' && r.id && typeof r.mime === 'string') {
      out.push({ id: r.id, url: r.url!, mime: r.mime, size: num(r.size, 0), name: typeof r.name === 'string' ? r.name : null });
    }
  }
  return out;
}

export const isImageAttachment = (a: AttachmentRef): boolean => a.mime.startsWith('image/');

/** 이미지 표시 = contain(box 기준) 시 실이미지 박스 (정규화 좌표 → 컨테이너 px). */
export function containBox(boxW: number, boxH: number, imgW: number, imgH: number): { ox: number; oy: number; w: number; h: number } {
  if (!(boxW > 0 && boxH > 0 && imgW > 0 && imgH > 0)) return { ox: 0, oy: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * s, h = imgH * s;
  return { ox: (boxW - w) / 2, oy: (boxH - h) / 2, w, h };
}

/** 정규화 crop → contain 레이아웃(box px)에서 표시될 px 사각형. */
export function cropRectOnContain(crop: CropRect, boxW: number, boxH: number, natural?: { width: number; height: number }): { left: number; top: number; width: number; height: number } {
  const { ox, oy, w, h } = containBox(boxW, boxH, natural?.width ?? 1, natural?.height ?? 1);
  return { left: ox + crop.x * w, top: oy + crop.y * h, width: crop.w * w, height: crop.h * h };
}

/** 정규화 주석 → contain 표시 좌표 px 변환. */
export function mapAnnotationToShown(a: PhotoAnnotation, boxW: number, boxH: number, natural?: { width: number; height: number }): { type: PhotoAnnotation['type']; from: { x: number; y: number }; to?: { x: number; y: number }; note?: string } | null {
  const { ox, oy, w, h } = containBox(boxW, boxH, natural?.width ?? 1, natural?.height ?? 1);
  const p = (v: { x: number; y: number }) => ({ x: ox + v.x * w, y: oy + v.y * h });
  return { type: a.type, from: p(a.from), ...(a.to ? { to: p(a.to) } : {}), ...(a.note ? { note: a.note } : {}) };
}

const safeHttp = (v: unknown): string | null => {
  if (typeof v !== 'string' || !/^(https?):/i.test(v) || v.includes('@')) return null;
  return v;
};

/** photo_edit 카드 payload 정규화 — 원본/편집본 둘 다 보존 (카드 요구). 미확인 필드는 null. */
export interface PhotoEditPayload {
  originalUrl: string | null;
  editedUrl: string | null;
  editOf: string | null;
  crop: CropRect | null;
  annotations: PhotoAnnotation[];
  caption: string | null;
}
export function parsePhotoEditPayload(payload: unknown): PhotoEditPayload {
  // structured_payload는 { photo_edit: {...} } 래핑 또는 평면 { crop, annotations, ... } 둘 다 허용.
  const wrap = (payload as { photo_edit?: unknown } | null)?.photo_edit;
  const p = ((wrap && typeof wrap === 'object' ? wrap : payload) ?? {}) as Record<string, unknown>;
  const cropRaw = p.crop ?? p.crop_pct;
  let crop: CropRect | null = null;
  if (cropRaw && typeof cropRaw === 'object') {
    const c = clampCrop(cropRaw as Partial<CropRect>);
    if (c.w < 1 || c.h < 1 || c.x > 0 || c.y > 0) crop = c; // 전체 그대로면 null(편집 없음)
  }
  const images = Array.isArray(p.images) ? (p.images as { url?: unknown; caption?: unknown }[]) : [];
  return {
    originalUrl: safeHttp(p.original_url ?? p.image_url) ?? (images.length ? safeHttp(images[0].url) : null),
    editedUrl: safeHttp(p.edited_url ?? p.url) ?? null,
    editOf: typeof p.edit_of === 'string' ? p.edit_of : null,
    crop,
    annotations: sanitizeAnnotations(p.annotations),
    caption: typeof p.caption === 'string' && p.caption.trim() ? p.caption.trim().slice(0, 300) : null,
  };
}

// ── 인스타 피드 파생 ────────────────────────────────────
// 공유 대상: ⭐ 즐겨찾기 카드 · media 카드 · form_response 결과 · photo_edit (카드 §2).
// 외부 스냅샷 금지: form_response (사용자 PII 입력 포함 가능 — 개인정보 주의), 세션 컨텍스트 절대 포함 금지.

export interface FeedPost {
  messageId: string;
  sessionId: string;
  kind: 'photo_edit' | 'media' | 'form_response' | 'card';
  mediaUrls: string[];
  title: string;
  caption: string;
  agentName: string;
  sessionTitle: string;
  createdAt?: string;
  favorite: boolean;
  /** 카드 내용만 렌더(세션 컨텍스트 비노출) 여부 — 스레드 딥링크는 openSource로 허용. */
  canSnapshot: boolean;
  /** photo_edit 편집 뱃지 (원본/편집본 보관 여부). */
  editBadge: boolean;
}

const FORM_RESULT_TYPES = new Set(['form_response', 'form_result']);

/** GET /api/favorites 행 → FeedPost (media/image/첨부 우선, 없으면 텍스트 카드=card). */
export function toFeedPost(entry: {
  message: { id?: string; dialogue_type?: string | null; structured_payload?: unknown; content?: string; attachments?: unknown; favorite?: boolean; created_at?: string; session_id?: string };
  session?: { id?: string; title?: string | null; agent_name?: string | null };
}): FeedPost | null {
  const m = entry.message;
  if (!m || typeof m.id !== 'string') return null;
  const type = (m.dialogue_type ?? '').toLowerCase();
  const p = (m.structured_payload ?? {}) as Record<string, unknown>;
  const atts = normalizeAttachments(m.attachments).filter(isImageAttachment);
  const pe = type === 'photo_edit' ? parsePhotoEditPayload(p) : null;
  const media: string[] = [];
  if (pe) { if (pe.editedUrl) media.push(pe.editedUrl); if (pe.originalUrl && pe.originalUrl !== pe.editedUrl) media.push(pe.originalUrl); }
  if (type === 'media') { const u = safeHttp(p.url); if (u) media.push(u); }
  for (const a of atts) if (!media.includes(a.url)) media.push(a.url);
  const kind: FeedPost['kind'] = pe ? 'photo_edit' : type === 'media' ? 'media' : FORM_RESULT_TYPES.has(type) || (p.form_id != null && type === 'text' && p.response != null) ? 'form_response' : 'card';
  // 캡션 우선순위: photo_edit.caption → payload.caption → 메시지 본문(trim) — 빈 문자열이 체인을 끊지 못하게 명시 분기
  const rawCaption = pe?.caption
    ?? (typeof p.caption === 'string' && p.caption.trim() ? p.caption.trim() : undefined)
    ?? (typeof m.content === 'string' && m.content.trim() ? m.content.trim() : undefined)
    ?? '';
  const caption = rawCaption.slice(0, 200);
  if (!caption && !media.length) return null;
  return {
    messageId: m.id,
    sessionId: typeof entry.session?.id === 'string' ? entry.session.id : typeof m.session_id === 'string' ? m.session_id : '',
    kind,
    mediaUrls: media,
    title: typeof p.title === 'string' ? p.title : '',
    caption,
    agentName: entry.session?.agent_name ?? '',
    sessionTitle: entry.session?.title ?? '',
    createdAt: typeof m.created_at === 'string' ? m.created_at : undefined,
    favorite: m.favorite !== false,
    // 외부 스냅샷 = 카드 내용만. form_response(PII)·addendum: 첨부만 있고 카드 본문이 요청 원문인 행은 제외 기준 아님 — form_response만 차단.
    canSnapshot: kind !== 'form_response',
    editBadge: !!pe && (!!pe.crop || pe.annotations.length > 0 || !!pe.editedUrl),
  };
}

/** 피드 세그먼트 필터. */
export type FeedSegment = 'all' | 'photo' | 'media';
export function filterFeedPosts(posts: FeedPost[], segment: FeedSegment): FeedPost[] {
  if (segment === 'photo') return posts.filter((x) => x.kind === 'photo_edit');
  if (segment === 'media') return posts.filter((x) => x.kind === 'media' || x.mediaUrls.length > 0);
  return posts;
}

/** URL 확장자 기반 영상 판정 (첨부 mime에 video/*가 없으면 최후 판정 — media 카드 payload도 동일). */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(url);
}
