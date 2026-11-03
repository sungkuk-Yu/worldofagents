// scripts/groupChatP1Bench.mts — P1/P2 재구축 실측 (정본 eval 30문항 재실행 + ping-pong 예산 중단 로그)
// p009 매니페스트 준거: 같은 frozen eval(sha256 검증), 라우터 qwen3.8-flash temp0 out256 thinking-off
// timeout30s fallback-사용불가(1회 재시도 후 fail-closed), 저신뢰 threshold .5 action=clarify.
// 라이브 DB/라우트 HTTP 미사용 — 워크트리 라이브러리 직접 호출. 키는 env 파일에서 로드하고 어떤 출력에도 적지 않는다.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const EVAL_PATH = '/home/holysky87/.hermes/kanban/attachments/t_1265ed1f/groupchat-p1-routing-eval.json';
const PROTOCOL_PATH = '/home/holysky87/.hermes/kanban/attachments/t_1265ed1f/groupchat-p1-routing-protocol.md';
const EXPECT_EVAL_SHA = '333402514cd3e67788fd927e114b158faa63094e99a3020087af4c36959356a3';
const EXPECT_PROTO_SHA = '53f40eebdb268e023f7aeddd6e6b9715874edbbf51a81718eee335e296261d52';
const OUT_DIR = process.env.BENCH_OUT || '/home/holysky87/.hermes/profiles/backdev/cache/scratch/p010';
const RUN_ID = process.env.BENCH_RUN_ID || 'p010-2026-11-02';
const SUITE = 'groupchat-p1-routing-v1';

// ── 0) 환경: 정본 env 백업에서 LLM 키만 프로세스 내부로 (출력·파일에 값 금지)
function loadKeys() {
  const cand = ['/home/holysky87/.config/myagenttalk/backend.env', '/home/holysky87/.config/myagenttalk/backend.env.bak'];
  const SKIP = /^(SUPABASE|JWT_|VAULT_|ANTHROPIC|.*_FB_|.*_FB$|PERPLEXITY|OPENAI|STT_|CONTEXT_|UPLOAD_|LOCAL_FRONT_)/;
  const KEEP = /^(DASHSCOPE_API_KEY|CHAT_LLM_(BASE_URL|MODEL|DEEP_MODEL))$/;
  for (const p of cand) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      const k = m[1];
      if (SKIP.test(k) || !KEEP.test(k)) continue;
      if (!process.env[k]) process.env[k] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    break;
  }
}
loadKeys();

const { routePmTurn, normalizeMentions } = await import(resolve(process.cwd(), 'src/lib/pmRouter.ts'));
const { chatCompletion } = await import(resolve(process.cwd(), 'src/lib/llm.ts'));
const { buildAgentEnvelopes } = await import(resolve(process.cwd(), 'src/lib/groupChatContext.ts'));
const { runAgentTurns } = await import(resolve(process.cwd(), 'src/lib/groupTurnRuntime.ts'));
const { fakeDb, envelope } = await import(resolve(process.cwd(), 'tests/fakeDb.ts'));

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const evalSha = sha(EVAL_PATH);
const protoSha = sha(PROTOCOL_PATH);
if (evalSha !== EXPECT_EVAL_SHA) { console.log(`EVAL SHA MISMATCH: ${evalSha}`); process.exit(2); }
console.log(`frozen eval sha ok: ${evalSha.slice(0, 12)}… / protocol: ${protoSha.slice(0, 12)}…`);

const ROOM = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000000';
const tokOf = (u: any) => u ? (u.prompt_tokens ?? u.input_tokens ?? 0) + (u.completion_tokens ?? u.output_tokens ?? 0) : 0;
const nameToId = (n: string) => `00000000-0000-4000-8000-${Buffer.from(n).toString('hex').padEnd(12, '0').slice(0, 12)}`;
const idToName = new Map<string, string>();

const SETTINGS = {
  model: 'qwen3.8-flash', temperature: 0, max_output_tokens: 256, timeout_ms: 30000,
  enable_thinking: false, fallback: 'disabled(primary-chain-only)', transport_retry: 1,
  low_confidence: 'threshold=0.5 action=clarify',
};

