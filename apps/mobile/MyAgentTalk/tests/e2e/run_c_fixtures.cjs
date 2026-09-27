// 브라우저 검증 전용 픽스처: 제품 코드로 가져오지 않는다.
async function installFixtures(page, { rich = false, wave = false, chief = false, uploadStub = null, feedPhoto = false, reader = false, exportStub = null } = {}) {
  const state = { calls: [], unsupportedThread: false, unsupportedFork: false, failFavorite: false, favorites: [], sessions: [], messages: {}, sockets: [], exports: [], frames: [] };
  // chief=true → 에이전트명 '김비서' (t_55f9ed57 갈라내기 게이트: 김비서 room만 fork 노출)
  const agent = { id: 'agent', name: chief ? '김비서' : 'Test Agent' };
  state.sessions = [{ id: 'source', agent_id: 'agent', title: 'Original project', status: 'active' }];
  const row = (id, type, payload) => ({ id, session_id: 'source', role: 'agent', turn_index: 1, content: 'Test content ' + id, dialogue_type: type, structured_payload: payload, created_at: '2026-09-26T12:00:00Z' });
  const LONG_PARA = '계약서 검토 결과, 제14조 위약금 조항에서 연 5퍼센트의 지연 이자를 상한으로 두되 기한이익 상실 요건을 채무자의 명시적-payment 거절로 한정하는 것이 안전하다. 제22조의 해지 통보 기한은 30일로 충분하며 중재지는 서울로, 준거법은 대한민국 법률로 정한다. 부속 합의서의 비밀유지 조항은 존속기간을 계약 종료 후 5년으로 연장하고 예외 사유를 법령상 의무, 이미 공개된 정보, 독립적으로 개발된 정보로 한정한다. 각 조항의 충돌 시 부속 합의서가 우선하며 분할 가능성이 인정되지 않는 조항은 무효로 두되 나머지 조항의 효력에는 영향이 없다. 통지는 서면으로 하되 전자서명된 메일을 유효한 서면으로 본다.'.repeat(6);
  const TABLE_ROWS = Array.from({ length: 40 }, (_, i) => [`항목 ${i + 1}`, (i + 1) * 120, i % 3 === 0 ? '완료' : '대기']);
  state.messages.source = reader ? [
    // t_3116c5bc 3카드좌표: 단문(펼침 유지·더보기 없음) / 장문 리치텍스트(1화면 초과→더보기+전체읽기) / 표 40행(더보기+xlsx 활성)
    row('short', 'info_card', { title: '단문 카드', fields: [{ label: '상태', value: '정상' }, { label: '처리', value: '완료' }] }),
    { ...row('long', 'text'), content: LONG_PARA },
    row('table', 'spreadsheet', { title: '지출 결의서', columns: ['항목', '금액', '상태'], rows: TABLE_ROWS }),
    row('task', 'task_flow', { items: [{ title: '인장 날인', status: 'pending' }] }),
  ] : rich ? [
    { ...row('text', 'text'), thread_reply_count: 1 },
    row('info', 'info_card', { fields: [{ label: 'Real field', value: 'Server value' }] }),
    row('table', 'spreadsheet', { columns: ['Amount'], rows: [[123], [456], [789]] }),
    row('file', 'file', { name: 'report.pdf', url: 'https://example.test/report.pdf' }),
    row('task', 'task_flow', { items: [{ title: 'Review draft', status: 'pending' }] }),
    row('multi', 'multi_agent', { agents: [{ name: 'Expert', content: 'Expert result' }] }),
    row('unknown', 'future_card'),
  ] : wave ? (() => {
    // Wave 1 — 인터랙티브 3종 + 리치텍스트 + 즐겨찾기 복원(favorite:true 행)
    const fav = { ...row('fav', 'info_card', { title: 'Fav card', fields: [{ label: 'k', value: 'v' }, { label: 'k2', value: 'v2' }] }), favorite: true };
    return [
      { ...row('rich', 'text'), content: '문의는 [여기](https://example.test/contact) · 코드는 `npm i` 로 설치\n> 인용 테스트' },
      row('form', 'form', { title: '견적 요청', form_id: 'q1', fields: [
        { id: 'name', type: 'text', label: '성함', required: true },
        { id: 'plan', type: 'radio', label: '플랜', options: ['Basic', 'Pro'], required: true },
        { id: 'agree', type: 'checkbox', label: '약관', required: true },
      ] }),
      row('chart', 'chart', { chart_type: 'bar', title: '매출', unit: '만원', labels: ['1월', '2월', '3월'], series: [{ name: 'A', data: [10, 20, 30] }, { name: 'B', data: [5, 15, 25] }] }),
      row('media', 'media', { media_type: 'image', url: 'https://picsum.photos/seed/mat/640/360', width: 640, height: 360, poster: 'https://picsum.photos/seed/mat/64/36', caption: '샘플 이미지' }),
      fav,
      row('task', 'task_flow', { items: [{ title: 'Review draft', status: 'pending' }] }),
    ];
  })() : [];
  state.favorites = state.messages.source.filter((m) => m.favorite).map((m) => ({ message: m, session: { id: 'source', title: 'Original project', agent_id: 'agent', agent_name: 'Test Agent', status: 'active' } }));
  if (feedPhoto) {
    // 피드용 즐겨찾기 photo_edit 행 — source 세션에는 넣지 않는다(체팅 재현 카드 testID 중복 방지, favorites-only)
    state.favorites.push({ message: { id: 'photo', role: 'user', dialogue_type: 'photo_edit', content: '편집된 사진', favorite: true, created_at: '2026-09-27T00:00:00Z', structured_payload: { original_url: 'https://picsum.photos/seed/photo/640/480', crop: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 }, annotations: [{ id: 'a1', kind: 'pin', from: { x: 0.5, y: 0.5 } }] } }, session: { id: 'source', title: 'Original project', agent_id: 'agent', agent_name: 'Test Agent', status: 'active' } });
  }
  if (wave) {
    // 픽스처 이미지 스텁 — 외부 네트워크 없이 결정적으로 로드/저장 검증
    await page.route('https://picsum.photos/**', (route) => route.fulfill({
      status: 200, contentType: 'image/png',
      // 공유 스냅샷 canvas 합성(tainted 방지) — loadHtmlImage의 crossOrigin=anonymous와 짝
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
    }));
  }
  await page.addInitScript(() => {
    localStorage.setItem('at-web-v1.sess', 'test-token');
    localStorage.setItem('at-language', 'ko');
  });
  await page.routeWebSocket('**/ws**', (socket) => {
    state.sockets.push(socket);
    socket.onMessage((data) => {
      // t_e735d936: 음성 콘솔 스모크 — 컨트롤(JSON)과 PCM(바이너리) 프레임 전부 기록.
      // 바이너리는 JSON.parse 시 throw → 방어 파싱 후 frames에만 남긴다.
      const text = Buffer.isBuffer(data) ? null : String(data);
      state.frames.push(text === null ? { binary: data.length } : (() => { try { return JSON.parse(text); } catch { return { unparsed: text.slice(0, 80) }; } })());
      if (text) {
        try {
          if (JSON.parse(text).type === 'subscribe') socket.send(JSON.stringify({ type: 'subscribed', current_seq: 0 }));
        } catch { /* binary/비JSON 무시 */ }
      }
    });
  });
  await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    // multipart 업로드(t_4497cfce)는 JSON 본문이 아니다 — postDataJSON은 content-type이 JSON일 때만
    const jsonish = (request.headers()['content-type'] || '').includes('json');
    const body = jsonish ? request.postDataJSON() : null;
    state.calls.push({ path, method: request.method(), body });
    const ok = (data) => route.fulfill({ json: { ok: true, data } });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/api/ws-ticket') return ok({ ticket: 'test-ticket' });
    // 첨부 업로드 스텁 (t_4497cfce e2e): POST /api/upload → UploadResult (실패 주입 가능)
    if (path === '/api/upload' && request.method() === 'POST') {
      if (uploadStub && uploadStub.failOnce && !uploadStub.failed) { uploadStub.failed = true; return route.fulfill({ status: 413, json: { ok: false, error: { code: 'FILE_TOO_LARGE', message: 'too big' } } }); }
      if (uploadStub) uploadStub.count = (uploadStub.count || 0) + 1;
      const n = uploadStub ? uploadStub.count : 1;
      return route.fulfill({ status: 201, json: { ok: true, data: { id: 'att' + n, url: 'https://cdn.test/object/' + n + '.png', object_path: 'u/att' + n + '.png', mime: 'image/png', size: 1200, sha256: 'x'.repeat(64), name: 'photo.png' } } });
    }
    if (path === '/api/agents') return ok(request.method() === 'POST' ? agent : (rich || wave) ? [agent] : []);
    if (path === '/api/sessions/ensure') return ok(state.sessions[0]);
    if (path === '/api/sessions') return ok(state.sessions);
    if (path === '/api/favorites' && request.method() === 'GET') {
      return route.fulfill({ json: { ok: true, data: state.favorites, meta: { limit: 50, offset: 0, has_more: false } } });
    }
    const favorite = path.match(/^\/api\/messages\/([^/]+)\/favorite$/);
    if (favorite && request.method() === 'PATCH') {
      if (state.failFavorite) return route.fulfill({ status: 500, json: { ok: false, error: { code: 'E', message: 'boom' } } });
      const row0 = state.messages.source.find((m) => m.id === favorite[1]);
      const target = row0 ?? state.favorites.find((e) => e.message.id === favorite[1])?.message;
      if (target) {
        target.favorite = body.favorite;
        state.favorites = body.favorite
          ? (state.favorites.some((e) => e.message.id === favorite[1]) ? state.favorites : [...state.favorites, { message: target, session: { id: 'source', title: 'Original project', agent_id: 'agent', agent_name: 'Test Agent', status: 'active' } }])
          : state.favorites.filter((e) => e.message.id !== favorite[1]);
      }
      return ok(target ?? { id: favorite[1], favorite: body.favorite });
    }
    // 카드 내보내기 (t_3116c5bc) — exportStub: null=미_stub(404), false=실패주입, true=200+Content-Disposition
    const exportPath = path.match(/^\/api\/messages\/([^/]+)\/export$/);
    if (exportPath && request.method() === 'GET') {
      const fmt = new URL(request.url()).searchParams.get('fmt') || 'pdf';
      state.exports.push({ messageId: exportPath[1], fmt });
      if (exportStub === false) return route.fulfill({ status: 500, json: { ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } } });
      if (fmt === 'xlsx' && exportPath[1] !== 'table') return route.fulfill({ status: 400, json: { ok: false, error: { code: 'EXPORT_FORMAT_UNSUPPORTED', message: 'table only' } } });
      const bytes = Buffer.from('%PDF-1.4 fake export payload ' + fmt + ' ' + exportPath[1]);
      return route.fulfill({ status: 200, headers: { 'content-type': fmt === 'pdf' ? 'application/pdf' : 'application/octet-stream', 'content-disposition': `attachment; filename="card.${fmt}"; filename*=UTF-8''%EC%84%B8%EC%85%98_%EC%B9%B4%EB%93%9C_${fmt}.${fmt === 'hwp' ? 'docx' : fmt}` }, body: bytes });
    }
    const thread = path.match(/^\/api\/messages\/([^/]+)\/thread$/);
    if (thread) {
      if (state.unsupportedThread) return route.fulfill({ status: 404, json: {} });
      return ok({ root: state.messages.source.find((m) => m.id === thread[1]), replies: [{ ...row('reply', 'text'), parent_message_id: thread[1], content: 'Thread reply' }] });
    }
    const fork = path.match(/^\/api\/sessions\/([^/]+)\/fork$/);
    if (fork) {
      if (state.unsupportedFork) return route.fulfill({ status: 405, json: {} });
      const session = { id: 'forked', title: body.new_session_title, agent_id: 'agent', status: 'active', forked_from: { session_id: fork[1], message_id: body.from_message_id, title: 'Original project' } };
      state.sessions.push(session); state.messages.forked = [...state.messages.source];
      return ok(session);
    }
    const messages = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (messages) {
      const sid = messages[1];
      if (request.method() === 'GET') return ok(state.messages[sid] || []);
      const index = state.calls.length;
      // 첨부 링크 에코 (t_4497cfce): attachment_ids → messages.attachments 요약 (백엔드 linkAttachmentsToMessage 규격)
      const echo = (body.attachment_ids || []).map((id, k) => ({ id, url: 'https://cdn.test/object/' + id + '.png', mime: 'image/png', size: 1200, name: 'photo.png' }));
      const user = { id: 'u' + index, role: 'user', content: body.content, turn_index: index, parent_message_id: body.parent_message_id, attachments: echo };
      const answer = { id: 'a' + index, role: 'agent', content: 'Test reply to ' + body.content, turn_index: index, parent_message_id: body.parent_message_id };
      if (!body.parent_message_id) state.messages[sid].push(user, answer);
      return ok({ user_message_id: user.id, messages: { user, empathy: null, answer }, run_id: 'r' + index });
    }
    const session = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (session) return ok(state.sessions.find((s) => s.id === session[1]));
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}
module.exports = { installFixtures };
