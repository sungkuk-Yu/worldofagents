/**
 * 카드 내보내기 단위 테스트 (t_3116c5bc).
 * 검증: GET /api/messages/:id/export — 서식 4종+α 실바이트 출력, 소유권 404, 표 카드 외 xlsx 거부,
 *       미지원 fmt 400(EXPORT_FORMAT_UNSUPPORTED), 파일명/Content-Disposition RFC5987,
 *       docx/xlsx는 ZIP 유효성(中央 디렉토리 파싱) + PDF 엔진 있으면 %PDF- 시그니처.
 * 메시지 행은 favorites.test.ts와 동일하게 devstore 직접 insert (created_at 명시로 결정성).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, build } from '../../src/index';
import { signup, createFullStack, bearer } from '../helpers';
import { supabaseAdmin as db } from '../../src/lib/supabase';
import { safeName, exportFilename, contentDisposition } from '../../src/routes/export';

let token: string;
let stack: { agent: any; session: any };
let cardId: string;
let tableCardId: string;

async function seedMessage(turnIndex: number, extra: Record<string, unknown> = {}) {
  const { data, error } = await db.from('messages').insert({
    session_id: stack.session.id, turn_index: turnIndex, role: 'agent', message_type: 'card',
    content: `장문 콘텐츠 ${turnIndex} — 에이전트가 만든 카드 본문입니다.`, dialogue_type: 'info_card',
    structured_payload: { title: `주간 보고 ${turnIndex}`, fields: [{ label: '매출', value: '1,200만원' }, { label: '증감', value: '+12%' }] },
    source_neuron: 'answer', attachments: [], persona_guard: {}, user_feedback: null,
    locale: 'ko', ai_generated: true, favorite: false, created_at: `2026-09-27T0${turnIndex + 1}:00:00.000Z`, ...extra,
  }).select().single();
  expect(error).toBeNull();
  return data as any;
}

const get = (url: string) => app.inject({ method: 'GET', url, headers: bearer(token) });

/** 최소 ZIP 리더 — EOCD 시그니처를 역탐색한 뒤 중앙 디렉토리에서 항목을 찾아 디코딩(0=stored/8=deflate). */
function unzipText(buf: Buffer, name: string): string {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found — 잘못된 ZIP');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('bad central header');
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const entryName = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    if (entryName === name) {
      const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
      const data = buf.subarray(dataStart, dataStart + compSize);
      return (method === 0 ? data : require('zlib').inflateRawSync(data)).toString('utf8');
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip entry not found: ${name}`);
}

beforeAll(async () => {
  await build();
  const a = await signup(app, 'export@test.io');
  token = a.token;
  stack = await createFullStack(app, token);
  cardId = (await seedMessage(0)).id;
  tableCardId = (await seedMessage(1, {
    dialogue_type: 'spreadsheet',
    structured_payload: { title: '비용표', columns: ['항목', '금액'], rows: [['서버', 120], ['CDN', 30]] },
  })).id;
});

afterAll(async () => { await app.close(); });

describe('zip 라이브러리 (수제 OOXML 토대)', () => {
  it('crc32 표준 체크값과 파싱 가능한 중앙 디렉토리를 만든다', async () => {
    const { crc32, createZip } = await import('../../src/lib/zip');
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const buf = createZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/b.txt', data: Buffer.from('한글 내용입니다'), deflate: false },
    ]);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    // EOCD 스캔 후 중앙 디렉토리 항목 개수 검증
    const eocd = buf.subarray(buf.length - 22);
    expect(eocd.readUInt32LE(0)).toBe(0x06054b50);
    expect(eocd.readUInt16LE(10)).toBe(2);
  });
});

describe('파일명 규칙 ({세션제목}_{카드요약}_{fmt} — ko 안전 치환)', () => {
  it('경로 구분자·제어문자를 제거하고 한글은 보존한다', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>')).toBe('a b c d e f g h');
    expect(safeName('\n\t\r')).toBe('card');
    expect(safeName('가나다'.repeat(30), 40).length).toBeLessThanOrEqual(40);
    const fn = exportFilename('내 변호사와의 대화', '주간 보고', 'pdf');
    expect(fn).toBe('내 변호사와의 대화_주간 보고_pdf');
  });
  it('Content-Disposition은 ASCII 폴백 + UTF-8 filename*를 모두 담는다', () => {
    const cd = contentDisposition('보고서 1분기', 'docx');
    expect(cd).toContain('filename="');
    expect(cd).toContain('.docx"');
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).toContain(encodeURIComponent('보고서 1분기.docx'));
  });
});

describe('GET /api/messages/:id/export', () => {
  it('md — 제목/본문/ai 표기가 문서에 담긴다', async () => {
    const res = await get(`/api/messages/${cardId}/export?fmt=md`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.headers['content-disposition']).toContain('_md');
    const body = res.body;
    expect(body).toContain('주간 보고 0');
    expect(body).toContain('매출: 1,200만원');
    expect(body).toContain('Assistant');
    expect(res.headers['x-export-count']).toBe('1');
  });

  it('html — print CSS + 콘텐츠 보존, JSON — 원본 필드 보존', async () => {
    const html = await get(`/api/messages/${cardId}/export?fmt=html`);
    expect(html.statusCode).toBe(200);
    expect(html.body).toContain('<!DOCTYPE html>');
    expect(html.body).toContain('매출');
    const json = await get(`/api/messages/${cardId}/export?fmt=json`);
    const doc = json.json();
    expect(doc.messages[0].aiGenerated).toBe(true);
    expect(doc.messages[0].blocks.some((b: any) => b.kind === 'list')).toBe(true);
    expect(doc.title).toContain('주간 보고');
  });

  it('docx/xlsx — ZIP(PK) 서명 + OOXML 필수 파트 포함', async () => {
    const docx = await get(`/api/messages/${cardId}/export?fmt=docx`);
    expect(docx.statusCode).toBe(200);
    expect(docx.headers['content-type']).toContain('wordprocessingml');
    const dz = docx.rawPayload; // inject rawPayload — 바이너리 무손실 (res.body는 utf8 디코딩으로 손상 가능)
    expect(dz.subarray(0, 2).toString()).toBe('PK');
    expect(dz.subarray(0, 0).length).toBe(0);
    // 중앙 디렉토리에서 파트 이름 검색
    const asText = dz.toString('latin1');
    expect(asText).toContain('word/document.xml');
    expect(asText).toContain('[Content_Types].xml');

    const xlsx = await get(`/api/messages/${tableCardId}/export?fmt=xlsx`);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');

    // 표 카드 아니면 xlsx 거부 (카드 좌표: 'Excel(.xlsx, 표 카드만)')
    const reject = await get(`/api/messages/${cardId}/export?fmt=xlsx`);
    expect(reject.statusCode).toBe(400);
    expect(reject.json().error.code).toBe('EXPORT_FORMAT_UNSUPPORTED');
  });

  it('hwp — 없는 기능 있는 척 금지: .docx 폴백 + X-Hwp-Fallback + 안내 메타', async () => {
    const res = await get(`/api/messages/${cardId}/export?fmt=hwp`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-hwp-fallback']).toBe('docx');
    expect(res.headers['content-disposition']).toContain('_hwp.docx');
    const dz = res.rawPayload;
    expect(dz.subarray(0, 2).toString()).toBe('PK');
    expect(unzipText(dz, 'word/document.xml')).toContain('HWP'); // 안내 문구 블록이 문서에 실린다 (deflate 디코딩 후 검사)
  });

  it('pdf — 엔진 있으면 %PDF- 시그니처, 없으면 EXPORT_PDF_ENGINE_MISSING 정직 노출', async () => {
    const { findPdfEngine } = await import('../../src/lib/exportPdf');
    const res = await get(`/api/messages/${cardId}/export?fmt=pdf`);
    if (findPdfEngine()) {
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } else {
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('EXPORT_PDF_ENGINE_MISSING');
    }
  });

  it('미지원 서식 400 / 없는 메시지 404 / 타인 메시지 404 (소유권 숨김)', async () => {
    const bad = await get(`/api/messages/${cardId}/export?fmt=rtf`);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('EXPORT_FORMAT_UNSUPPORTED');
    const missing = await get(`/api/messages/00000000-0000-0000-0000-000000000000/export?fmt=md`);
    expect(missing.statusCode).toBe(404);
    const b = await signup(app, 'export-b@test.io');
    const foreign = await app.inject({ method: 'GET', url: `/api/messages/${cardId}/export?fmt=md`, headers: bearer(b.token) });
    expect(foreign.statusCode).toBe(404);
    const anon = await app.inject({ method: 'GET', url: `/api/messages/${cardId}/export?fmt=md` });
    expect(anon.statusCode).toBe(401);
  });

  it('답글이 있으면 스레드 전체가 문서에 들어간다 (root 카드 + reply)', async () => {
    const root = await seedMessage(5, { structured_payload: { title: '원안' } });
    await db.from('messages').insert({
      session_id: stack.session.id, turn_index: 6, role: 'user', message_type: 'text',
      content: '답글 테스트', parent_message_id: root.id, root_message_id: root.id,
      attachments: [], locale: 'ko', ai_generated: false, favorite: false,
      created_at: '2026-09-27T09:00:00.000Z',
    });
    const res = await get(`/api/messages/${root.id}/export?fmt=md`);
    expect(res.headers['x-export-count']).toBe('2');
    expect(res.body).toContain('답글 테스트');
  });
});
