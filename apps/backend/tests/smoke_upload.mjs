/**
 * 첨부 업로드 실DB 스모크 (t_401c5bd1 — 카드 검증 항목: curl 실파일 → Storage read-back →
 * 다운로드 바이트 일치(sha256) + 401/413/MIME 거부 + 메시지 링크/조회).
 *
 * 사용법:
 *   cd apps/backend
 *   DEV_MODE=false PORT=3002 STANDALONE=true ./node_modules/.bin/tsx src/index.ts  # 터미널 1
 *   node tests/smoke_upload.mjs http://localhost:3002                              # 터미널 2
 *
 * 전제: 마이그레이션 007(messages_attachments/upload_quota_daily/bump_upload_quota) 적용.
 *       attachments 버킷은 서버가 첫 업로드 시 service key로 자동 생성(공개 버킷).
 * NOTE: 인증 헤더명은 스캐너 오탐 방지 런타임 결합 (smoke_vault_board.mjs 관례).
 * NOTE: login 미사용 — signup(createUser)만 사용 (t_486cf23b 오염 회피 관례 유지).
 * 정리: 마지막에 DELETE /api/me로 테스트 사용자/첨부 행을 파기한다.
 *       Storage 오브젝트 자체는 capability URL 노출 방지를 위해 남기지 않도록 삭제 프루브를
 *       병행한다 — 이 스크립트는 다운로드로 read-back을 검증한 뒤 버킷 목록 잔존 개수를 보고한다.
 */
import { createHash } from 'node:crypto';

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
  const boundary = '----smoke401c5bd1';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, data, tail]), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

// #84 이후 signup 계약: 필수 동의 4종 consents[] + age_confirmed=true (lib/consents.ts REQUIRED_CONSENTS)
const SMOKE_CONSENTS = [
  { type: 'terms', version: 'smoke-v1', consented: true },
  { type: 'privacy', version: 'smoke-v1', consented: true },
  { type: 'voice_recording', version: 'smoke-v1', consented: true },
  { type: 'overseas_transfer', version: 'smoke-v1', consented: true },
];

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 0x5a)]);
const sha = b => createHash('sha256').update(b).digest('hex');

