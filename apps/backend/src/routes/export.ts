// 카드 내보내기 라우트 (t_3116c5bc) — GET /api/messages/:id/export?fmt=pdf|docx|xlsx|hwp
// 카드 단위(per-card) 내보내기: 해당 메시지(카드) 1개 + 답글 스레드 메타를 문서로 굽는다.
// 서식: docx/xlsx=수제 OOXML(zip.ts) — npm docx/sheetjs는 이 환경의 설치 스캔 차단으로 미설치,
//       순수 Node zlib 구현으로 대체(같은 JS 쪽, python 금지 좌표는 유지). 검증은 라운드트립 테스트.
//   pdf=print-css HTML→headless chrome(exportPdf.ts, 엔진 없으면 EXPORT_PDF_ENGINE_MISSING 503 정직 노출).
//   hwp=한글 필기 형식 생성은 스파이크 불가 판정(HWPPX는 OLE/OLE-CDF复合 구조+ 전용 세그먼트 테이블 —
//       무의존 구현 비용 과대, 카드 좌표대로 .docx + 'HWP에서 열기' 안내 메타로 정직 폴백. 없는 기능 있는 척 금지).
// 파일명: {세션제목}_{카드요약}_{fmt}.{ext} ko 안전 문자 치환 (contentDisposition RFC 5987).
// 소유권: getOwnedMessage — 내 세션이 아니면 404 (존재 숨김, messages 라우트와 동일 원칙).
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ApiError, ERROR_CODES } from '../lib/errors';
import { getOwnedMessage, selectAllRows } from '../lib/helpers';
import { MessagesRow } from '../types/db';
import { buildExportDocument } from '../lib/exportDoc';
import { renderDocx, renderHtml, renderJson, renderMarkdown, renderXlsx } from '../lib/exportFormats';
import { htmlToPdf } from '../lib/exportPdf';

const FORMATS = ['pdf', 'docx', 'xlsx', 'hwp', 'md', 'html', 'json'] as const;
type Format = (typeof FORMATS)[number];

/** 표 카드만 xlsx 허용 (카드 좌표: 'Excel(.xlsx, 표 카드만)'). */
export const isTableCard = (row: MessagesRow): boolean => {
  const t = String(row.dialogue_type ?? '');
  return t === 'spreadsheet' || t === 'chart';
};

/** 파일명 안전화 — 한글은 보존(RFC5987 filename*), ASCII 폴백용 치환은 제거하지 말고 변환. */
export function safeName(value: string, max = 48): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/:*?"<>|#%&+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim() || 'card';
}

export function exportFilename(sessionTitle: string, cardSummary: string, fmt: string): string {
  return `${safeName(sessionTitle, 40)}_${safeName(cardSummary, 40)}_${fmt}`;
}

/** RFC 5987 — ASCII 폴백(로마자 치환) + filename* UTF-8 원문. 확장자는 fmt와 동일. */
export function contentDisposition(base: string, ext: string): string {
  const leaf = `${base}.${ext}`;
  const ascii = base.replace(/[^\x20-\x7e]/g, '').replace(/["\\;]/g, '').trim().slice(0, 100) || 'card-export';
  return `attachment; filename="${safeName(ascii, 100)}.${ext}"; filename*=UTF-8''${encodeURIComponent(leaf)}`;
}

const MIME: Partial<Record<Format, string>> = {
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  hwp: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // 정직 폴백: .docx 바이트
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
  pdf: 'application/pdf',
};

export async function exportRoutes(app: FastifyInstance) {
  app.get('/:id/export', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { fmt?: string };
    const format = (query.fmt ?? 'pdf') as Format;
    if (!FORMATS.includes(format)) throw new ApiError('EXPORT_FORMAT_UNSUPPORTED', `지원하지 않는 서식입니다. (${FORMATS.join('|')})`);

    const { message, session } = await getOwnedMessage(request.db, request.userId, id);
    if (format === 'xlsx' && !isTableCard(message)) throw new ApiError('EXPORT_FORMAT_UNSUPPORTED', 'Excel 내보내기는 표 형태 카드(스프레드시트·차트)에서만 지원돼요.');

    // 카드 본문 + 답글(있으면 부록) — readThread와 동일 좌표: 자기 자신을 root로 삼는 답글까지 수집
    const replies = (await selectAllRows(request.db, 'messages', { session_id: message.session_id, root_message_id: message.root_message_id || message.id })) as MessagesRow[];
    const rows = [message, ...replies.filter((r) => r.id !== message.id)].sort((a, b) => a.turn_index - b.turn_index);

    const sessionTitle = (session as { title?: string; metadata?: { title?: string } }).title
      || (session.metadata as { title?: string } | null)?.title || 'MyAgentTalk';
    const payload = (message.structured_payload ?? {}) as { title?: unknown; name?: unknown };
    const cardSummary = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title
      : typeof payload.name === 'string' && payload.name.trim() ? payload.name : (message.content || '').slice(0, 40);
    const doc = buildExportDocument({
      rows, sessionId: message.session_id, title: `${sessionTitle} — ${cardSummary || '카드'}`,
      favoritesOnly: false, exportedAt: new Date().toISOString(),
    });

    // hwp 정직 폴백 — 문서 끝에 'HWP에서 열기' 안내 메타 블록 추가 (.docx 바이트로 서빙)
    const hwpGuide = format === 'hwp'
      ? '\n\n※ 이 파일은 한글(HWP) 호환 안내용 Word 문서(.docx)입니다. 한글 2010 이상에서 [파일 → 열기 → 문서]로 열면 서식이 유지돼요.'
      : '';
    if (hwpGuide) doc.messages.push({ id: 'hwp-guide', role: 'system', author: 'system', aiGenerated: false, time: doc.exportedAt, dialogueType: 'text', blocks: [{ kind: 'paragraph', text: hwpGuide.trim() }] });
    doc.messageCount += hwpGuide ? 1 : 0;

    const ext = format === 'hwp' ? 'docx' : format;
    reply.header('Content-Disposition', contentDisposition(exportFilename(sessionTitle, cardSummary, format), ext));
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Export-Count', String(doc.messageCount));
    if (hwpGuide) reply.header('X-Hwp-Fallback', 'docx'); // 프론트가 'HWP 호환 = Word 파일' 고지 가능

    if (format === 'md') return reply.type(MIME.md!).send(renderMarkdown(doc));
    if (format === 'json') return reply.type(MIME.json!).send(renderJson(doc));
    if (format === 'html') return reply.type(MIME.html!).send(renderHtml(doc));
    if (format === 'docx' || format === 'hwp') return reply.type(MIME[format]!).send(renderDocx(doc));
    if (format === 'xlsx') return reply.type(MIME.xlsx!).send(renderXlsx(doc));
    try {
      const pdf = await htmlToPdf(renderHtml(doc, { print: true }));
      return reply.type(MIME.pdf!).send(pdf);
    } catch (err) {
      if ((err as Error).message === 'PDF_ENGINE_MISSING') throw new ApiError('EXPORT_PDF_ENGINE_MISSING', '이 서버에는 PDF 변환 엔진이 없어요. HTML로 내보낸 뒤 브라우저에서 인쇄/저장해 주세요.');
      if ((err as Error).message === 'PDF_OUTPUT_INVALID') throw new ApiError(ERROR_CODES.INTERNAL_ERROR, 'PDF 변환에 실패했습니다.');
      throw new ApiError(ERROR_CODES.INTERNAL_ERROR, `PDF 변환에 실패했습니다. (${(err as Error).message.slice(0, 120)})`);
    }
  });
}