// ── 1) P1 라우팅 실측 (30문항)
async function p1Bench() {
  const evalDoc = JSON.parse(readFileSync(EVAL_PATH, 'utf8'));
  process.env.PM_ROUTER_MODEL = SETTINGS.model;
  process.env.PM_ROUTER_LOW_CONF = '0.5';
  process.env.PM_ROUTER_LOW_CONF_ACTION = 'clarify';

  const lines: any[] = [];
  const counts = { attempted: 0, completed: 0, degraded: [] as string[], model_path: 0, rule_path: 0, transport_retries: 0 };
  const acc = { responders_ok: 0, mode_ok: 0, json_first: 0, json_total: 0, clarify_ok: 0, clarify_cases: 0, total_tokens: 0 };

  for (const c of evalDoc.cases) {
    counts.attempted++;
    idToName.clear();
    for (const r of c.roles) idToName.set(nameToId(r.id), r.id);
    const roleCards = c.roles.map((r: any) => ({ agentId: nameToId(r.id), name: r.id, role: r.role }));
    const req = {
      roomId: ROOM, ownerId: OWNER, messageId: `bench-${c.id}`,
      message: c.message,
      mentions: normalizeMentions((c.mentions ?? []).map((m: string) => m), new Set(Object.keys(c.roles).map((k: string) => nameToId(c.roles[k].id)))),
      replyTo: c.reply_to ? { authorType: 'agent', authorId: nameToId(c.reply_to) } : null,
      roleCards,
      threadSummary: c.thread_summary ?? null,
    };
    let lastUsage: any = null;
    const chat = async (opts: any) => {
      const r = await chatCompletion({ ...opts, model: SETTINGS.model, temperature: SETTINGS.temperature, maxTokens: SETTINGS.max_output_tokens, timeoutMs: SETTINGS.timeout_ms, enableThinking: false });
      lastUsage = r.usage ?? null;
      return r;
    };
    let out: any; let attempts = 0; let transportErrors = 0; let degraded: string | null = null;
    for (;;) {
      try { out = await routePmTurn(req as any, { chat } as any); break; }
      catch (e: any) {
        transportErrors++; attempts++;
        if (attempts >= SETTINGS.transport_retry + 1) { degraded = e?.code ?? 'UNKNOWN'; out = null; break; }
      }
    }
    if (!out) { counts.degraded.push(c.id); }
    else {
      counts.completed++;
      if (out.route_source === 'model') counts.model_path++; else counts.rule_path++;
      if (out.route_source === 'model') {
        acc.json_total++;
        if (!out.degraded) acc.json_first++; // 1차 파싱 성공 = 모델 JSON 유효
      }
    }
    const gotIds = out ? out.decision.responders : [];
    const gotNames = gotIds.map((i: string) => idToName.get(i) ?? i);
    const wantMode = c.expected_mode;
    const isClarify = wantMode === 'clarify' || (Array.isArray(c.expected_responders) && c.expected_responders.length === 0 && wantMode !== 'single' && wantMode !== 'parallel' && wantMode !== 'sequence');
    let respondersOk = false; let modeOk = false;
    if (out && !degraded) {
      if (isClarify) {
        acc.clarify_cases++;
        respondersOk = out.clarify === true && gotIds.length === 0;
        modeOk = out.clarify === true;
        if (respondersOk) acc.clarify_ok++;
      } else {
        respondersOk = JSON.stringify([...gotNames].sort()) === JSON.stringify([...c.expected_responders].sort());
        modeOk = out.decision.mode === wantMode;
      }
      if (respondersOk) acc.responders_ok++;
      if (modeOk) acc.mode_ok++;
      const u: any = lastUsage ?? {};
      acc.total_tokens += (u.prompt_tokens ?? u.input_tokens ?? 0) + (u.completion_tokens ?? u.output_tokens ?? 0);
    }
    lines.push({
      suite_id: SUITE, run_id: RUN_ID, case_id: c.id, category: c.category,
      expected: { responders: c.expected_responders, mode: c.expected_mode },
      settings: SETTINGS, prompt_version: 'f329af48eb87db83',
      input: {
        message_chars: c.message.length, role_card_count: c.roles.length,
        reply_to: c.reply_to, mention_count: (c.mentions ?? []).length,
        thread_summary_chars: (c.thread_summary ?? '').length, expected_fields_leaked: false,
      },
      route_source: out?.route_source ?? 'degraded', degraded,
      clarify_signal: out?.clarify ?? null, attempts, transport_errors: transportErrors,
      parsed: out ? { responders: gotNames, mode: out.decision.mode, confidence: out.decision.confidence, raw_confidence: out.audit?.raw_confidence ?? null, audit: out.audit } : null,
      agreement: { responders_ok: respondersOk, mode_ok: modeOk },
      usage: lastUsage,
    });
  }

  const metrics = {
    completion_rate: `${counts.completed}/${counts.attempted}`,
    routing_accuracy_responder_exact: `${acc.responders_ok}/${counts.completed}`,
    mode_accuracy: `${acc.mode_ok}/${counts.completed}`,
    json_validity_first_raw: `${acc.json_first}/${acc.json_total}`,
    clarify_accuracy: `${acc.clarify_ok}/${acc.clarify_cases}`,
    total_tokens_router: acc.total_tokens,
  };
  writeFileSync(`${OUT_DIR}/groupchat-p1-${RUN_ID}-run.jsonl`,
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { counts, metrics };
}

// ── 2) P2 ping-pong 실측 (실모델 발화, 예산 내 중단)
async function p2Bench() {
  const coder = nameToId('coder'); const legal = nameToId('legal');
  const store: any = {
    group_rooms: [{ id: ROOM, owner_id: OWNER }],
    group_room_members: [
      { room_id: ROOM, member_type: 'agent', member_id: coder },
      { room_id: ROOM, member_type: 'agent', member_id: legal },
    ],
    group_messages: [
      { id: 'anchor', room_id: ROOM, author_type: 'user', author_id: OWNER, content: '결제 모듈 리팩터링을 시작합니다. 리뷰 부탁해요.', parent_id: null, mentions: [], created_at: '2026-11-02T18:00:00Z' },
    ],
    group_turns: [{ id: 'p2turn', room_id: ROOM, status: 'open', utterance_count: 0, handoff_count: 0, token_count: 0 }],
  };
  const db = fakeDb(store);
  const envs = await buildAgentEnvelopes(db as any, {
    roomId: ROOM, ownerId: OWNER, anchorMessageId: 'anchor',
    decision: { responders: [coder, legal], mode: 'sequence', confidence: 1 },
  } as any);
  const names: Record<string, string> = { [coder]: '코더', [legal]: '법무' };
  const roleOf: Record<string, string> = { [coder]: '백엔드 코드 리뷰어', [legal]: '개인정보/법률 검토 담당' };
  const speakLog: any[] = [];
  const budget = { maxUtterances: 6, maxHandoffs: 2, tokenCap: 2500 };

  const speak = async (agentId: string, ctx: any) => {
    const myName = names[agentId]; const other = agentId === coder ? '법무' : '코더';
    const thread = (ctx?.envelope?.own_thread ?? []).map((m: any) => `${m.author_type}:${m.content}`).join('\n');
    const res = await chatCompletion({
      model: 'qwen3.6-flash', temperature: 0, maxTokens: 128, timeoutMs: 30000, enableThinking: false,
      messages: [
        { role: 'system', content: `너는 "${roleOf[agentId]}" 에이전트(${myName}). 그룹 채팅 답변을 한국어 한 문장(40자 이하)으로 해라. 상대 에이전트(${other})에게 순서가 넘어가야 하면 마지막 줄에 "PASS: ${other}"라고 적어라. 아니면 PASS 줄을 쓰지 마라.` },
        { role: 'user', content: `질문: ${ctx?.envelope?.anchor?.content ?? '결제 모듈 리팩터링 리뷰'}\n내 스레드:\n${thread}` },
      ],
    });
    const raw = res.text.trim();
    const pm = raw.match(/PASS:\s*(\S+)/);
    const text = pm ? raw.slice(0, pm.index).trim() : raw;
    const passName = pm ? pm[1] : undefined;
    const pass_to = passName === '코더' ? coder : passName === '법무' ? legal : passName || undefined;
    speakLog.push({ agent: myName, text, pass_to: passName ?? null, tokens: tokOf(res.usage) });
    return { text, tokens: tokOf(res.usage), pass_to };
  };

  const result = await runAgentTurns(db as any, {
    roomId: ROOM, ownerId: OWNER, turnId: 'p2turn', anchorMessageId: 'anchor',
    mode: 'sequence',
    envelopes: envs as any,
    agentIds: new Set([coder, legal]),
    agentNames: { 코더: coder, 법무: legal, coder, legal },
    speak,
    summarize: async ({ reason }: any) => ({ text: `한도 도달(${reason}) — 논의를 멈추고 요약합니다.`, tokens: 8 }),
    budget,
  } as any);

  const out = {
    run_id: RUN_ID, suite: 'groupchat-p2-pingpong-v1', budget,
    status: result.status, stop_reason: result.stop_reason,
    utterances: result.utterances, handoffs: result.handoffs, tokens: result.tokens,
    utterance_log: speakLog,
    turn_row: store.group_turns[0],
    stored_kinds: store.group_messages.filter((m: any) => m.author_type === 'agent').map((m: any) => m.kind),
  };
  writeFileSync(`${OUT_DIR}/groupchat-p2-${RUN_ID}-pingpong.json`, JSON.stringify(out, null, 2));
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });
const started = new Date().toISOString();
const p1 = await p1Bench();
const p2 = await p2Bench();
const completed = new Date().toISOString();
const manifest = {
  suite_id: SUITE, run_id: RUN_ID, run_status: 'executed', supersedes: 'p009-2026-11-02',
  started_at_utc: started, completed_at_utc: completed,
  code_ref: 'feat/groupchat-p1-rebuild@working-tree (pmRouter.ts/groupChatContext.ts/groupTurnRuntime.ts)',
  frozen_inputs: { eval_sha256: evalSha, protocol_sha256: protoSha },
  endpoint: { host: 'dashscope-intl.aliyuncs.com', path: '/compatible-mode/v1', ...SETTINGS },
  counts: p1.counts, metrics: p1.metrics,
  p2: { stop_reason: p2.stop_reason, utterances: p2.utterances, handoffs: p2.handoffs, budget },
};
writeFileSync(`${OUT_DIR}/groupchat-p1-${RUN_ID}-manifest.json`, JSON.stringify(manifest, null, 2));
console.log('P1 counts:', JSON.stringify(p1.counts));
console.log('P1 metrics:', JSON.stringify(p1.metrics));
console.log('P2:', p2.stop_reason, 'utterances', p2.utterances, 'handoffs', p2.handoffs);
console.log('OUT:', OUT_DIR);
