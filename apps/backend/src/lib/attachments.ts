/**
 * 첨부 링크 공용 로직 (t_401c5bd1) — sendMessage/replies 경로와 REST /api/attachments/link가
 * 동일한 소유권·세션·미링크 검증을 공유하도록 lib에 둔다 (라우트 간 드래프트 방지).
 *
 * 소유권 모델: messages_attachments.uploader_id = 사용자. 남의 attachment_id를 본문에 심어도
 * 404로 존재 자체를 숨긴다 (getOwnedMessage 관례). 같은 첨부 두 메시지는 두 번째 링크 시 거부.
 */
import { ApiError, ERROR_CODES } from './errors';
import { DbClient } from './supabase';

export interface AttachmentMetaRow {
  id: string;
  message_id: string | null;
  uploader_id: string | null;
  url: string;
  object_path: string;
  mime: string;
  size: number;
  sha256: string;
  name: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** messages.attachments JSONB에 얹는 요약 (레거시 렌더 경로 — frontdev Wave 2가 독해). */
export function attachmentSummary(row: AttachmentMetaRow) {
  return { id: row.id, url: row.url, mime: row.mime, size: row.size, name: row.name ?? null };
}

/**
 * user_message_id에 첨부들을 링크한다. 조건부 UPDATE(message_id IS NULL → 신규 링크만 반영)로
 * 동시 이중 링크를 방지하고, 반영 행만 messages.attachments 요약을 갱신한다.
 * 반환: 링크된 첨부 행. 검증 실패(타인 소유/이미 링크됨/파기 예정)는 전체 거부 후 ApiError.
 */
export async function linkAttachmentsToMessage(
  db: DbClient, userId: string, sessionId: string, messageId: string, ids: string[]
): Promise<AttachmentMetaRow[]> {
  const unique = Array.from(new Set(ids));
  const { data, error } = await db.from('messages_attachments')
    .select('*').in('id', unique).eq('uploader_id', userId);
  if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
  const rows = (data as AttachmentMetaRow[]) || [];
  if (rows.length !== unique.length) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, '존재하지 않거나 접근할 수 없는 첨부 ID가 있습니다.', { attachment_ids: unique });
  }
  const bad = rows.find(r => r.message_id != null || r.deleted_at != null);
  if (bad) {
    throw new ApiError(ERROR_CODES.CONFLICT, '이미 다른 메시지에 연결되었거나 파기 대기 중인 첨부는 재사용할 수 없습니다.', {
      attachment_id: bad.id,
    });
  }
  // 메시지 소유/세션 대조는 호출자(getOwnedSession + user_message_id 발급)가 보증하지만,
  // 링크 대상 행 자체를 한 번 더 조인다 (devstore는 FK가 없어 라우트 수준 검증이 곧 무결성).
  const { data: msg, error: msgErr } = await db.from('messages')
    .select('id').eq('id', messageId).eq('session_id', sessionId).maybeSingle();
  if (msgErr || !msg) throw new ApiError(ERROR_CODES.NOT_FOUND, '메시지를 찾을 수 없습니다.', { message_id: messageId });

  const { error: linkErr } = await db.from('messages_attachments')
    .update({ message_id: messageId }).in('id', unique).is('message_id', null);
  if (linkErr) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, linkErr.message);

  const { data: linked, error: linkedErr } = await db.from('messages_attachments')
    .select('*').in('id', unique).eq('message_id', messageId);
  if (linkedErr) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, linkedErr.message);
  const linkedRows = (linked as AttachmentMetaRow[]) || [];
  if (linkedRows.length !== unique.length) {
    // 동시 요청이 한 행을 선점한 경합 — 전부 원자 거부보다 부분 반영이 UX상 낫지만,
    // 이중 링크(같은 파일 2 메시지)는 허용하지 않는 편이 감사에 안전 → 409.
    throw new ApiError(ERROR_CODES.CONFLICT, '첨부 링크 경합이 발생했습니다. 다시 시도해 주세요.');
  }

  // messages.attachments JSONB 요약 동기화 (기존 요약 유지 + 새 첨부 append).
  const { data: msgRow } = await db.from('messages').select('attachments').eq('id', messageId).maybeSingle();
  const existing = Array.isArray((msgRow as { attachments?: unknown } | null)?.attachments)
    ? (msgRow as { attachments: unknown[] }).attachments : [];
  const { error: updErr } = await db.from('messages').update({
    attachments: [...existing, ...linkedRows.map(attachmentSummary)],
  }).eq('id', messageId);
  if (updErr) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, updErr.message);
  return linkedRows;
}

/**
 * 링크 시도 전 소유권·링크가능성 선검증 (t_401c5bd1) — runTextTurn이 사용자 메시지를 저장하기 *전에*
 * 호출해, 남의/없는/이미 사용된 첨부 ID로 턴이 진행되어 고아 user 메시지·LLM 비용이 남는 것을 막는다.
 * (실제 링크는 linkAttachmentsToMessage가 message_id 발급 후 수행 — 여기는 읽기 전용, 경합은 조건부 UPDATE가 방어.)
 */
export async function assertAttachmentsOwned(db: DbClient, userId: string, ids: string[]): Promise<void> {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return;
  const { data, error } = await db.from('messages_attachments')
    .select('*').in('id', unique).eq('uploader_id', userId);
  if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
  const rows = (data as AttachmentMetaRow[]) || [];
  if (rows.length !== unique.length) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, '존재하지 않거나 접근할 수 없는 첨부 ID가 있습니다.', { attachment_ids: unique });
  }
  const used = rows.find(r => r.message_id != null || r.deleted_at != null);
  if (used) {
    throw new ApiError(ERROR_CODES.CONFLICT, '이미 다른 메시지에 연결되었거나 파기 대기 중인 첨부는 재사용할 수 없습니다.', { attachment_id: used.id });
  }
}

/** request.body에서 attachment_ids 배열을 검증/추출 (미지정 시 빈 배열 = 기존 경로 무영향). */
export function parseAttachmentIds(body: unknown, max = 10): string[] {
  const ids = (body as { attachment_ids?: unknown } | null)?.attachment_ids;
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids) || ids.length > max || ids.some(x => typeof x !== 'string' || !x)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `attachment_ids는 최대 ${max}개의 문자열 배열이어야 합니다.`);
  }
  return ids as string[];
}
