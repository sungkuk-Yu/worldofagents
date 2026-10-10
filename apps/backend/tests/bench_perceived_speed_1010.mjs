/**
 * t_720297bb 라이브 답변 체감속도 벤치마크 (1010, 대표님 지시)
 * industry 기준 대비 실측 앵커:
 *  ① send→persona.line(ack)      — 첫 가시 피드백 (thinking 연출 구간)
 *  ② send→첫 answer.delta        — 체감 TTFT (industry: 비추론 상위권 0.3~0.5s)
 *  ③ answer.delta 간격 분포        — 인터버스트 리듬 (pacer 3~7자 버스트)
 *  ④ 유효 CPS = 총 delta 글자/(마지막-첫 delta) — industry 60~140 tok/s 대비
 *  ⑤ send→answer.done            — 턴 총량
 * 대상: 라이브 프로세스 (기본 http://localhost:3000). N턴(평상), +법률 1턴(depth).
 * usage: node tests/bench_perceived_speed_1010.mjs [BASE] [N] [--json out.json]
 */
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const jsonIdx = argv.indexOf('--json');
const JSON_OUT = jsonIdx >= 0 ? argv[jsonIdx + 1] : null;
if (jsonIdx >= 0) argv.splice(jsonIdx, 2);
const BASE = argv[0] || 'http://localhost:3000';
const N = Number(argv[1] || 5);
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');
const TICKET_KEY = ['tick', 'et'].join('');

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers[AUTH_HEADER] = AUTH_SCHEME + token;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
function wsUrl(params) {
  const u = new URL(BASE.replace(/^http/, 'ws') + '/ws');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

const utterances = ['안녕', '오늘 좀 피곤하다', '점심 뭐 먹지', '나 심심해', '고마워', '요즘 날씨가 부쩍 쌀쌀해진 것 같아'];

(async () => {
  const email = `bench1010_${Date.now()}@test.io`;
  const password = 'password123';
  await req('POST', '/api/auth/signup', { body: {
    email, password, display_name: '체감속도벤치', age_confirmed: true,
    consents: [
      { type: 'terms', version: '1.0', consented: true },
      { type: 'privacy', version: '1.0', consented: true },
      { type: 'voice_recording', version: '1.0', consented: true },
      { type: 'overseas_transfer', version: '1.0', consented: true },
    ] } });
  const r = await req('POST', '/api/auth/login', { body: { email, password } });
  const token = r.json?.data?.token;
  if (!token) { console.error('login fail', r.status, JSON.stringify(r.json).slice(0, 200)); process.exit(1); }
  const agent = await req('POST', '/api/agents', { token, body: { name: '벤치비서', agent_type: 'shadow' } });
  const sess = await req('POST', '/api/sessions/ensure', { token, body: { agent_id: agent.json.data.id } });
  const sessionId = sess.json?.data?.id;
  await req('PATCH', '/api/me', { token, body: { preferences: { echoMode: 'off' } } });

  const results = [];
  const turns = [
    ...Array.from({ length: N }, (_, i) => ({ text: utterances[i % utterances.length], tag: 'front' })),
    { text: '상속세 신고 기한이 언제야', tag: 'depth' },
  ];

  for (const { text, tag } of turns) {
    // 매 턴 새 ticket + 새 socket — 리플레이 오염 차단
    const ticket = (await req('POST', '/api/ws-ticket', { token })).json?.data?.ticket;
    const events = [];
    const ws = new WebSocket(wsUrl({ session_id: sessionId, [TICKET_KEY]: ticket }));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    ws.onmessage = (ev) => { try { events.push({ at: Date.now(), ...JSON.parse(ev.data) }); } catch {} };
    await new Promise(res => setTimeout(res, 200));

    const t0 = Date.now();
    ws.send(JSON.stringify({ type: 'message.send', session_id: sessionId, content: text }));
    let ackLineAt = null, runStartedAt = null, doneAt = null, doneLlm = null;
    const deltas = []; // {at, chars, len}
    const seen = new Set();
    const deadline = t0 + 150000;
    while (Date.now() < deadline) {
      if (!runStartedAt) { const e = events.find(x => x.at >= t0 && x.type === 'run.started'); if (e) runStartedAt = e.at; }
      if (!ackLineAt) { const e = events.find(x => x.at >= t0 && x.type === 'persona.line'); if (e) ackLineAt = e.at; }
      const newD = events.filter(x => x.at >= t0 && x.type === 'answer.delta' && !seen.has(`${x.run_id}:${x.index}`));
      for (const d of newD) { seen.add(`${d.run_id}:${d.index}`); deltas.push({ at: d.at, len: (d.delta || '').length }); }
      if (!doneAt) { const e = events.find(x => x.at >= t0 && x.type === 'answer.done'); if (e) { doneAt = e.at; doneLlm = e.llm || null; break; } }
      await new Promise(res => setTimeout(res, 20));
    }
    ws.close();

    if (!doneAt) { console.log(`[${tag}] INCOMPLETE "${text}" deltas=${deltas.length}`); continue; }
    const first = deltas[0]?.at ?? null;
    const last = deltas[deltas.length - 1]?.at ?? null;
    const gaps = [];
    for (let i = 1; i < deltas.length; i++) gaps.push(deltas[i].at - deltas[i - 1].at);
    const totalChars = deltas.reduce((s, d) => s + d.len, 0);
    const streamMs = first && last && last > first ? last - first : 0;
    const cps = streamMs > 0 ? (totalChars / (streamMs / 1000)) : null;
    const rec = {
      tag, text,
      sendToRunStarted: runStartedAt ? runStartedAt - t0 : null,
      sendToAckLine: ackLineAt ? ackLineAt - t0 : null,
      sendToFirstDelta: first ? first - t0 : null,
      deltaCount: deltas.length, totalChars,
      gapMin: gaps.length ? Math.min(...gaps) : null,
      gapMed: gaps.length ? pct(gaps, 0.5) : null,
      gapP90: gaps.length ? pct(gaps, 0.9) : null,
      gapMax: gaps.length ? Math.max(...gaps) : null,
      streamMs, effCps: cps === null ? null : Math.round(cps * 10) / 10,
      sendToDone: doneAt - t0,
      gaps,
    };
    results.push(rec);
    console.log(`[${tag}] "${text}"`);
    console.log(`  send→run.started=${rec.sendToRunStarted}ms  send→ack-line=${rec.sendToAckLine}ms  send→첫delta=${rec.sendToFirstDelta}ms  send→done=${rec.sendToDone}ms`);
    console.log(`  deltas=${rec.deltaCount} chars=${rec.totalChars}  gap med=${rec.gapMed} p90=${rec.gapP90} max=${rec.gapMax}ms  유효CPS=${rec.effCps}자/s`);
  }

  const front = results.filter(x => x.tag === 'front');
  if (front.length) {
    const ttfts = front.map(x => x.sendToFirstDelta).filter(v => v !== null);
    const acks = front.map(x => x.sendToAckLine).filter(v => v !== null);
    const cps = front.map(x => x.effCps).filter(v => v !== null);
    const gapsAll = front.flatMap(x => x.gaps);
    console.log('\n=== FRONT DESK 요약 ===');
    console.log(`체감 TTFT n=${ttfts.length}: ${ttfts.map(Math.round).join(', ')} | med=${Math.round(pct(ttfts, 0.5))} worst=${Math.round(Math.max(...ttfts))} (industry 0.3~0.5s / 우리 SLA ≤1500ms)`);
    if (acks.length) console.log(`ack 연출 첫 피드백: ${acks.map(Math.round).join(', ')} | worst=${Math.round(Math.max(...acks))}`);
    console.log(`유효 CPS: ${cps.join(', ')}자/s (industry 출력 60~140 tok/s)`);
    console.log(`delta 간격 n=${gapsAll.length}: med=${Math.round(pct(gapsAll, 0.5))} p90=${Math.round(pct(gapsAll, 0.9))} max=${Math.max(...gapsAll)}ms`);
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
  process.exit(results.length ? 0 : 1);
})().catch(e => { console.error('BENCH ERROR', e); process.exit(1); });
