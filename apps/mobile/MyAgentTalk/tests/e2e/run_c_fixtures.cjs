// 브라우저 검증 전용 픽스처: 제품 코드로 가져오지 않는다.
async function installFixtures(page, { rich = false } = {}) {
  const state = { calls: [], unsupportedThread: false, unsupportedFork: false, sessions: [], messages: {}, sockets: [] };
  const agent = { id: 'agent', name: 'Test Agent' };
  state.sessions = [{ id: 'source', agent_id: 'agent', title: 'Original project', status: 'active' }];
  const row = (id, type, payload) => ({ id, session_id: 'source', role: 'agent', turn_index: 1, content: 'Test content ' + id, dialogue_type: type, structured_payload: payload, created_at: '2026-09-26T12:00:00Z' });
  state.messages.source = rich ? [
    { ...row('text', 'text'), thread_reply_count: 1 },
    row('info', 'info_card', { fields: [{ label: 'Real field', value: 'Server value' }] }),
    row('table', 'spreadsheet', { columns: ['Amount'], rows: [[123], [456], [789]] }),
    row('file', 'file', { name: 'report.pdf', url: 'https://example.test/report.pdf' }),
    row('task', 'task_flow', { items: [{ title: 'Review draft', status: 'pending' }] }),
    row('multi', 'multi_agent', { agents: [{ name: 'Expert', content: 'Expert result' }] }),
    row('unknown', 'future_card'),
  ] : [];
  await page.addInitScript(() => {
    localStorage.setItem('at-web-v1.sess', 'test-token');
    localStorage.setItem('at-language', 'ko');
  });
  await page.routeWebSocket('**/ws**', (socket) => {
    state.sockets.push(socket);
    socket.onMessage((data) => {
      if (JSON.parse(String(data)).type === 'subscribe') socket.send(JSON.stringify({ type: 'subscribed', current_seq: 0 }));
    });
  });
  await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    state.calls.push({ path, method: request.method(), body });
    const ok = (data) => route.fulfill({ json: { ok: true, data } });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/api/ws-ticket') return ok({ ticket: 'test-ticket' });
    if (path === '/api/agents') return ok(request.method() === 'POST' ? agent : rich ? [agent] : []);
    if (path === '/api/sessions/ensure') return ok(state.sessions[0]);
    if (path === '/api/sessions') return ok(state.sessions);
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
      const user = { id: 'u' + index, role: 'user', content: body.content, turn_index: index, parent_message_id: body.parent_message_id };
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
