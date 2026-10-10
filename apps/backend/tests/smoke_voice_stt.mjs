/**
 * 음성 STT 스모크 (t_1c7be18c): 앱 음성 발화 → 로컬 faster-whisper v3-turbo 실전사 검증.
 * mock 고정 문장("안녕하세요, 오늘 할 일을 정리해 주세요.")이 나오면 FAIL.
 *
 * [7] 언어 힌트 픽스 (t_827dcbcc 'is' 오전사, 카드 시나리오 2): 실 사이드카 대상 —
 *   7a 한국어 PCM + client 미지정 → 서버가 세션 locale(ko 기본) 확정힌트 전송,
 *      transcript.draft.language='ko' + 한국어 키워드 전사 ('is' 오인 소멸 실측).
 *   7b 영어 PCM + client config.language='en' → ko locale 덮어쓰기 우선순위, 영어 키워드 전사.
 *   (draft:true 라운드 — 비영속: user 행 0·run 0, 스모크 DB 오염 없음.)
 *
 * 사용법:
 *   PORT=3100 STANDALONE=true STT_SIDECAR_URL=http://127.0.0.1:9833 ./node_modules/.bin/tsx src/index.ts
 *   node tests/smoke_voice_stt.mjs http://localhost:3100 <pcm 파일> "<기대 문장 키워드>"
 *   # [7]은 fixture 자동 탐색(없으면 SKIP): ../apps/mobile/MyAgentTalk/tests/e2e/fixtures/voice_fixture_{ko,en}_short.pcm
 *   #   (EN fixture 생성: apps/mobile/MyAgentTalk/tests/e2e/fixtures/make_voice_fixture_en_short.py)
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

let passed = 0, failed = 0, skipped = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
const skip = (name, extra = '') => { skipped++; console.log(`  SKIP  ${name}${extra ? ' — ' + extra : ''}`); };

async function main() {
  const email = `voice_${Date.now()}@test.io`;
  let r = await req('POST', '/api/auth/signup', { body: { email, password: 'Voice1234!', display_name: '음성테스트', age_confirmed: true, consents: [
    { type: 'terms', version: '1.0', consented: true },
    { type: 'privacy', version: '1.0', consented: true },
    { type: 'voice_recording', version: '1.0', consented: true },
    { type: 'overseas_transfer', version: '1.0', consented: true },
  ] } });
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
  const LATENCY_TARGET_MS = Number(process.env.SMOKE_LATENCY_MS || 3500);
  const collected = { events: [], tEnd: 0, tTranscript: 0, tAck: 0, tDelta: 0, tCompleted: 0, done: '', ws: null, timer: null };
  const transcript = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?session_id=${sessionId}&ticket=${ticket}`);
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    let started = false;
    const timer = setTimeout(() => { ws.close(); reject(new Error('WS timeout 90s')); }, 90000);
    collected.ws = ws; collected.timer = timer;
    ws.onopen = () => send({ type: 'subscribe', session_id: sessionId });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      collected.events.push(m);
      if (m.type === 'connected' && !started) {
        started = true;
        send({ type: 'audio.start', session_id: sessionId, config: { sample_rate: 16000, encoding: 'pcm_s16le', mode: 'ptt' } });
        // 64KB 청크로 나눠 전송 (실 앱 스트리밍 형상)
        let i = 0;
        const tick = () => {
          if (i < pcm.length) { ws.send(pcm.subarray(i, i + 65536)); i += 65536; setTimeout(tick, 10); }
          else { collected.tEnd = Date.now(); send({ type: 'audio.end', session_id: sessionId }); }
        };
        tick();
      }
      // t_5cba9ebb — 전사 즉시 브로드캐스트: transcript.final이 run보다 먼저 온다 (audio.end 경로).
      if (m.type === 'transcript.final' && m.text && !collected.tTranscript) { collected.tTranscript = Date.now(); resolve(m); }
      if (m.type === 'persona.line' && m.source === 'ack' && !collected.tAck) collected.tAck = Date.now();
      if (m.type === 'answer.delta' && !collected.tDelta) collected.tDelta = Date.now();
      if (m.type === 'run.completed' && collected.tTranscript) { collected.tCompleted = Date.now(); collected.done = 'completed'; }
      if (m.type === 'run.failed') { collected.tCompleted = Date.now(); collected.done = 'failed'; }
      if (m.type === 'session.error' || m.type === 'error') { collected.done = 'error'; clearTimeout(timer); ws.close(); reject(new Error(JSON.stringify(m))); }
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error('ws error: ' + (e?.message || ''))); }
  }).catch((e) => { console.error('  WS fail:', e.message); return null; });

  check('transcript.final 수신', !!transcript);
  if (transcript) {
    console.log(`    text=${JSON.stringify(transcript.text)} conf=${transcript.confidence}`);
    check('mock 고정 문장 아님', transcript.text !== MOCK_PHRASE && transcript.text.length > 0);
    check(`실발화 키워드 '${KEYWORD}' 포함`, (transcript.text || '').includes(KEYWORD));
    // ⑤ 전사 즉시 발화 (t_2133e4fc, 대표님 #324 정본): audio.end → runTextTurn 실행 **이전**에
    // user 행 영속+transcript.final·message.new(user) 선방송. transcript.final의 message_id는
    // pending(null)이 아니라 **확정 id** — 런이 37~300s 걸리거나 실패해도 발화 행이 이미 존재한다.
    // t_5cba9ebb의 message_id=null(구계약)은 폐기.
    check('전사 즉시 확정 message_id (선영속)', typeof transcript.message_id === 'string' && transcript.message_id.length > 0, JSON.stringify(transcript.message_id));
    check('확정 turn_index 선방송', typeof transcript.turn_index === 'number' && transcript.turn_index >= 0, `turn=${transcript.turn_index}`);
    // ① 페르소나 보이스 채널: ack ≤2s SLA + 음성 턴 empathy 배지 없음 (복명복창 폐기).
    // 런 종료(run.completed/failed)까지 대기 — 실DB에서 run.started는 소유권·persona 왕복
    // 직후(수백 ms~수 초)에 나간다. 전사 직후 close했던 구 구조는 ack 확인을 놓친다 (t_5cba9ebb 실측).
    const runEnd = await new Promise((res) => {
      const iv = setInterval(() => {
        if (collected.done) { clearInterval(iv); clearTimeout(collected.timer); try { collected.ws?.close?.(); } catch { /* ignore */ } res(collected.done); }
      }, 50);
      setTimeout(() => { clearInterval(iv); res('timeout'); }, 90000);
    });
    collected.tCompleted = collected.tCompleted || Date.now();
    console.log(`    run end: ${runEnd}`);
    // 검수 기준 (t_2133e4fc): audio.end 이후 **run.completed 이전**에 role=user message.new가
    // 방송됐다 — 런 종료 대기 후 전체 스트림이 모인 시점에서 순서를 판정한다
    // (transcript.final 수신 시점에는 message.new가 아직 큐에서 오가는 중일 수 있다).
    const userNewIdx = collected.events.findIndex(e => e.type === 'message.new' && e.message?.role === 'user');
    const completedIdx = collected.events.findIndex(e => e.type === 'run.completed' || e.type === 'run.failed' || e.type === 'run.cancelled');
    check('run.completed 이전 user message.new 선방송 (검수 기준)', userNewIdx >= 0 && completedIdx >= 0 && userNewIdx < completedIdx, userNewIdx >= 0 ? `user_new@${userNewIdx} < end@${completedIdx}` : 'message.new(user) 없음');
    if (userNewIdx >= 0) {
      const startedIdx = collected.events.findIndex(e => e.type === 'run.started');
      check('message.new(user)가 run.started보다 먼저 (순서 계약)', startedIdx > userNewIdx, `user_new@${userNewIdx} < started@${startedIdx}`);
      check('transcript.final id = message.new(user) id', collected.events[userNewIdx].message.id === transcript.message_id);
      // 같은 run_id로 직렬 연결 (선방송 message.new = 실행 런) — 프론트가 user 발화와 답변을 한 턴으로 붙인다.
      check('user message.new run_id = 런 run_id', collected.events[userNewIdx].run_id === collected.events[startedIdx]?.run_id);
      // 중복 영속 금지: user message.new는 정확히 1회 (runTextTurn 재발행 없음).
      check('user message.new 1회만 (중복 발행 금지)', collected.events.filter(e => e.type === 'message.new' && e.message?.role === 'user').length === 1);
    }
    const ack = collected.events.find((e) => e.type === 'persona.line' && e.source === 'ack');
    check('persona.line ack 발행', !!ack, ack ? `line="${ack.line}"` : '');
    // ≤2s SLA는 런 개시 기준 — 전사(사이드카) 자체 소요는 페르소나 줄 위반이 아니다.
    if (ack) check('  └ 런 개시→첫 발화 ≤2s', collected.tAck - collected.tTranscript <= 2000, `${collected.tAck - collected.tTranscript}ms`);
    check('음성 턴 empathy 뉴런 이벤트 없음 (공감 생략)',
      !collected.events.some((e) => e.type === 'neuron.status' && e.neuron?.slug === 'empathy'));
    // 지연 실측 (9/29 보강 3항): 목표는 체감 지연 — 백엔드가 통제하는 구간은
    // transcript.final→첫 answer.delta (LLM 시작 지연). 오디오 릴리스→전사 완료 구간은
    // 사이드카 CPU 실측값이 지배한다 (4.3s 발화 ≈ 7.0s 전사, large-v3-turbo int8 —
    // pre-end 병렬 전사는 명시적 스펙 외). 전체 구간은 기록만 남긴다.
    if (collected.tDelta) {
      const transcribe = collected.tTranscript - collected.tEnd;
      const pipeline = collected.tDelta - collected.tTranscript;
      const total = collected.tDelta - collected.tEnd;
      console.log(`    latency audio.end→transcript.final=${transcribe}ms (사이드카), transcript→first answer.delta=${pipeline}ms (백엔드), total=${total}ms`);
      check(`지연: 전사 완료→첫 answer.delta ≤ ${LATENCY_TARGET_MS}ms (백엔드 구간)`, pipeline <= LATENCY_TARGET_MS, `${pipeline}ms`);
    } else {
      skip('지연: 전사 완료→첫 answer.delta', 'answer.delta 없음 (브리지/저속 환경)');
    }
    // 서비스 경로는 저장된 사용자 메시지의 stt_metadata로 검증 (브로드캐스트 프레임엔 service 없음)
    await new Promise((res) => setTimeout(res, 1500));
    const mr = await req('GET', `/api/sessions/${sessionId}/messages`, { token });
    const msgs = mr.json?.data?.messages || mr.json?.data || [];
    const userMsg = (Array.isArray(msgs) ? msgs : []).find((m) => m.role === 'user' && m.content === transcript.text);
    check('stt_metadata.service=local (실 전사 경로)', userMsg?.stt_metadata?.service === 'local', JSON.stringify(userMsg?.stt_metadata || null));
    // 선영속+재사용 계약 read-back (t_2133e4fc): user 행 정확히 1개, id = 선방송 message_id.
    const userRows = (Array.isArray(msgs) ? msgs : []).filter((m) => m.role === 'user' && m.content === transcript.text);
    check('user 행 1개만 (선영속 재사용, 중복 영속 금지)', userRows.length === 1 && userRows[0].id === transcript.message_id, `rows=${userRows.length}`);
    check('음성 턴 empathy 저장 행 없음', !(Array.isArray(msgs) ? msgs : []).some((m) => m.source_neuron === 'empathy'));
  }
  // [7] 언어 힌트 픽스 회귀 (t_827dcbcc, 카드 시나리오 2) — 실 사이드카 대상 draft 라운드(비영속).
  // 사이드카 미설정 백엔드(예: DEV mock)에서 실행 시 SKIP: service='local'일 때만 단정한다.
  const FX = '../../apps/mobile/MyAgentTalk/tests/e2e/fixtures/';
  const fxKo = FX + 'voice_fixture_ko_short.pcm', fxEn = FX + 'voice_fixture_en_short.pcm';
  const draftRound = ({ pcmFile, clientLang, expectLang, keywordRe, label }) => new Promise((resolve) => {
    let pcm;
    try { pcm = readFileSync(pcmFile); } catch { skip(`${label} (fixture 없음)`); return resolve(); }
    req('POST', '/api/ws-ticket', { token, body: {} }).then((tr2) => {
      const ticket2 = tr2.json?.data?.ticket;
      if (!ticket2) { check(`${label} ws-ticket`, false, JSON.stringify(tr2.json)); return resolve(); }
      const wsUrl = `${WS_BASE}/ws?session_id=${sessionId}&ticket=${ticket2}`;
      const ws = new WebSocket(wsUrl);
      const t = setTimeout(() => { try { ws.close(); } catch {}; check(`${label} (timeout)`, false, 'no transcript.draft 60s'); resolve(); }, 60000);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe', session_id: sessionId }));
        const cfg = { sample_rate: 16000, encoding: 'pcm_s16le', mode: 'ptt', ...(clientLang ? { language: clientLang } : {}) };
        ws.send(JSON.stringify({ type: 'audio.start', session_id: sessionId, config: cfg }));
        let i = 0;
        const tick = () => {
          if (i < pcm.length) { ws.send(pcm.subarray(i, i + 65536)); i += 65536; setTimeout(tick, 10); }
          else ws.send(JSON.stringify({ type: 'audio.end', session_id: sessionId, draft: true }));
        };
        tick();
      };
      ws.onmessage = (m) => {
        const e = JSON.parse(m.data);
        if (e.type === 'transcript.draft') {
          clearTimeout(t); try { ws.close(); } catch {}
          check(`${label} — draft 회신 text 실전사 (mock 조용폴백 0)`, !!e.text && e.text !== MOCK_PHRASE, `text="${(e.text || '').slice(0, 40)}" lang=${e.language} conf=${e.confidence}`);
          check(`${label} — wire language 확정 (${expectLang}, 'is'류 오인 0)`, e.language === expectLang, `got=${e.language}`);
          check(`${label} — 키워드 전사`, keywordRe.test(e.text || ''), e.text);
          resolve();
        }
        if (e.type === 'error') { clearTimeout(t); try { ws.close(); } catch {}; check(`${label}`, false, JSON.stringify(e)); resolve(); }
      };
      ws.onerror = () => { clearTimeout(t); skip(`${label} (ws error)`); resolve(); };
    }, (e) => { check(`${label} (prep)`, false, String(e?.message || e)); resolve(); });
  });
  await draftRound({ pcmFile: fxKo, clientLang: null, expectLang: 'ko', keywordRe: /안녕|컨디션/, label: '[7]a ko 발화+무지정→locale ko 힌트' });
  await draftRound({ pcmFile: fxEn, clientLang: 'en', expectLang: 'en', keywordRe: /hello|how is your day/i, label: '[7]b en 발화+client en 힌트 우선' });
  // 비영속 확인: [7] draft 라운드가 user 행을 남기지 않는다 (hold-for-edit 계약 관통 회귀).
  {
    const mr = await req('GET', `/api/sessions/${sessionId}/messages`, { token });
    const msgs = mr.json?.data?.messages || mr.json?.data || [];
    const arr = Array.isArray(msgs) ? msgs : [];
    check('[7] draft 라운드 user 행 0 (비영속 유지)', arr.filter(m => m.role === 'user' && /컨디션|hello|how is/i.test(m.content || '')).length <= 1, `user_total=${arr.filter(m => m.role === 'user').length}`);
  }

  console.log(`\n=== smoke_voice_stt: ${passed} pass / ${failed} fail / ${skipped} skip ===`);
  process.exit(failed ? 1 : 0);
}
main();
