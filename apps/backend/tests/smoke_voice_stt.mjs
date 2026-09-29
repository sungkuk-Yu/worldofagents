/**
 * 음성 STT 스모크 (t_1c7be18c): 앱 음성 발화 → 로컬 faster-whisper v3-turbo 실전사 검증.
 * mock 고정 문장("안녕하세요, 오늘 할 일을 정리해 주세요.")이 나오면 FAIL.
 *
 * 사용법:
 *   PORT=3100 STANDALONE=true STT_SIDECAR_URL=http://127.0.0.1:9833 ./node_modules/.bin/tsx src/index.ts
 *   node tests/smoke_voice_stt.mjs http://localhost:3100 <pcm 파일> "<기대 문장 키워드>"
 */
const BASE = process.argv[2] || 'http://localhost:3100';
const PCM = process.argv[3];
const KEYWORD = process.argv[4] || '회의';
const WS_BASE = BASE.replace(/^http/, 'ws');
const MOCK_PHRASE = '안녕하세요, 오늘 할 일을 정리해 주세요.';

import { readFileSync } from 'node:fs';

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

async function main() {
  const email = `voice_${Date.now()}@test.io`;
  let r = await req('POST', '/api/auth/signup', { body: { email, password: 'Voice1234!', display_name: '음성테스트' } });
  check('signup', r.status === 201 && !!r.json?.data?.token, `status=${r.status}`);
  const token = r.json?.data?.token;

  r = await req('GET', '/api/agents', { token });
  const agents = r.json?.data?.agents || r.json?.data || [];
  let agentId = Array.isArray(agents) && agents[0]?.id;
  if (!agentId) {
    r = await req('POST', '/api/agents', { token, body: { name: '음성파트너' } });
    agentId = r.json?.data?.id;
  }
  check('agent 확보', !!agentId);

  r = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agentId } });
  const sessionId = r.json?.data?.id || r.json?.data?.session_id;
  check('session ensure', !!sessionId, `status=${r.status}`);

  const pcm = readFileSync(PCM);
  const tr = await req('POST', '/api/ws-ticket', { token, body: {} });
  const ticket = tr.json?.data?.ticket;
  if (!ticket) { console.error('  WS ticket fail:', JSON.stringify(tr.json)); process.exit(1); }
  const transcript = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?session_id=${sessionId}&ticket=${ticket}`);
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    let started = false;
    const timer = setTimeout(() => { ws.close(); reject(new Error('WS timeout 90s')); }, 90000);
    ws.onopen = () => send({ type: 'subscribe', session_id: sessionId });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'connected' && !started) {
        started = true;
        send({ type: 'audio.start', session_id: sessionId, config: { sample_rate: 16000, encoding: 'pcm_s16le', mode: 'ptt' } });
        // 64KB 청크로 나눠 전송 (실 앱 스트리밍 형상)
        let i = 0;
        const tick = () => {
          if (i < pcm.length) { ws.send(pcm.subarray(i, i + 65536)); i += 65536; setTimeout(tick, 10); }
          else send({ type: 'audio.end', session_id: sessionId });
        };
        tick();
      }
      if (m.type === 'transcript.final') { clearTimeout(timer); ws.close(); resolve(m); }
      if (m.type === 'session.error' || m.type === 'error') { clearTimeout(timer); ws.close(); reject(new Error(JSON.stringify(m))); }
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error('ws error: ' + (e?.message || ''))); };
  }).catch((e) => { console.error('  WS fail:', e.message); return null; });

  check('transcript.final 수신', !!transcript);
  if (transcript) {
    console.log(`    text=${JSON.stringify(transcript.text)} conf=${transcript.confidence}`);
    check('mock 고정 문장 아님', transcript.text !== MOCK_PHRASE && transcript.text.length > 0);
    check(`실발화 키워드 '${KEYWORD}' 포함`, (transcript.text || '').includes(KEYWORD));
    // 서비스 경로는 저장된 사용자 메시지의 stt_metadata로 검증 (브로드캐스트 프레임엔 service 없음)
    await new Promise((res) => setTimeout(res, 1500));
    const mr = await req('GET', `/api/sessions/${sessionId}/messages`, { token });
    const msgs = mr.json?.data?.messages || mr.json?.data || [];
    const userMsg = (Array.isArray(msgs) ? msgs : []).find((m) => m.role === 'user' && m.content === transcript.text);
    check('stt_metadata.service=local (실 전사 경로)', userMsg?.stt_metadata?.service === 'local', JSON.stringify(userMsg?.stt_metadata || null));
  }
  console.log(`\n=== smoke_voice_stt: ${passed} pass / ${failed} fail ===`);
  process.exit(failed ? 1 : 0);
}
main();
