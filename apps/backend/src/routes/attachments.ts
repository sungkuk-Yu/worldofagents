/**
 * /api/attachments — 첨부 열람/다운로드/수동 링크 (t_401c5bd1).
 *
 * 경로 설계:
 *  - GET /object/*  : object_path로 바이트 서빙. DEV_MODE는 devstore.blobs, 프로덕션은
 *    공개 버킷 URL로 302 리다이렉트(프론트가 모드 무관 단일 URL 포맷을 쓰게 하기 위함 —
 *    저장된 messages_attachments.url이 바로 이 경로라면 프로덕션에서 302 대상은 Supabase 공개 URL).
 *  - GET /message/:messageId : 그 메시지에 링크된 첨부 목록 (소유 메시지여야 함).
 *  - POST /link : { message_id, attachment_ids } — 전송 후 링크 실패 복구/재시도용.
 *    (정상 흐름은 sendMessage/replies의 attachment_ids 본문 필드 — lib/attachments 공유)
 * 소유권: 라우트 수준 user_id 필터(service_role 우회) — 002 확립 패턴. 타인 첨부/메시지는 404.
 */
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ApiError, ERROR_CODES, ok, badRequest } from '../lib/errors';
import { attachmentSummary, AttachmentMetaRow, linkAttachmentsToMessage, parseAttachmentIds } from '../lib/attachments';
import { getOwnedMessage } from '../lib/helpers';
import { getStore } from '../lib/devstore';
import { config } from '../config';
import { DbClient } from '../lib/supabase';
import { Readable, Transform } from 'node:stream';


const ATTACHMENT_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'application/pdf',
]);
const ATTACHMENT_CSP = "sandbox; default-src 'none'; frame-ancestors 'none'";

async function listLinked(db: DbClient, uploaderId: string, messageId: string): Promise<AttachmentMetaRow[]> {
  const { data, error } = await db.from('messages_attachments').select('*')
    .eq('message_id', messageId).eq('uploader_id', uploaderId).is('deleted_at', null);
  if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
  return (data as AttachmentMetaRow[]) || [];
}

export async function attachmentRoutes(app: FastifyInstance) {
  // GET /message/:messageId — 메시지에 링크된 첨부 목록 (Wave 2 렌더 소스).
  app.get('/message/:messageId', { preHandler: requireAuth }, async (request) => {
    const { message } = await getOwnedMessage(request.db, request.userId, (request.params as { messageId: string }).messageId);
    // 링크된 첨부도 업로더(=발신자) 소유만 보인다 — agent 메시지 첨부(미지원)는 빈 배열.
    return ok((await listLinked(request.db, request.userId, message.id)).map(r => ({
      ...attachmentSummary(r), created_at: r.created_at,
    })));
  });

  // POST /link — { message_id, attachment_ids:[...] } (멱등 재시도: 이미 링크된 것은 CONFLICT)
  app.post('/link', { preHandler: requireAuth }, async (request) => {
    const { message_id: messageId } = (request.body ?? {}) as { message_id?: unknown };
    if (typeof messageId !== 'string' || !messageId) throw badRequest('message_id는 필수입니다.');
    const ids = parseAttachmentIds(request.body);
    if (!ids.length) throw badRequest('attachment_ids는 1개 이상이어야 합니다.');
    const { message } = await getOwnedMessage(request.db, request.userId, messageId);
    const rows = await linkAttachmentsToMessage(request.db, request.userId, message.session_id, message.id, ids);
    return ok(rows.map(r => ({ ...attachmentSummary(r), created_at: r.created_at })));
  });

  // GET /object/* — 첨부 바이트를 검증된 MIME과 고정 안전 헤더로 서빙.
  // 이 경로 자체는 비인증 공개 엔드포인트지만 내용은 128bit 난수 uuid 경로(capability URL)로만 도달 가능하다.
  app.get('/object/*', async (request, reply) => {
    const objectPath = ((request.params as { '*': string })['*'] || '').replace(/^\/+/, '');
    if (!/^[a-f0-9]{12}\/[a-f0-9-]{36}\.[a-z0-9]{1,8}$/i.test(objectPath)) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, '첨부 객체를 찾을 수 없습니다.');
    }
    let bytes: Buffer | undefined;
    let mime: string;
    if (config.devMode) {
      const blob = getStore().blobs.get(objectPath);
      if (!blob) throw new ApiError(ERROR_CODES.NOT_FOUND, '첨부 객체를 찾을 수 없습니다.');
      bytes = blob.bytes;
      mime = blob.mime.toLowerCase().split(';', 1)[0].trim();
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('upstream timeout')), 15_000);
      let upstream: Response;
      try {
        upstream = await fetch(`${config.supabase.url}/storage/v1/object/public/${config.upload.bucket}/${objectPath}`, { signal: controller.signal });
      } catch {
        clearTimeout(timeout);
        throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '첨부 객체를 가져오지 못했습니다.');
      }
      if (!upstream.ok || !upstream.body) {
        clearTimeout(timeout);
        throw new ApiError(ERROR_CODES.NOT_FOUND, '첨부 객체를 찾을 수 없습니다.');
      }
      mime = (upstream.headers.get('content-type') || 'application/octet-stream').toLowerCase().split(';', 1)[0].trim();
      const maxBytes = config.upload.maxBytes;
      let total = 0;
      const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        if (total > maxBytes) callback(new ApiError(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, '첨부 객체 크기 제한을 초과했습니다.'));
        else callback(null, chunk);
      }});
      const source = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
      const disconnect = () => controller.abort();
      const onAbort = () => { source.destroy(); limiter.destroy(); };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      const stream = source.pipe(limiter);
      reply.raw.once('close', disconnect);
      const cleanup = () => {
        clearTimeout(timeout);
        reply.raw.off('close', disconnect);
        controller.signal.removeEventListener('abort', onAbort);
      };
      stream.once('close', cleanup);
      stream.once('error', () => controller.abort());
      mime = ATTACHMENT_MIMES.has(mime) ? mime : 'application/octet-stream';
      reply.header('content-type', mime)
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', ATTACHMENT_CSP)
        .header('cache-control', 'private, no-store, max-age=0');
      return reply.send(stream);
    }
    if (!ATTACHMENT_MIMES.has(mime)) mime = 'application/octet-stream';
    return reply
      .header('content-type', mime)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', ATTACHMENT_CSP)
      .header('cache-control', 'private, no-store, max-age=0')
      .send(bytes);
  });
}
