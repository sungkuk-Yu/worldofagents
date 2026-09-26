/**
 * 첨부 업로드/링크 단위 테스트 (t_401c5bd1, DEV_MODE 인메모리).
 *
 * 카드 검증 항목 매핑:
 *   - 401/413/MIME 거부/쿼터 429  → 업로드 거부 그룹
 *   - curl 실파일 → read-back → sha256 일치 → 업로드 후 메타 행 + /object 바이트 sha256 대조
 *   - 메시지 링크/소유 격리         → 링크 그룹 (B의 A 첨부 접근 404, 이중 링크 409)
 * helpers.createTestApp은 모듈 싱글턴 app 재사용 — 파일당 1회만 build (isolation.test.ts 관례).
 * 프로덕션 Storage 경로(실버킷 read-back)는 tests/smoke_upload.mjs가 DEV_MODE=false로 수행.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { config } from '../../src/config';
import { getStore } from '../../src/lib/devstore';
import { createTestApp, signup, createFullStack, bearer, closeTestApp, TestApp } from '../helpers';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngBytes = (extra = 32) => Buffer.concat([PNG_MAGIC, Buffer.alloc(extra, 0x7f)]);
const pdfBytes = () => Buffer.concat([Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'), Buffer.alloc(48, 0x20)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let app: TestApp;
let tokenA: string, userIdA: string, sessionA: { id: string };
let tokenB: string, userIdB: string;
let tokenC: string, userIdC: string;

beforeAll(async () => {
  app = await createTestApp();
  const a = await signup(app, 'upA@test.io');
  tokenA = a.token; userIdA = a.userId;
  ({ session: sessionA } = await createFullStack(app, tokenA));
  const b = await signup(app, 'upB@test.io');
  tokenB = b.token; userIdB = b.userId;
  const c = await signup(app, 'upC@test.io');
  tokenC = c.token; userIdC = c.userId;
});
afterAll(async () => { await closeTestApp(app); });

function multipart(field: string, filename: string, contentType: string, data: Buffer) {
  const boundary = '----t401c5bd1boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`, 'ascii');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'ascii');
  return {
    body: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(token: string, buf: Buffer, opts: { name?: string; type?: string } = {}) {
  const part = multipart('file', opts.name || 'shot.png', opts.type || 'image/png', buf);
  return app.inject({ method: 'POST', url: '/api/upload', headers: { ...bearer(token), ...part.headers }, payload: part.body });
}

async function sendMessage(token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/sessions/${sessionA.id}/messages`, headers: bearer(token), payload });
}

describe('/api/upload — 첨부 업로드 (t_401c5bd1)', () => {
  it('401 — 인증 없이 거부', async () => {
    const part = multipart('file', 'x.png', 'image/png', pngBytes());
    const res = await app.inject({ method: 'POST', url: '/api/upload', headers: part.headers, payload: part.body });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('multipart가 아니면 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/upload', headers: { ...bearer(tokenA), 'content-type': 'application/json' }, payload: '{}' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('성공: 201 + {url, object_path, mime, size, sha256} + 메타 행 + /object 바이트 read-back sha256 일치', async () => {
    const bytes = pngBytes(64);
    const res = await upload(tokenA, bytes);
    expect(res.statusCode).toBe(201);
    const d = res.json().data;
    expect(d.id).toBeTruthy();
    expect(d.mime).toBe('image/png');
    expect(d.size).toBe(bytes.length);
    expect(d.sha256).toBe(sha(bytes));
    expect(d.object_path).toMatch(/^[0-9a-f]{12}\/[0-9a-f-]{36}\.png$/);
    expect(d.url).toContain(`/api/attachments/object/${d.object_path}`); // dev: 백엔드 경유 URL

    // 메타 행 read-back (messages_attachments, 미링크=message_id NULL)
    const row = getStore().tables.messages_attachments.find(r => r.id === d.id);
    expect(row).toBeTruthy();
    expect(row!.uploader_id).toBe(userIdA);
    expect(row!.message_id).toBeNull();
    expect(row!.deleted_at ?? null).toBeNull();

    // 바이트 서빙 read-back (다운로드 sha256 = 업로드 sha256)
    const dl = await app.inject({ method: 'GET', url: `/api/attachments/object/${d.object_path}` });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(sha(dl.rawPayload)).toBe(d.sha256);
    expect(Buffer.compare(dl.rawPayload, bytes)).toBe(0);
  });

  it('PDF 허용 (magic-byte + 선언 MIME)', async () => {
    const res = await upload(tokenA, pdfBytes(), { name: 'doc.pdf', type: 'application/pdf' });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.mime).toBe('application/pdf');
  });

  it('413 — maxBytes 초과 (파일당 상한)', async () => {
    config.upload.maxBytes = 16;
    try {
      const res = await upload(tokenA, pngBytes(64));
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('FILE_TOO_LARGE');
    } finally {
      config.upload.maxBytes = 20 * 1024 * 1024;
    }
  });

  it('415 — MIME allowlist 거부 (선언 MIME + magic-byte 위장 양방향)', async () => {
    // 각본 텍스트를 image/png로 선언 → sniff 실패
    const fake = await upload(tokenA, Buffer.from('#!/bin/sh\necho pwn\n'), { name: 'x.sh', type: 'image/png' });
    expect(fake.statusCode).toBe(415);
    expect(fake.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    // 실제 PNG이지만 선언 MIME이 text/plain → allowlist 실패
    const mis = await upload(tokenA, pngBytes(8), { name: 'x.png', type: 'text/plain' });
    expect(mis.statusCode).toBe(415);
    // ELF 헤더를 image/png로 위장 → sniff 실패
    const exe = await upload(tokenA, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]), { name: 'x.png', type: 'image/png' });
    expect(exe.statusCode).toBe(415);
  });

  it('429 — 사용자당 UTC 일일 쿼터 (B 한도소진, A/C 무영향)', async () => {
    config.upload.maxPerDay = 2;
    try {
      expect((await upload(tokenB, pngBytes(8))).statusCode).toBe(201);
      expect((await upload(tokenB, pngBytes(8))).statusCode).toBe(201);
      const third = await upload(tokenB, pngBytes(8));
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('UPLOAD_QUOTA_EXCEEDED');
      // 다른 사용자는 별도 쿼터
      expect((await upload(tokenC, pngBytes(8))).statusCode).toBe(201);
      // 쿼터 행 read-back: B는 2로 정지(거부 분은 증가 없음)
      const day = new Date().toISOString().slice(0, 10);
      const rowB = getStore().tables.upload_quota_daily.find(r => r.day === day && r.user_id === userIdB);
      expect(rowB!.used).toBe(2);
    } finally {
      config.upload.maxPerDay = 50;
    }
  });

  it('경로 탈출/이상 파일명 → uuid 경제로 정규화 (확장자만 반영)', async () => {
    const res = await upload(tokenA, pngBytes(8), { name: '../../etc/passwd.png', type: 'image/png' });
    expect(res.statusCode).toBe(201);
    const p = res.json().data.object_path as string;
    expect(p).not.toContain('..');
    expect(p.endsWith('.png')).toBe(true);
  });
});

describe('첨부↔메시지 링크 (attachment_ids / /api/attachments)', () => {
  it('sendMessage attachment_ids → 링크 + messages.attachments 요약 + 목록 엔드포인트', async () => {
    const up = await upload(tokenA, pngBytes(20));
    const att = up.json().data;
    const res = await sendMessage(tokenA, { content: '여기 사진 봐줘', attachment_ids: [att.id] });
    expect(res.statusCode).toBe(201);
    const userMsg = res.json().data.messages.user;
    expect(Array.isArray(userMsg.attachments)).toBe(true);
    expect(userMsg.attachments[0]).toMatchObject({ id: att.id, url: att.url, mime: 'image/png', size: att.size });

    // messages_attachments.message_id 반영 read-back
    const row = getStore().tables.messages_attachments.find(r => r.id === att.id);
    expect(row!.message_id).toBe(userMsg.id);

    const list = await app.inject({ method: 'GET', url: `/api/attachments/message/${userMsg.id}`, headers: bearer(tokenA) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].id).toBe(att.id);
  });

  it('타인 첨부 ID 심기 → 404 + user 메시지 미생성 (비용/고아행 차단)', async () => {
    const upC = await upload(tokenC, pngBytes(20));
    const cAtt = upC.json().data.id;
    const before = getStore().tables.messages.length;
    const bad = await sendMessage(tokenA, { content: '남의 첨부 링크 시도', attachment_ids: [cAtt] });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().error.code).toBe('NOT_FOUND');
    // 선검증 실패 → 턴 미실행: 이 content의 user 메시지도, 그 턴의 어떤 메시지도 증가하지 않는다
    expect(getStore().tables.messages.filter(m => m.content === '남의 첨부 링크 시도').length).toBe(0);
    expect(getStore().tables.messages.length).toBe(before);
    // C 첨부 ID를 B가 링크 시도 → 404 (소유 검증)
    const link = await app.inject({ method: 'POST', url: '/api/attachments/link', headers: bearer(tokenB), payload: { message_id: '00000000-0000-0000-0000-000000000000', attachment_ids: [cAtt] } });
    expect(link.statusCode).toBe(404);
  });

  it('이중 링크 거부 (같은 첨부 두 메시지) — 409', async () => {
    const up = await upload(tokenA, pngBytes(20));
    const att = up.json().data;
    const first = await sendMessage(tokenA, { content: '첫 첨부 사용', attachment_ids: [att.id] });
    expect(first.statusCode).toBe(201);
    const second = await sendMessage(tokenA, { content: '두 번째 재사용', attachment_ids: [att.id] });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CONFLICT');
    // 재사용 거부 시 두 번째 메시지는 생성되지 않는다
    expect(getStore().tables.messages.some(m => m.content === '두 번째 재사용')).toBe(false);
  });

  it('POST /api/attachments/link 수동 링크 (전송 후 재시도 시나리오) + 검증 실패 400', async () => {
    const up = await upload(tokenA, pngBytes(20));
    const att = up.json().data;
    const msg = await sendMessage(tokenA, { content: '나중에 첨부 붙임' });
    const mid = msg.json().data.messages.user.id;
    const link = await app.inject({ method: 'POST', url: '/api/attachments/link', headers: bearer(tokenA), payload: { message_id: mid, attachment_ids: [att.id] } });
    expect(link.statusCode).toBe(200);
    expect(link.json().data[0].id).toBe(att.id);
    // attachments JSONB 동기화 (히스토리 조회에 요약 노출)
    const hist = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/messages`, headers: bearer(tokenA) });
    const target = hist.json().data.find((m: { id: string }) => m.id === mid);
    expect(target.attachments.map((a: { id: string }) => a.id)).toEqual([att.id]);
    // 검증: attachment_ids 빈 배열 → 400
    const bad = await app.inject({ method: 'POST', url: '/api/attachments/link', headers: bearer(tokenA), payload: { message_id: mid, attachment_ids: [] } });
    expect(bad.statusCode).toBe(400);
  });

  it('attachment_ids 포맷 검증 (문자열 배열/개수 상한)', async () => {
    const junk = await sendMessage(tokenA, { content: '형식 오류', attachment_ids: 'not-an-array' });
    expect(junk.statusCode).toBe(400);
    expect(junk.json().error.code).toBe('VALIDATION_ERROR');
    const tooMany = await sendMessage(tokenA, { content: '개수 초과', attachment_ids: Array.from({ length: 11 }, (_, i) => `x-${i}`) });
    expect(tooMany.statusCode).toBe(400);
  });

  it('WS message.send attachment_ids — protocol/handler 배선 정적 프루브 (실 연결 스모크는 ws 계열 별도)', async () => {
    // vitest cwd = apps/backend 루트. handler.ts가 message.attachment_ids를 parseAttachmentIds로
    // runTextTurn에 전달하는지, protocol 타입에 필드가 있는지 고정 (드래프트 방지).
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/websocket/handler.ts', 'utf8');
    expect(src).toContain('attachmentIds: parseAttachmentIds(message)');
    const proto = fs.readFileSync('src/websocket/protocol.ts', 'utf8');
    expect(proto).toContain('attachment_ids?: string[]');
  });
});

describe('회원탈퇴 cascade (DEV_MODE)', () => {
  it('B의 첨부 행+바이트 즉시 파기, A/C 첨부·바이트 보존', async () => {
    const up = await upload(tokenB, pngBytes(20));
    const att = up.json().data;
    const aPaths = getStore().tables.messages_attachments.filter(r => r.uploader_id === userIdA).map(r => r.object_path);
    const cRowsBefore = getStore().tables.messages_attachments.filter(r => r.uploader_id === userIdC).length;
    const bye = await app.inject({ method: 'DELETE', url: '/api/me', headers: bearer(tokenB) });
    expect(bye.statusCode).toBe(200);
    expect(getStore().tables.messages_attachments.some(r => r.uploader_id === userIdB)).toBe(false);
    expect(getStore().blobs.has(att.object_path)).toBe(false);
    // A/C의 첨부 행·바이트는 무영향 (동일 스토어 내 교차 보존 확인)
    expect(getStore().tables.messages_attachments.filter(r => r.uploader_id === userIdC).length).toBe(cRowsBefore);
    for (const p of aPaths) expect(getStore().blobs.has(p)).toBe(true);
  });
});
