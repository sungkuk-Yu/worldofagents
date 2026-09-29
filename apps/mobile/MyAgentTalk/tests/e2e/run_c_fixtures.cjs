// 브라우저 검증 전용 픽스처: 제품 코드로 가져오지 않는다.
async function installFixtures(page, { rich = false, wave = false, chief = false, uploadStub = null, feedPhoto = false, reader = false, exportStub = null, ack = false, gateSend = false, dedupWindow = false, sender = false } = {}) {
  const state = { calls: [], unsupportedThread: false, unsupportedFork: false, failFavorite: false, favorites: [], sessions: [], messages: {}, sockets: [], exports: [], frames: [], resolveSend: null, lastIngress: null };
  // chief=true → 에이전트명 '김비서' (t_55f9ed57 갈라내기 게이트: 김비서 room만 fork 노출)
  const agent = { id: 'agent', name: chief ? '김비서' : 'Test Agent' };
  state.sessions = [{ id: 'source', agent_id: 'agent', title: 'Original project', status: 'active' }];
  const row = (id, type, payload) => ({ id, session_id: 'source', role: 'agent', turn_index: 1, content: 'Test content ' + id, dialogue_type: type, structured_payload: payload, created_at: '2026-09-26T12:00:00Z', agent_id: 'agent', agent_name: agent.name });
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
  if (ack) {
    // t_043539ff 히스토리 재현 검증용 stale 공감 행(9/26) — 실시간 칩이면 안 된다. 이후 POST 응답 행은 실시간 created_at.
    state.messages.source = [
      { id: 'hu', role: 'user', content: '이전 질문', turn_index: 0, created_at: '2026-09-26T12:00:00Z' },
      { id: 'he', role: 'agent', source_neuron: 'empathy', content: '이전 질문 복창', turn_index: 1, created_at: '2026-09-26T12:00:01Z', structured_payload: { empathy_ack: '네, 확인했어요' } },
    ];
  }
  if (sender) {
    // t_55b7e30c 연속 발화 그룹핑 시드 — created_at=런타임 기준(모노토닉)으로 결정적 재현.
    // 기대 헤더: s1(role 전환) s4(120초 간격=창 초과) s5(agentId 전환) s7(user 재전환) = 4.
    // 기대 무명+오프셋: s2(정확히 60초=경계 포함) s3(20초) s6(10초 same id) = 3.
    // 라벨 분기(서버 agent_name 우선): 김비서×3(s1·s4·s7) + 전문가×1(s5, agent_id=other).
    const NOW = Date.now();
    const ago = (sec) => new Date(NOW - sec * 1000).toISOString();
    state.messages.source = [
      { id: 'u0', role: 'user', content: '연쇄 질문', turn_index: 0, created_at: ago(400) },
      { id: 's1', role: 'agent', content: 'EMPATHY-ONE', turn_index: 1, created_at: ago(300), agent_id: 'agent', agent_name: agent.name },
      { id: 's2', role: 'agent', content: 'ANSWER-TWO', turn_index: 2, created_at: ago(240), agent_id: 'agent', agent_name: agent.name },
      { id: 's3', role: 'agent', content: 'ANSWER-THREE', turn_index: 3, created_at: ago(220), agent_id: 'agent', agent_name: agent.name },
      { id: 's4', role: 'agent', content: 'STALE-GROUP', turn_index: 4, created_at: ago(100), agent_id: 'agent', agent_name: agent.name },
      { id: 's5', role: 'agent', content: 'OTHER-AGENT', turn_index: 5, created_at: ago(90), agent_id: 'other', agent_name: '전문가' },
      { id: 's6', role: 'agent', content: 'OTHER-CONT', turn_index: 6, created_at: ago(80), agent_id: 'other', agent_name: '전문가' },
      { id: 'u1', role: 'user', content: '다시 질문', turn_index: 7, created_at: ago(60) },
      { id: 's7', role: 'agent', content: 'AFTER-USER', turn_index: 8, created_at: ago(30), agent_id: 'agent', agent_name: agent.name },
    ];
  }
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
      // t_4af94b1c e2e 픽스처: dedupWindow = 백엔드 ingress 드롭 응답 그대로({deduped:true,message} 전용) —
      // 프론트의 유령 낙관 행 제거 분기를 검증한다.
      if (dedupWindow) return ok({ deduped: true, message: '동일 발화가 방금 접수되었습니다.' });
      const index = state.calls.length;
        // 첨부 링크 에코 (t_4497cfce e2e): attachment_ids → messages.attachments 요약 (백엔드 linkAttachmentsToMessage 규격)
        const echo = (body.attachment_ids || []).map((id, k) => ({ id, url: 'https://cdn.test/object/' + id + '.png', mime: 'image/png', size: 1200, name: 'photo.png' }));
        if (!state.messages[sid]) state.messages[sid] = [];
        // 턴 인덱스 = 백엔드 실규격 순증 (user=nextTurn, empathy=+1, answer=+2 — graph.ts 저장 경계)
        const base = state.messages[sid].length;
        // 답글 인용 에코 (t_62897e88 / 백엔드 t_02f58030 규격): reply_to_id가 세션 안에 실존하면
        // user 행에 reply_to_id + structured_payload.reply_to {message_id,by,text≤120} 스냅샷을 붙인다.
        // invalid/부재 = 강등(인용 없음)하되 발화는 통과 — 백엔드 '무시 후 발송' 정책 1:1 미러.
        const quoteTarget = typeof body.reply_to_id === 'string' ? state.messages[sid].find((m) => m.id === body.reply_to_id) : undefined;
        const quotePayload = quoteTarget ? { reply_to: { message_id: quoteTarget.id, by: quoteTarget.role === 'user' ? '나' : 'Test Agent', text: String(quoteTarget.content || '').replace(/\s+/g, ' ').slice(0, 80) } } : undefined;
        const user = { id: 'u' + index, role: 'user', content: body.content, turn_index: base, created_at: new Date().toISOString(), parent_message_id: body.parent_message_id, attachments: echo, ...(quoteTarget ? { reply_to_id: quoteTarget.id, structured_payload: quotePayload } : {}) };
        // 백엔드 t_02f58030 코멘트: answer 행도 structured_payload.reply_to 요약본(컨텍스트 있는 답변).
        const answer = { id: 'a' + index, role: 'agent', content: 'Test reply to ' + body.content, turn_index: base + (ack && !body.parent_message_id ? 2 : 0), created_at: new Date().toISOString(), parent_message_id: body.parent_message_id, agent_id: 'agent', agent_name: agent.name, ...(quoteTarget ? { structured_payload: quotePayload } : {}) };
        // t_043539ff ack 픽스처 → t_c62a2eb7/t_44f8896c 계약형 empathy 행: content=재질문("이거 맞냐" 4종
        // 회전 시뮬레이션), structured_payload={empathy_question,template_id,empathy_full,empathy_ack},
        // created_at=요청 시각(실시간 행). 확인 발화 재에코 금지 상태 머신은 백엔드 소관이라 프론트 스모크는 미검.
        const ROT = ['eq_confirm', 'eq_proceed', 'eq_understand', 'eq_align'];
        const tid = ROT[(state.ackTurn = (state.ackTurn ?? -1) + 1) % 4];
        const requestion = tid === 'eq_confirm' ? `이거 맞죠? ${body.content.slice(0, 12)}`
          : tid === 'eq_proceed' ? `${body.content.slice(0, 12)} — 맞으면 계속 진행할게요`
          : tid === 'eq_understand' ? `제 이해가 맞다면 ${body.content.slice(0, 12)}`
          : `맞나요? ${body.content.slice(0, 12)} 쪽으로 받아들이면 돼요`;
        const empathy = ack && !body.parent_message_id
          ? { id: 'emp' + index, role: 'agent', source_neuron: 'empathy', content: requestion, turn_index: base + 1, created_at: new Date().toISOString(), structured_payload: { empathy_ack: '네, 확인했어요', empathy_full: '에코: ' + body.content, empathy_question: requestion, template_id: tid } }
          : null;
        if (!body.parent_message_id) state.messages[sid].push(user, ...(empathy ? [empathy] : []), answer);
        const result = { user_message_id: user.id, empathy_message_id: empathy ? empathy.id : null, empathy_response: empathy ? empathy.content : null, messages: { user, empathy, answer }, run_id: 'r' + index };
        // t_4af94b1c in-flight 가드 e2e: gateSend = 첫 POST 응답을 테스트가 풀어줄 때까지 보류(실행 중 창 재현).
        if (gateSend && !state.resolveSend) return new Promise((resolve) => { state.resolveSend = () => ok(result); });
        return ok(result);
    }
    const session = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (session) return ok(state.sessions.find((s) => s.id === session[1]));
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}
module.exports = { installFixtures };
