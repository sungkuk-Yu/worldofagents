/**
 * photo_edit dialogue_type emission 라우팅 (t_78ffba4f, Wave 2 서버측).
 *
 * 검증 항목 (카드 검수 앙커 대응):
 *  - parsePhotoEditDirective/photoEditCardForTurn 순수 규칙 (펜스·좌표·주석·URL 방어)
 *  - 신휘경 DEV_MODE: 첨부 upload → photo_edit 지시 sendMessage → run.completed structured가
 *    photo_edit + 에이전트 답변 messages행 dialogue_type/structured_payload read-back
 *    (프론트 serializeMessage는 payload를 그대로 통과 — 2번 항목 계약 확인 포함)
 *  - 지시 없음 / 이미지 없음 턴은 무영향 (기존 file/text 분류 유지)
 * helpers.createTestApp은 모듈 싱글턴 app 재사용 — 파일당 1회만 build (attachments.test.ts 관례).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getStore } from '../../src/lib/devstore';
import { createTestApp, signup, createFullStack, bearer, closeTestApp, TestApp } from '../helpers';
import { parsePhotoEditDirective, photoEditCardForTurn } from '../../src/lib/photoEditCard';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngBytes = (extra = 32) => Buffer.concat([PNG_MAGIC, Buffer.alloc(extra, 0x7f)]);

// ── 순수 규칙 단위 ────────────────────────────────────────

describe('parsePhotoEditDirective — 펜스 추출/정규화', () => {
  it('프로듀서(buildEditMessage) 포맷 평면 펜스 → crop+annotations', () => {
    const content = [
      '이 부분을 옮겨줘',
      '```json',
      JSON.stringify({
        photo_edit: {
          edit_of: 'msg_123',
          crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
          annotations: [
            { type: 'pin', from: { x: 0.3, y: 0.3 } },
            { type: 'arrow', from: { x: 0.1, y: 0.1 }, to: { x: 0.9, y: 0.9 }, note: '여기서' },
            { type: 'arrow', from: { x: 0.2, y: 0.2 } }, // to 없음 → 드롭
          ],
        },
      }),
      '```',
    ].join('\n');
    const d = parsePhotoEditDirective(content);
    expect(d).toBeTruthy();
    expect(d!.crop).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(d!.annotations.length).toBe(2);
    expect(d!.annotations[1].note).toBe('여기서');
    expect(d!.editOf).toBe('msg_123');
    expect(d!.originalUrl).toBeNull();
  });

  it('전체 그대로 crop{x0,y0,w1,h1}과 빈 편집+URL 없음 → null (편집 없음 판정)', () => {
    const mk = (p: unknown) => '```json\n' + JSON.stringify({ photo_edit: p }) + '\n```';
    expect(parsePhotoEditDirective(mk({ crop: { x: 0, y: 0, w: 1, h: 1 }, annotations: [] }))).toBeNull();
    expect(parsePhotoEditDirective(mk({ crop: { x: 0, y: 0, w: 0.01, h: 0.5 }, annotations: [] }))).toBeNull();
  });

  it('비정상 입력은 전부 null — 파싱 실패/비사진 펜스/스크임 URL', () => {
    expect(parsePhotoEditDirective('사진이야')).toBeNull();
    expect(parsePhotoEditDirective('```json\n{broken\n```')).toBeNull();
    expect(parsePhotoEditDirective('```json\n{"chart":{"a":1}}\n```')).toBeNull();
    // crop 값 문자열 → 유닛 클램프가 0으로 싸고, 결과 편집 0 → URL도 없으면 null
    const d = parsePhotoEditDirective('```json\n' + JSON.stringify({ photo_edit: { crop: { x: 'a', y: 'b' } } }) + '\n```');
    expect(d).toBeNull(); // crop 전체-그대로 + annotations [] + URL 없음 → 편집 무 → null
    // credentials URL 스킴 차단
    const evil = parsePhotoEditDirective('```json\n' + JSON.stringify({ photo_edit: { original_url: 'http://evil@x.io/a.png', annotations: [{ type: 'pin', from: { x: 0.5, y: 0.5 } }] } }) + '\n```');
    expect(evil?.originalUrl).toBeNull();
    expect(evil?.annotations.length).toBe(1);
  });

  it('images[] 형태와 edited_url/url 별칭 통과 (#182 페이로드 허용 형태)', () => {
    const d = parsePhotoEditDirective('```json\n' + JSON.stringify({
      photo_edit: { images: [{ url: 'https://cdn.io/orig.png' }], url: 'https://cdn.io/edited.png' },
    }) + '\n```');
    expect(d?.originalUrl).toBe('https://cdn.io/orig.png');
    expect(d?.editedUrl).toBe('https://cdn.io/edited.png');
  });
});

describe('photoEditCardForTurn — 승격 조건', () => {
  const fence = (p: unknown) => '요청\n```json\n' + JSON.stringify({ photo_edit: p }) + '\n```';
  const img = [{ url: 'http://localhost:3000/api/attachments/object/abc/def.png', mime: 'image/png' }];

  it('지시+이미지 첨부 → photo_edit structured, original_url=첨부 URL', () => {
    const s = photoEditCardForTurn(fence({ crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, annotations: [] }), img);
    expect(s?.dialogue_type).toBe('photo_edit');
    expect(s?.structured_payload.original_url).toBe(img[0].url);
    expect(s?.structured_payload.crop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  });

  it('지시 있지만 이미지 첨부 없음/지시 URL 없음 → null (렌더 불능, 기존 경로 유지)', () => {
    expect(photoEditCardForTurn(fence({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }), [])).toBeNull();
    expect(photoEditCardForTurn(fence({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }), [{ url: 'x', mime: 'application/pdf' }])).toBeNull();
  });

  it('이미지 첨부 있지만 지시 펜스 없음 → null', () => {
    expect(photoEditCardForTurn('여기 사진 봐줘', img)).toBeNull();
  });
});

// ── 신휘경 E2E (upload → sendMessage → structured read-back) ───

let app: TestApp;
let tokenA: string;
let sessionA: { id: string };

function multipart(field: string, filename: string, contentType: string, data: Buffer) {
  const boundary = '----t78ffba4fboundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`, 'ascii');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'ascii');
  return {
    body: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function uploadPng(token: string) {
  const part = multipart('file', 'shot.png', 'image/png', pngBytes(48));
  const res = await app.inject({ method: 'POST', url: '/api/upload', headers: { ...bearer(token), ...part.headers }, payload: part.body });
  return res.json().data;
}

async function sendMessage(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/sessions/${sessionA.id}/messages`, headers: bearer(tokenA), payload });
}

beforeAll(async () => {
  app = await createTestApp();
  const a = await signup(app, 'peA@test.io');
  tokenA = a.token;
  ({ session: sessionA } = await createFullStack(app, tokenA));
});
afterAll(async () => { await closeTestApp(app); });

describe('photo_edit emission — 신휘경 턴 (카드 검수 앙커)', () => {
  it('첨부+펜스 전송 → run.completed structured=photo_edit, 에이전트 행 dialogue_type read-back', async () => {
    const att = await uploadPng(tokenA);
    const content = [
      '이 부분 잘라줘',
      '```json',
      JSON.stringify({ photo_edit: { edit_of: null, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, annotations: [{ type: 'pin', from: { x: 0.5, y: 0.5 } }] } }),
      '```',
    ].join('\n');
    const res = await sendMessage({ content, attachment_ids: [att.id] });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;

    // ① REST 응답 structured (run.completed 동일 페이로드)
    expect(data.structured.dialogue_type).toBe('photo_edit');
    expect(data.structured.structured_payload.original_url).toBe(att.url);
    expect(data.structured.structured_payload.crop).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(data.structured.structured_payload.annotations.length).toBe(1);

    // ② agents answer 메시지 행 영속화 read-back (serializeMessage 계약: payload 그대로 통과 — 2번 항목)
    const answerId = data.answer_message_id;
    expect(answerId).toBeTruthy();
    const row = getStore().tables.messages.find(m => m.id === answerId)!;
    expect(row.dialogue_type).toBe('photo_edit');
    expect((row.structured_payload as any).original_url).toBe(att.url);

    // ③ GET 목록 경로 — 프론트가 실제로 읽는 serializeMessage 출력
    const list = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/messages`, headers: bearer(tokenA) });
    const agentMsg = list.json().data.find((m: any) => m.id === answerId);
    expect(agentMsg.dialogue_type).toBe('photo_edit');
    expect(agentMsg.structured_payload.crop).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });

  it('무펜스 첨부 전송 → photo_edit 승격 없음 (기존 file 분류 유지, 회귀 가드)', async () => {
    const att = await uploadPng(tokenA);
    const res = await sendMessage({ content: '여기 사진 봐줘', attachment_ids: [att.id] });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.structured.dialogue_type).not.toBe('photo_edit');
  });

  it('펜스+이미지 첨부 없음 → 승격 없음', async () => {
    const content = '```json\n' + JSON.stringify({ photo_edit: { crop: { x: 0, y: 0, w: 0.5, h: 0.5 } } }) + '\n```';
    const res = await sendMessage({ content });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.structured.dialogue_type).not.toBe('photo_edit');
  });

  it('user message에 지시 재현용 첨부 요약 유지 (PhotoEditCard 펜스 경로 무영향 확인)', async () => {
    const att = await uploadPng(tokenA);
    const content = '```json\n' + JSON.stringify({ photo_edit: { annotations: [{ type: 'text', from: { x: 0.4, y: 0.4 }, note: '여기' }] } }) + '\n```';
    const res = await sendMessage({ content, attachment_ids: [att.id] });
    const data = res.json().data;
    expect(data.messages.user.attachments[0].id).toBe(att.id);
    expect(data.structured.dialogue_type).toBe('photo_edit');
    expect((data.structured.structured_payload.annotations as any[])[0].note).toBe('여기');
  });
});
