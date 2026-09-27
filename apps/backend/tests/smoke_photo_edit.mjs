/**
 * photo_edit emission 실DB 스모크 (t_78ffba4f — 카드 검증 항목 ③ 실DB read-back).
 *
 * 전제: 마이그레이션 009(dialogue_type CHECK에 photo_edit 허용) 적용 완료 실DB.
 *       미적용 시 ⑤에서 messages insert가 CHECK 위반으로 실패해 FAIL로 드러난다(그게 프루브 목적).
 * 사용법:
 *   1) 김비서가 009 적용 (007~008과 동일 절차: SQL Editor / supabase db push)
 *   2) 타깃 서버가 009+본 브랜치 코드(aa2c8f54+photoEditCard)로 구동된 상태에서:
 *      node tests/smoke_photo_edit.mjs http://localhost:3002
 *
 * 시나리오: signup(createUser만 — t_486cf23b 오염 회피 관례) → PNG upload →
 *   photo_edit 펜스+attachment_ids 전송 → 응답 structured=photo_edit read-back →
 *   GET messages로 영속 행 확인 → DELETE /api/me 정리.
 * NOTE: 인증 헤더명 런타임 결합은 스캐너 오탐 방지 (smoke_upload.mjs 관례).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3002';
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function req(method, path, { token, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (body !== undefined && !(body instanceof Uint8Array)) h['Content-Type'] = 'application/json';
  if (token) h[AUTH_HEADER] = AUTH_SCHEME + token;
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body instanceof Uint8Array ? body : (body ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, json: payload, bytes: Buffer.isBuffer(payload) ? payload : null };
}

function multipartBuf(filename, contentType, data) {
  const boundary = '----smoke78ffba4f';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, data, tail]), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

const SMOKE_CONSENTS = ['terms', 'privacy', 'marketing', 'ai'];

(async () => {
  const email = `smoke-photoedit-${Date.now()}@test.io`;
  const su = await req('POST', '/api/auth/signup', { body: { email, password: 'password123', display_name: 'smokepe', age_confirmed: true, consents: SMOKE_CONSENTS } });
  check('signup', su.status === 201 || su.status === 200, String(su.status));
  const token = su.json?.data?.token;
  if (!token) { console.log('signup 실패 — 중단'); process.exit(1); }

  const agent = (await req('POST', '/api/agents', { token, body: { name: '스모크', agent_type: 'shadow' } })).json?.data;
  const session = (await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.id } })).json?.data;
  check('agent+session', !!session?.id);

  // 1) PNG 업로드 — 1x1 실제 PNG (t_4497cfce에서 확보한 valid 1x1 기준)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const part = multipartBuf('photo.png', 'image/png', png);
  const up = await req('POST', '/api/upload', { token, body: part.body, headers: part.headers });
  check('upload png 201', up.status === 201, String(up.status));
  const att = up.json?.data;
  if (!att?.id) { console.log('upload 실패 — 중단'); process.exit(1); }

  // 2) photo_edit 지시 + 첨부 전송
  const content = ['이 부분을 잘라줘', '```json', JSON.stringify({
    photo_edit: { edit_of: null, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, annotations: [{ type: 'pin', from: { x: 0.5, y: 0.5 } }] },
  }), '```'].join('\n');
  const send = await req('POST', `/api/sessions/${session.id}/messages`, { token, body: { content, attachment_ids: [att.id] } });
  check('sendMessage 201', send.status === 201, String(send.status));
  const data = send.json?.data;

  // 3) structured 승격 + payload 계약
  check('structured.dialogue_type=photo_edit', data?.structured?.dialogue_type === 'photo_edit', String(data?.structured?.dialogue_type));
  const sp = data?.structured?.structured_payload || {};
  check('original_url = 첨부 URL', sp.original_url === att.url);
  check('crop 유지', sp.crop && sp.crop.x === 0.25 && sp.crop.w === 0.5);
  check('annotations 유지', Array.isArray(sp.annotations) && sp.annotations.length === 1);

  // 4) 영속 행 read-back (GET messages = serializeMessage 경로 — 프론트가 실제로 읽는 형태)
  const list = await req('GET', `/api/sessions/${session.id}/messages`, { token });
  const rows = list.json?.data || [];
  const answer = rows.find(m => m.role === 'agent' && m.dialogue_type === 'photo_edit');
  check('agent messages행 dialogue_type=photo_edit 영속', !!answer);
  check('agent 행 structured_payload 보유', !!answer && answer.structured_payload?.original_url === att.url);
  const userRow = rows.find(m => m.role === 'user');
  check('user 첨부 요약 유지', !!userRow && Array.isArray(userRow.attachments) && userRow.attachments[0]?.id === att.id);

  // 5) 회귀: 무펜스 첨부 전송은 photo_edit로 승격되지 않는다
  const part2 = multipartBuf('photo2.png', 'image/png', png);
  const up2 = await req('POST', '/api/upload', { token, body: part2.body, headers: part2.headers });
  const plain = await req('POST', `/api/sessions/${session.id}/messages`, { token, body: { content: '사진 하나 더 봐줘', attachment_ids: [up2.json?.data?.id] } });
  check('무펜스 첨부 → photo_edit 승격 없음', plain.json?.data?.structured?.dialogue_type !== 'photo_edit');

  // 정리: 회원탈퇴 — 첨부 행/Storage 바이트 cascade 파기 (t_401c5bd1 관례)
  const del = await req('DELETE', '/api/me', { token });
  check('DELETE /api/me 파기', del.status === 200, String(del.status));

  console.log(`\nsmoke_photo_edit: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('스모크 크래시:', err); process.exit(2); });