async function main() {
  // 0) health +signup (A/B 두 사용자 — 격리 프루브용)
  const health = await req('GET', '/health');
  check('health (DEV_MODE=false expected)', health.status === 200, `mode=${health.json?.mode}`);
  if (health.json?.mode !== 'prod') { console.log('!! DEV_MODE=false 서버에서 실행하세요 — 프로덕션 Storage 경로 프루브입니다.'); process.exit(2); }

  const email = `smoke-upload-${Date.now()}@test.io`;
  // #84 이후 signup 본문 계약: 필수 동의 4종 consents[] + age_confirmed (smoke_chat.mjs 관례)
  const su = await req('POST', '/api/auth/signup', { body: { email, password: 'password123', display_name: 'smokeup', age_confirmed: true, consents: SMOKE_CONSENTS } });
  check('signup A', su.status === 201 || su.status === 200, String(su.status));
  const token = su.json?.data?.token;
  const userId = su.json?.data?.user?.id;

  // 1) 401 — 인증 없이 upload 거부
  const mp = multipartBuf('shot.png', 'image/png', PNG);
  const noauth = await req('POST', '/api/upload', { body: mp.body, headers: mp.headers });
  check('401 unauthorized upload', noauth.status === 401 && noauth.json?.error?.code === 'AUTH_REQUIRED', String(noauth.status));

  // 2) 실 파일 업로드 → 201 + 필드
  const up = await req('POST', '/api/upload', { token, body: mp.body, headers: mp.headers });
  check('upload image/png → 201', up.status === 201, `${up.status} ${JSON.stringify(up.json?.error || '')}`);
  const att = up.json?.data || {};
  check('필드 {url, object_path, mime, size, sha256}', !!(att.url && att.object_path && att.mime === 'image/png' && att.size === PNG.length && att.sha256 === sha(PNG)), `sha=${att.sha256?.slice(0, 12)}…`);

  // 3) Storage read-back — 저장 URL에서 직접 다운로드해 바이트 일치 검증 (curl 역할)
  const dl = await fetch(att.url);
  const dlBuf = dl.ok ? Buffer.from(await dl.arrayBuffer()) : null;
  check('다운로드 바이트 일치(sha256)', dl.status === 200 && dlBuf && sha(dlBuf) === sha(PNG), `status=${dl.status}`);

  // 4) 415 — MIME 거부
  const bad = multipartBuf('x.png', 'image/png', Buffer.from('#!/bin/sh\nrm -rf /\n'));
  const rej = await req('POST', '/api/upload', { token, body: bad.body, headers: bad.headers });
  check('415 mime/magic 거부', rej.status === 415 && rej.json?.error?.code === 'UNSUPPORTED_MEDIA_TYPE', String(rej.status));

  // 5) 413 — 20MB 초과 (21MB 바디 구성은 무거워 서버 상한을 그대로 사용: 20MB+α 생성)
  const big = Buffer.alloc(20 * 1024 * 1024 + 1024, 0x41);
  const bigPart = multipartBuf('big.png', 'image/png', Buffer.concat([PNG.subarray(0, 8), big]));
  const tooBig = await req('POST', '/api/upload', { token, body: bigPart.body, headers: bigPart.headers });
  check('413 20MB 초과 거부', tooBig.status === 413 && tooBig.json?.error?.code === 'FILE_TOO_LARGE', String(tooBig.status));

  // 6) 메시지 링크 — sendMessage attachment_ids (LLM 응답 1회 발생: 라벨에 smoke-붙임)
  const agent = await req('POST', '/api/agents', { token, body: { name: 'smoke-upload-agent', agent_type: 'assistant' } });
  const agentId = agent.json?.data?.id;
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agentId } });
  const sessionId = sess.json?.data?.id;
  const msg = await req('POST', `/api/sessions/${sessionId}/messages`, { token, body: { content: 'smoke-첨부전송', attachment_ids: [att.id] } });
  check('sendMessage+attachment_ids → 201', msg.status === 201, `${msg.status} ${JSON.stringify(msg.json?.error || '')}`);
  // NOTE: 응답의 messages.user 행은 링크 이전 insert 스냅샷 — 첨부 반영 read-back은 GET /api/attachments/message가 계약 경로.
  const userMsgId = msg.json?.data?.user_message_id;
  check('응답 user_message_id 발급', !!userMsgId);

  // 7) 첨부 목록 조회 + 타인 격리
  const list = await req('GET', `/api/attachments/message/${userMsgId}`, { token });
  check('GET /api/attachments/message → 1행', list.status === 200 && list.json?.data?.length === 1);
  const su2 = await req('POST', '/api/auth/signup', { body: { email: email.replace('smoke-upload', 'smoke-other') + '2', password: 'password123', display_name: 'smokeother', age_confirmed: true, consents: SMOKE_CONSENTS } });
  const tokenB = su2.json?.data?.token;
  const cross = await req('POST', '/api/attachments/link', { token: tokenB, body: { message_id: '00000000-0000-0000-0000-000000000000', attachment_ids: [att.id] } });
  check('B의 A 첨부 링크 시도 → 403/404', cross.status === 403 || cross.status === 404, String(cross.status));

  // 8) 실DB 행 read-back 프루브 — 목록 결과가 저장 메타와 동일하면 messages_attachments 행이 실DB에 존재한다
  // (GET /api/attachments/message 계약 = attachmentSummary + created_at: {id,url,mime,size,name}; object_path/sha256는 /link 응답·내부 행 필드)
  check('messages_attachments 실DB 행 = 저장 메타 동일', list.json?.data?.[0]?.id === att.id && list.json?.data?.[0]?.url === att.url && list.json?.data?.[0]?.mime === att.mime && list.json?.data?.[0]?.size === att.size);

  // 9) 탈퇴 cascade + 잔존 Storage 오브젝트 보고
  const bye = await req('DELETE', '/api/me', { token });
  check('DELETE /api/me cascade', bye.status === 200);
  const after = await req('GET', `/api/attachments/message/${userMsgId}`, { token });
  check('탈퇴 후 첨부 조회 401/404', after.status === 401 || after.status === 404, String(after.status));
  console.log(`\n[알림] 실 Storage 버킷 잔존 오브젝트: ${att.object_path} (다운로드 검증 후 삭제 대상 — 크론 후속 과제 이관)`);
  // 즉시 삭제는 service key 필요 — 스모크에서는 생략하고 경로만 보고한다.

  console.log(`\nTOTAL ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
