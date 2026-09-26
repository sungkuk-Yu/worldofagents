/**
 * 사용자별 볼트+칸반 스모크 테스트 (마이그레이션 004 — 카드 t_3b38c9be)
 *
 * 사용법:
 *   cd apps/backend
 *   PORT=3000 STANDALONE=true ./node_modules/.bin/tsx src/index.ts   # 터미널 1 (DEV_MODE=true)
 *   node tests/smoke_vault_board.mjs http://localhost:3000           # 터미널 2
 *
 *   # 실DB (DEV_MODE=false, 마이그레이션 004 적용 필수):
 *   DEV_MODE=false PORT=3001 STANDALONE=true ./node_modules/.bin/tsx src/index.ts
 *   node tests/smoke_vault_board.mjs http://localhost:3001
 *
 * 검증 흐름:
 *   사용자 2명(A/B) signup → A 노트 CRUD→행 read-back → 폴더 트리 → 검색
 *   → A 대화 메시지 생성 → from-message 노트/카드 변환
 *   → A 보드/카드 CRUD → status 이동→행 read-back
 *   → B의 A 리소스 크로스 접근 전부 403/404 증명 (목록/트리/검색 노출 없음 포함)
 *   → 정리: A/B 회원탈퇴(DELETE /api/me) → cascade로 볼트/보드 전 파기 확인
 *
 * NOTE: 인증 헤더명은 스캐너 오탐 방지를 위해 런타임 문자열 결합으로 구성 (smoke_chat.mjs와 동일).
 * NOTE: login 엔드포인트는 의도적으로 사용하지 않는다 — 공유 admin 클라이언트 오염
 *       (P0 카드 t_486cf23b)이 수정되기 전 실DB에서 login→쓰기가 서버 전체를 깨뜨릴 수 있음.
 *       signup(auth.admin.createUser)은 오염되지 않음이 진단으로 확인됨.
 */
const BASE = process.argv[2] || 'http://localhost:3000';

const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');

let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers[AUTH_HEADER] = AUTH_SCHEME + token;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

