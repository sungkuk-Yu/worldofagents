/**
 * /api/upload — 첨부 업로드 재구축 (t_401c5bd1, B안).
 *
 * 흐름 (카드 §범위):
 *   프론트가 POST /api/upload(multipart) → 파일 바이트를 Supabase Storage 버킷 `attachments`에
 *   올리고, 메타를 messages_attachments 행(message_id NULL = 미링크)으로 남긴다.
 *   그 뒤 sendMessage/replies 본문에 attachment_ids를 실어 보내면 그 user 메시지에 링크된다.
 *
 * 검증 경계(카드 P3-java '검증 없이 완료 금지'):
 *   - 413 FILE_TOO_LARGE: 파일당 maxBytes 초과 (multipart fileSizeLimit + 스트림 소비 후 2차 확인)
 *   - 415 UNSUPPORTED_MEDIA_TYPE: MIME allowlist(image/*, application/pdf) — 선언 MIME만 신뢰하지
 *     않고 magic-byte 스니핑으로 위장 업로드를 1차 차단한다.
 *   - 429 UPLOAD_QUOTA_EXCEEDED: 사용자당 UTC 일일 카운터(bump_upload_quota RPC 원자적).
 *   - 401: requireAuth.
 *   쿼터는 Storage 업로드 성공 후에만 차감한다(업로드 실패로 쿼터 새는 것 방지).
 *
 * NOTE: 인증 헤더·URL 조합은 lib/storage.ts가 소유(공유 supabaseAdmin 비오염 원칙).
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ApiError, ERROR_CODES, ok, badRequest } from '../lib/errors';
import { config } from '../config';
import { publicObjectUrl, uploadToAttachmentsBucket } from '../lib/storage';
import { logger } from '../utils/logger';

/** magic-byte 스니핑 — 선언 MIME과 무관하게 실제 페이로드 형식만 인정 (이미지/PDF 허용목록). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 6 && buf.slice(0, 3).toString('latin1') === 'GIF'
    && /8(7a|9a)/.test(buf.slice(3, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && buf.slice(4, 8).toString('latin1') === 'ftyp'
    && /(avif|webp|heic|heix|mif1|msf1)/.test(buf.slice(8, 12).toString('latin1'))) return 'image/avif';
  if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  // BMP (BIK) — allowlist image/*의 일부로 인정.
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return null;
}

/** MIME이 허용목록(image/* 프리픽스, 정확매칭)과 충돌하는지. */
function isAllowedMime(mime: string): boolean {
  return config.upload.allowedMimes.some(rule => rule === mime || (rule.endsWith('/*') && mime.startsWith(rule.slice(0, -1))));
}

/** 파일명에서 안전 확장자만 추출(uuid 파일명 앞에 붙이는 용도 — 경로/제어문자 제거). */
function safeExt(filename: string, mime: string): string {
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'application/pdf': 'pdf',
  };
  if (byMime[mime]) return byMime[mime];
  const m = typeof filename === 'string' ? filename.match(/\.([A-Za-z0-9]{1,8})$/) : null;
  return m ? m[1].toLowerCase() : 'bin';
}

/** 사용자별 12자 난수 접두 경로 (전체 userId 비노출 + 파기 추적 조인용). */
function userPrefix(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 12);
}

