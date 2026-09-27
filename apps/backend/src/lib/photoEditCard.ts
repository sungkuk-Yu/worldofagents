/**
 * photo_edit 카드 emission 라우팅 (t_78ffba4f, Wave 2 서버측).
 *
 * 프론트(t_4497cfce)는 registerCard('photo_edit', PhotoEditAgentCard) 배선 완료 —
 * 백엔드가 답변 메시지에 dialogue_type='photo_edit' + structured_payload를 emit하면
 * 즉시 렌더된다. 프론트 parsePhotoEditPayload 계약과 동일한 허용 형태를 만든다:
 *   평면 { original_url|image_url, edited_url|url, crop(0~1 {x,y,w,h}),
 *          annotations:[{id?,type:'pin'|'arrow'|'text',from:{x,y},to?,note?}],
 *          caption, edit_of(message_id) }
 *
 * 판정은 결정론적 규칙이다 (LLM 분류 대상 아님): user 메시지 content의 ```json 펜스에
 * photo_edit 지시가 있고, 같은 턴에 이미지 첨부가 링크됐을 때만 카드로 승격한다.
 * 지시 재현(UserCard→PhotoEditCard 펜스 경로)과 별개 — 여기는 agent 카드 emit.
 *
 * 기존 'media' 재사용 금지(#182): media는 프론트 전용 타입이고 백엔드는 emit한 적 없다.
 * 이미지 편집 프로바이더 실행(에디트 결과 이미지 생성, t_6720010a)은 프로바이더 배정 시
 * 별도 과제로서, 이 모듈은 지시+첨부로 확정된 카드를 반영할 뿐 원본 이미지를 그대로
 * original_url에 싣는다(edited_url은 프로바이더 결과 배선 시 채워진다).
 */
import type { AttachmentMetaRow } from './attachments';
import type { StructuredAnswer } from './structured';