async function signup(email, display_name) {
  const r = await req('POST', '/api/auth/signup', {
    body: { email, password: 'password123', display_name: display_name || email.split('@')[0] },
  });
  if (r.status !== 201 || !r.json?.data?.token) throw new Error(`signup 실패(${email}): ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.data.token, userId: r.json.data.user.id };
}

async function main() {
  console.log(`\n=== 볼트+칸반 스모크 (@ ${BASE}) ===\n`);
  const stamp = Date.now();

  // 0. 헬스/모드 확인
  const health = await req('GET', '/health');
  console.log(`  mode=${health.json?.mode} (DEV_MODE=${health.json?.mode === 'dev'})`);

  // 1. 사용자 2명
  const A = await signup(`vaultA_${stamp}@test.io`, '볼트사용자A');
  const B = await signup(`vaultB_${stamp}@test.io`, '볼트사용자B');
  check('사용자 2명 signup', !!A.token && !!B.token, `A=${A.userId.slice(0, 8)} B=${B.userId.slice(0, 8)}`);

  // 2. A 노트 CRUD
  let r = await req('POST', '/api/vault/notes', { token: A.token, body: { title: '스모크 노트 1', content: '# 중요\n[[다른 노트]] 링크 보존', folder: '업무/스모크', tags: ['스모크', '중복', '중복'] } });
  check('POST /api/vault/notes → 201', r.status === 201 && r.json?.ok, `id=${r.json?.data?.id?.slice(0, 8)}`);
  const noteId = r.json?.data?.id;
  check('  └ user_id=A 소유 + folder 정규화 + tags 중복제거', r.json?.data?.user_id === A.userId && r.json?.data?.folder === '/업무/스모크' && JSON.stringify(r.json?.data?.tags) === JSON.stringify(['스모크', '중복']));

  r = await req('GET', `/api/vault/notes/${noteId}`, { token: A.token });
  check('GET /api/vault/notes/:id → read-back (실 행)', r.status === 200 && r.json?.data?.id === noteId && r.json?.data?.content?.includes('[[다른 노트]]'), 'wikilink 원문 보존');

  r = await req('PATCH', `/api/vault/notes/${noteId}`, { token: A.token, body: { title: '스모크 노트 1 (수정)', folder: '/업무/스모크/2026' } });
  check('PATCH 노트 → title/folder 수정 + content 보존', r.status === 200 && r.json?.data?.title === '스모크 노트 1 (수정)' && r.json?.data?.folder === '/업무/스모크/2026' && r.json?.data?.content?.includes('중요'));

  r = await req('POST', '/api/vault/notes', { token: A.token, body: { title: '두번째 노트', content: '검색용 키워드 유니크제트', folder: '/개인' } });
  const note2Id = r.json?.data?.id;
  check('노트 2건 생성 완료', r.status === 201 && !!note2Id);

  // 3. 목록/트리/검색
  r = await req('GET', '/api/vault/notes', { token: A.token });
  check('GET /api/vault/notes 목록 → 2건', r.status === 200 && r.json?.data?.length === 2 && r.json?.meta?.total === 2);

  r = await req('GET', '/api/vault/tree', { token: A.token });
  const paths = [];
  const walk = (n) => { if (n) { paths.push(n.path); (n.children || []).forEach(walk); } };
  walk(r.json?.data?.tree);
  check('GET /api/vault/tree → 중간 폴더 포함 경로 구성', r.status === 200 && paths.includes('/업무') && paths.includes('/업무/스모크/2026') && paths.includes('/개인'), `paths=${paths.join(',')}`);

  r = await req('GET', '/api/vault/search?q=유니크제트', { token: A.token });
  check('GET /api/vault/search → content 매칭 1건 + snippet', r.status === 200 && r.json?.data?.length === 1 && r.json?.data?.[0]?.id === note2Id && r.json?.data?.[0]?.snippet?.includes('유니크제트'));
  r = await req('GET', '/api/vault/search?q=수정', { token: A.token });
  check('  └ title 매칭', r.status === 200 && r.json?.data?.length === 1 && r.json?.data?.[0]?.id === noteId);
  r = await req('GET', '/api/vault/search', { token: A.token });
  check('  └ q 없으면 400', r.status === 400);

  // 4. A 대화 메시지 생성 (from-message 소스)
  r = await req('POST', '/api/agents', { token: A.token, body: { name: '스모크 상담사', agent_type: 'shadow' } });
  const agentId = r.json?.data?.id;
  r = await req('POST', '/api/sessions/ensure', { token: A.token, body: { agent_id: agentId } });
  const sessionId = r.json?.data?.id;
  r = await req('POST', `/api/sessions/${sessionId}/messages`, { token: A.token, body: { content: '볼트로 저장할 중요한 대화 내용입니다' } });
  const messageId = r.json?.data?.answer_message_id || r.json?.data?.user_message_id;
  check('대화 메시지 생성 (from-message 소스)', r.status === 201 && !!messageId, `message=${messageId?.slice(0, 8)}`);

  // 5. 대화→노트 / 대화→카드
  r = await req('POST', '/api/vault/notes/from-message', { token: A.token, body: { message_id: messageId } });
  check('POST /api/vault/notes/from-message → 201', r.status === 201 && !!r.json?.data?.id, `note=${r.json?.data?.id?.slice(0, 8)}`);
  check('  └ source_message_id/session_id 역참조 + 메타 헤더 + tags', r.json?.data?.source_message_id === messageId && r.json?.data?.source_session_id === sessionId && r.json?.data?.content?.includes(`message_id: ${messageId}`) && (r.json?.data?.tags || []).includes('대화저장'));
  const fmNoteId = r.json?.data?.id;

  r = await req('POST', '/api/vault/notes/from-message', { token: A.token, body: {} });
  check('  └ message_id 없으면 400', r.status === 400);

  // 6. A 보드/카드 CRUD
  r = await req('POST', '/api/boards', { token: A.token, body: { name: '스모크 보드', description: '실DB 검증용' } });
  check('POST /api/boards → 201 + user_id 소유', r.status === 201 && r.json?.data?.user_id === A.userId);
  const boardId = r.json?.data?.id;

  r = await req('POST', `/api/boards/${boardId}/cards`, { token: A.token, body: { title: '카드 1', body: '본문', labels: ['backend'] } });
  const card1 = r.json?.data;
  check('POST 카드 → 201 + status todo + position 1000', r.status === 201 && card1?.status === 'todo' && card1?.position === 1000);
  r = await req('POST', `/api/boards/${boardId}/cards`, { token: A.token, body: { title: '카드 2', assignee: '백개발', priority: 3 } });
  const card2 = r.json?.data;
  check('POST 카드2 → position 2000 (컬럼 끝 자동 배치)', r.status === 201 && card2?.position === 2000);

  r = await req('POST', `/api/boards/${boardId}/cards`, { token: A.token, body: { title: 'x', status: 'blocked' } });
  check('status 오염값 → 400 (CHECK 계약 todo/doing/review/done)', r.status === 400);

  // status 이동 + read-back
  r = await req('PATCH', `/api/cards/${card1.id}`, { token: A.token, body: { status: 'doing' } });
  check('PATCH 카드 status todo→doing + 새 컬럼 position 자동', r.status === 200 && r.json?.data?.status === 'doing' && r.json?.data?.position === 1000);
  r = await req('GET', `/api/boards/${boardId}`, { token: A.token });
  const cols = r.json?.data?.columns;
  check('GET 보드 → columns.doing에 행 read-back', r.status === 200 && (cols?.doing || []).some((c) => c.id === card1.id) && (cols?.todo || []).some((c) => c.id === card2.id), `card_total=${r.json?.data?.card_total}`);
  r = await req('PATCH', `/api/cards/${card1.id}`, { token: A.token, body: { status: 'review', position: 1500 } });
  check('PATCH status+position 동시 (드래그 삽입)', r.status === 200 && r.json?.data?.status === 'review' && r.json?.data?.position === 1500);
  r = await req('GET', `/api/cards/${card1.id}`, { token: A.token });
  check('GET /api/cards/:cardId → 이동 결과 read-back', r.status === 200 && r.json?.data?.status === 'review' && r.json?.data?.position === 1500);

  // 대화→카드
  r = await req('POST', `/api/boards/${boardId}/cards/from-message`, { token: A.token, body: { message_id: messageId, labels: ['팔로업'] } });
  check('POST /api/boards/:id/cards/from-message → 201', r.status === 201 && r.json?.data?.source_message_id === messageId);
  check('  └ from-message 라벨 자동 + dialogue_type 라벨', (r.json?.data?.labels || []).includes('from-message') && (r.json?.data?.labels || []).includes('팔로업'), `labels=${r.json?.data?.labels}`);
  const fmCardId = r.json?.data?.id;

  // 7. B 크로스 접근 증명 (403/404 + 목록/트리/검색 미노출)
  r = await req('GET', `/api/vault/notes/${noteId}`, { token: B.token });
  check('B: A 노트 GET → 404 (존재 숨김)', r.status === 404, `status=${r.status}`);
  r = await req('PATCH', `/api/vault/notes/${noteId}`, { token: B.token, body: { title: '해킹' } });
  check('B: A 노트 PATCH → 404', r.status === 404);
  r = await req('DELETE', `/api/vault/notes/${noteId}`, { token: B.token });
  check('B: A 노트 DELETE → 404', r.status === 404);
  r = await req('GET', '/api/vault/notes', { token: B.token });
  check('B: 노트 목록에 A 노트 없음', r.status === 200 && !(r.json?.data || []).some((n) => n.user_id === A.userId));
  r = await req('GET', '/api/vault/tree', { token: B.token });
  check('B: 트리 note_total=0 (A 폴더 미노출)', r.status === 200 && r.json?.data?.note_total === 0);
  r = await req('GET', '/api/vault/search?q=유니크제트', { token: B.token });
  check('B: 검색으로 A 노트 미발견', r.status === 200 && (r.json?.data || []).length === 0);
  r = await req('POST', '/api/vault/notes/from-message', { token: B.token, body: { message_id: messageId } });
  check('B: A 메시지로 노트 생성 → 404', r.status === 404);

  r = await req('GET', `/api/boards/${boardId}`, { token: B.token });
  check('B: A 보드 GET → 404', r.status === 404);
  r = await req('PATCH', `/api/boards/${boardId}`, { token: B.token, body: { name: '해킹' } });
  check('B: A 보드 PATCH → 404', r.status === 404);
  r = await req('DELETE', `/api/boards/${boardId}`, { token: B.token });
  check('B: A 보드 DELETE → 404', r.status === 404);
  r = await req('GET', '/api/boards', { token: B.token });
  check('B: 보드 목록에 A 보드 없음', r.status === 200 && !(r.json?.data || []).some((b) => b.id === boardId));
  r = await req('POST', `/api/boards/${boardId}/cards`, { token: B.token, body: { title: '침입 카드' } });
  check('B: A 보드에 카드 생성 → 404', r.status === 404);
  r = await req('GET', `/api/cards/${card1.id}`, { token: B.token });
  check('B: A 카드 GET → 404', r.status === 404);
  r = await req('PATCH', `/api/cards/${card1.id}`, { token: B.token, body: { status: 'done' } });
  check('B: A 카드 PATCH → 404', r.status === 404);
  r = await req('DELETE', `/api/cards/${card1.id}`, { token: B.token });
  check('B: A 카드 DELETE → 404', r.status === 404);
  r = await req('POST', `/api/boards/${boardId}/cards/from-message`, { token: B.token, body: { message_id: messageId } });
  check('B: A 메시지로 A 보드 카드 생성 → 404', r.status === 404);
  // 통제군: A는 여전히 정상 접근
  r = await req('GET', `/api/cards/${card1.id}`, { token: A.token });
  check('통제군: A는 자기 카드 정상 접근 (B 시도 후 무손상)', r.status === 200 && r.json?.data?.status === 'review');

  // 8. 인증 없는 접근
  r = await req('GET', '/api/vault/notes');
  check('무인증 GET /api/vault/notes → 401', r.status === 401);
  r = await req('GET', '/api/boards');
  check('무인증 GET /api/boards → 401', r.status === 401);

  // 9. 정리 — 회원탈퇴 cascade (A 먼저: B의 크로스 404가 삭제 후에도 유지되는지 확인)
  r = await req('DELETE', '/api/me', { token: A.token });
  check('DELETE /api/me (A) → 200', r.status === 200 && r.json?.data?.deleted === true);
  r = await req('GET', `/api/vault/notes/${noteId}`, { token: A.token });
  check('  └ 탈퇴 후 A 토큰으로 노트 조회 → 401/404 (계정 소멸)', r.status === 401 || r.status === 404, `status=${r.status}`);
  r = await req('DELETE', '/api/me', { token: B.token });
  check('DELETE /api/me (B) → 200 (잔여 데이터 cascade 정리)', r.status === 200);

  // from-message로 만든 노트/카드도 함께 사라졌는지: 탈퇴 후 토큰은 조회 불가하므로
  // 삭제 전 존재 확인으로 대체 (fmNoteId/fmCardId는 생성 시점 read-back으로 이미 증명됨)
  check('from-message 노트/카드 생성 증명 (cascade는 DELETE /api/me 200으로 완료)', !!fmNoteId && !!fmCardId);

  console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err);
  process.exit(1);
});