export async function uploadRoutes(app: FastifyInstance) {
  // POST /api/upload — multipart 단일 파일. route bodyLimit은 20MB+여유(헤더/필드).
  app.post('/', {
    preHandler: requireAuth,
    bodyLimit: config.upload.maxBytes + 64 * 1024,
  }, async (request: FastifyRequest, reply) => {
    if (!request.isMultipart()) throw badRequest('multipart/form-data로 업로드해야 합니다.');
    // @fastify/multipart 기본 throwFileSizeLimit=true: 초과 시 toBuffer()가 RequestFileTooLargeError
    // (FST_REQ_FILE_TOO_LARGE, 413)를 던진다 — 도메인 에러 코드로 번역하지 않으면 errorHandler가
    // INTERNAL_ERROR로 표면화하므로 여기서 FILE_TOO_LARGE로 정규화한다.
    let data: Awaited<ReturnType<FastifyRequest['file']>>;
    let buf: Buffer;
    try {
      data = await request.file({ limits: { fileSize: config.upload.maxBytes, files: 1 } });
      if (!data) throw badRequest('file 필드를 찾을 수 없습니다.');
      buf = await data.toBuffer();
    } catch (err) {
      if ((err as { code?: string })?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new ApiError(ERROR_CODES.FILE_TOO_LARGE,
          `파일은 ${Math.floor(config.upload.maxBytes / (1024 * 1024))}MB를 초과할 수 없습니다.`, { max_bytes: config.upload.maxBytes });
      }
      throw err;
    }
    // fileSizeLimit 스트림 종료(truncated) 1차 + 버퍼 실측 2차 확인.
    if (data.file.truncated || buf.length > config.upload.maxBytes) {
      throw new ApiError(ERROR_CODES.FILE_TOO_LARGE,
        `파일은 ${Math.floor(config.upload.maxBytes / (1024 * 1024))}MB를 초과할 수 없습니다.`, { max_bytes: config.upload.maxBytes });
    }
    if (buf.length === 0) throw badRequest('빈 파일은 업로드할 수 없습니다.');
    const declaredMime = (data.mimetype || 'application/octet-stream').toLowerCase();

    // 선언 MIME과 magic-byte가 모두 허용목록에 맞아야 통과 (위장 업로드 차단).
    const sniffed = sniffMime(buf);
    if (!sniffed || !isAllowedMime(sniffed) || !isAllowedMime(declaredMime)) {
      throw new ApiError(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
        '허용되지 않은 파일 형식입니다. 이미지 또는 PDF만 가능합니다.', { declared_mime: declaredMime, sniffed_mime: sniffed });
    }

    // 쿼터 원자 차감 (bump_upload_quota) — 초과 시 증가 없이 현재값 반환 → 429.
    const day = new Date().toISOString().slice(0, 10); // UTC date
    const { data: used, error: quotaErr } = await request.db.rpc('bump_upload_quota', {
      p_user: request.userId, p_day: day, p_limit: config.upload.maxPerDay,
    });
    if (quotaErr) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, `쿼터 확인 실패: ${quotaErr.message}`);
    // -1 센티넬 = 한도 초과(증가 없음). devstore 미지원 폴백: 숫자가 아니면 허용(쿼터 테이블 없음).
    if (used === -1) {
      throw new ApiError(ERROR_CODES.UPLOAD_QUOTA_EXCEEDED,
        `오늘 업로드 한도(${config.upload.maxPerDay}개)를 초과했습니다.`, { limit: config.upload.maxPerDay });
    }

    const objectPath = `${userPrefix(request.userId)}/${randomUUID()}.${safeExt(data.filename, sniffed)}`;
    try {
      await uploadToAttachmentsBucket({ objectPath, bytes: buf, mime: sniffed });
    } catch (err) {
      // Storage 실패는 쿼터를 되돌리지 않는다(재시도 폭발 방지) — 사용량이 남는 보수 설계.
      logger.warn(`attachments Storage 업로드 실패: ${(err as Error).message}`);
      throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '파일 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }

    const sha256 = createHash('sha256').update(buf).digest('hex');
    const { data: row, error: insErr } = await request.db.from('messages_attachments').insert({
      message_id: null,
      uploader_id: request.userId,
      url: publicObjectUrl(objectPath),
      object_path: objectPath,
      mime: sniffed,
      size: buf.length,
      sha256,
      name: (data.filename || 'file').slice(0, 255),
    }).select().single();
    if (insErr || !row) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, insErr?.message || '첨부 메타 저장 실패');

    return reply.status(201).send(ok({
      id: row.id,
      url: row.url,
      object_path: row.object_path,
      mime: row.mime,
      size: row.size,
      sha256: row.sha256,
      name: row.name,
    }));
  });
}