export interface PhotoEditDirective {
  crop: { x: number; y: number; w: number; h: number } | null;
  annotations: { id?: string; type: 'pin' | 'arrow' | 'text'; from: { x: number; y: number }; to?: { x: number; y: number }; note?: string }[];
  caption: string | null;
  editOf: string | null;
  /** 지시가 자체 URL을 포함하면(에이전트/프로바이더 산출) 우선 사용. */
  originalUrl: string | null;
  editedUrl: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const unit = (v: unknown): number => Math.min(1, Math.max(0, num(v) ?? 0));
/** 프론트 safeHttp와 동일: http(s)만, '@' 포함 스킴 차단(인젝션/스크임 방지). */
const safeHttp = (v: unknown): string | null =>
  (typeof v === 'string' && /^(https?):/i.test(v) && !v.includes('@')) ? v : null;

/** 0~1 정규화 사각형 — 최소 크기(0.05) 미달/전면 그대로면 null(편집 없음). */
function clampCrop(raw: unknown): PhotoEditDirective['crop'] {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const x = unit(c.x), y = unit(c.y);
  const w = Math.min(Math.max(num(c.w) ?? 1, 0), 1 - x);
  const h = Math.min(Math.max(num(c.h) ?? 1, 0), 1 - y);
  if (w < 0.05 || h < 0.05) return null;
  if (w >= 1 && h >= 1 && x === 0 && y === 0) return null; // 전체 그대로 = 크롭 없음
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}

/** 주석 정규화 — 프론트 sanitizeAnnotations와 동일 규칙(화살표는 to 필수, note 길이 캡). */
function sanitizeAnnotations(list: unknown): PhotoEditDirective['annotations'] {
  if (!Array.isArray(list)) return [];
  const out: PhotoEditDirective['annotations'] = [];
  for (const raw of list) {
    const a = raw as Record<string, unknown>;
    const type = a?.type;
    if (type !== 'pin' && type !== 'arrow' && type !== 'text') continue;
    const from = a.from as Record<string, unknown> | undefined;
    if (!from || num(from.x) === null || num(from.y) === null) continue;
    const item: PhotoEditDirective['annotations'][number] = {
      type, from: { x: unit(from.x), y: unit(from.y) },
    };
    if (typeof a.id === 'string' && a.id) item.id = a.id;
    const to = a.to as Record<string, unknown> | undefined;
    if (to && num(to.x) !== null && num(to.y) !== null) item.to = { x: unit(to.x), y: unit(to.y) };
    if (type === 'arrow' && !item.to) continue; // 화살표는 착점 필수 (프론트 규칙 동일)
    if (typeof a.note === 'string' && a.note.trim()) item.note = a.note.trim().slice(0, 200);
    out.push(item);
  }
  return out;
}

const FENCE = /```json\s*([\s\S]*?)```/;

/**
 * user 메시지 content에서 photo_edit 지시 펜스 추출.
 * 지시 없음/파싱 실패/편집 내용 없음(crop·annotations·url 전부 공) → null (무영향).
 */
export function parsePhotoEditDirective(content: string): PhotoEditDirective | null {
  const m = content.match(FENCE);
  if (!m) return null;
  let obj: Record<string, unknown> | null = null;
  try { obj = JSON.parse(m[1]); } catch { return null; }
  const raw = obj?.photo_edit;
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const images = Array.isArray(p.images) ? (p.images as { url?: unknown }[]) : [];
  const crop = clampCrop(p.crop ?? p.crop_pct);
  const annotations = sanitizeAnnotations(p.annotations);
  const originalUrl = safeHttp(p.original_url ?? p.image_url) ?? (images.length ? safeHttp(images[0]?.url) : null);
  const editedUrl = safeHttp(p.edited_url ?? p.url);
  const caption = typeof p.caption === 'string' && p.caption.trim() ? p.caption.trim().slice(0, 300) : null;
  const editOf = typeof p.edit_of === 'string' ? p.edit_of : null;
  if (!crop && !annotations.length && !originalUrl && !editedUrl) return null;
  return { crop, annotations, caption, editOf, originalUrl, editedUrl };
}

/**
 * 턴 결과 → photo_edit 카드 structured(있으면). 승격 조건:
 *   지시 펜스 유효 + (이미지 첨부 링크됨 또는 지시 내 유효 URL).
 * 그 외 기존 classification(file/text)을 건드리지 않는다.
 */
export function photoEditCardForTurn(
  userMessage: string,
  attachments: Pick<AttachmentMetaRow, 'url' | 'mime'>[]
): StructuredAnswer | null {
  const d = parsePhotoEditDirective(userMessage);
  if (!d) return null;
  const image = attachments.find(a => typeof a.mime === 'string' && a.mime.startsWith('image/') && safeHttp(a.url));
  const originalUrl = d.originalUrl ?? (image ? safeHttp(image.url) : null);
  const editedUrl = d.editedUrl;
  if (!originalUrl && !editedUrl) return null; // 원본도 편집본도 없는 카드는 렌더 불능 — 기존 경로 유지
  const structured_payload: Record<string, unknown> = {};
  if (originalUrl) structured_payload.original_url = originalUrl;
  if (editedUrl) structured_payload.edited_url = editedUrl;
  if (d.crop) structured_payload.crop = d.crop;
  if (d.annotations.length) structured_payload.annotations = d.annotations;
  if (d.caption) structured_payload.caption = d.caption;
  if (d.editOf) structured_payload.edit_of = d.editOf;
  return { dialogue_type: 'photo_edit', structured_payload, classifier: 'rules' };
}

/**
 * 답변 턴 승격 사전 판정 (t_78ffba4f — graph routerNode의 answer 강제 활성용):
 * 첨부가 있고 지시 펜스가 존재하면 true. "이 부분 잘라줘"류 발화는 규칙상 information으로
 * 잡혀 answer 뉴런이 꺼지면 답변 행 자체가 저장되지 않으므로, 카드가 나갈 자리가 없다.
 * 실제 payload 확정(이미지 mime/URL)은 link 후 photoEditCardForTurn에서.
 */
export function photoEditDirectivePending(userMessage: string, attachmentCount: number): boolean {
  return attachmentCount > 0 && parsePhotoEditDirective(userMessage) !== null;
}
