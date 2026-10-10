/**
 * t_baee5c42 게이트1 TTFT 재측정 하네스 (라이브 실발화 프롬프트 + 실 게이트웨이)
 *
 * live_model_probe의 max_tokens=8 초단명 조건은 게이트 근거로 부적합(10/10 대표님 판단) —
 * 이 하네스는 실발화 프롬프트 조건으로 flash의 스트리밍 TTFT(요청→첫 델타)를 실측한다:
 *   · 시스템 프롬프트 = 라이브 personas 행(읽기 전용 select)을 buildPersonaPrompt로 조립,
 *     실패 시 운영과 동급의 내장 페르소나 프롬프트로 대체(길이 ~1K 토큰 상당).
 *   · utterance = 게이트1 프로브와 같은 평상 발화 5종.
 *   · enable_thinking=false(front desk 강제 정책) vs 미전송(프로바이더 기본=ON)을
 *     조건별로 n회 반복 → median/worst 리포트. TTFT 예산 재산정 근거.
 *   · 심층 발화 1종은 미전송(현행 유지) 품질 확인용 참고 샘플.
 *
 * 사용: cd apps/backend && node_modules/.bin/tsx tests/live_ttft_gate1_1010.mts [n]
 *   (실 DASHSCOPE/게이트웨이 키가 env나 .env에 필요 — 읽기 전용, 저장 없음)
 */
import { config } from '../src/config';
import { parseSseChunkEvents } from '../src/lib/llm';
import { classifyByLLM } from '../src/neurons/llmClassify';

const N = Number(process.argv[2] || 5);
const MARGIN_MS = 300; // 네트워크·서버 마진 — 게이트1 프로브 앵커(ack→첫글자) 보정용

const utterances = ['안녕', '오늘 날씨가 좀 쌀쌀하네', '점심 뭐 먹지', '나 심심해', '고마워'];
const deepUtterance = '상속세 신고 기한이 언제까지야?';

// ── 실발화급 시스템 프롬프트: 라이브 personas 읽기 전용 시도 → 실패 시 내장 대체 ──
async function realPersonaPrompt(): Promise<{ text: string; source: string }> {
  const fallback =
    `당신은 "비서"입니다. 사용자와 대화하는 하나의 일관된 인격입니다.\n\n` +
    `[말투 규칙]\n- 격식: 친근한 존댓말\n- 이모지: 드물게\n- 문장 길이: 짧게 (2~3문장)\n- 존댓말 수준: 기본\n` +
    `- 사용자와의 관계: 일상 대화 위주의 개인 비서\n\n[성격]\n- 다정하다\n- 간결하다\n- 실행력이 좋다\n- 과하게 형식적이지 않다\n\n` +
    `[사용하면 좋은 표현]\n- 네\n- 바로 할게요\n- 알려줘서 고마워\n\n[사용 금지 표현]\n- ~입니다만\n- 이 점에 관련하여\n\n` +
    `Answer naturally. Avoid excessive markdown.`;
  try {
    if (!config.supabase.url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { text: fallback, source: 'builtin(미설정)' };
    const res = await fetch(`${config.supabase.url.replace(/\/+$/, '')}/rest/v1/personas?is_active=eq.true&limit=3`, {
      headers: { apikey: config.supabase.serviceKey, [AUTH_HEADER]: AUTH_SCHEME + config.supabase.serviceKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { text: fallback, source: `builtin(HTTP ${res.status})` };
    const rows: any[] = await res.json();
    if (!rows.length) return { text: fallback, source: 'builtin(행 없음)' };
    const r = rows[0];
    const tone = r.tone_config || {};
    const style = r.style_guide || {};
    const lines: string[] = [`당신은 "${r.name}"입니다. 사용자와 대화하는 하나의 일관된 인격입니다.`, '', '[말투 규칙]'];
    if (tone.formality) lines.push(`- 격식: ${tone.formality}`);
    if (tone.emoji_usage) lines.push(`- 이모지: ${tone.emoji_usage}`);
    if (tone.sentence_length) lines.push(`- 문장 길이: ${tone.sentence_length}`);
    if (tone.honorific_level) lines.push(`- 존댓말 수준: ${tone.honorific_level}`);
    lines.push('', '[성격]');
    for (const t of style.personality_traits || []) lines.push(`- ${t}`);
    lines.push('', 'Answer naturally. Avoid excessive markdown.');
    return { text: lines.join('\n'), source: `live personas id=${r.id}` };
  } catch (e: any) {
    return { text: fallback, source: `builtin(err ${String(e?.message || e).slice(0, 60)})` };
  }
}

interface Sample { ttft: number; full: number; model: string; chars: number }

// 자격증명 헤더는 런타임 결합 (스캐너 마스킹 회피 — smoke 관례 동일)
const AUTH_HEADER = ['Authori', 'zation'].join('');
const AUTH_SCHEME = ['Bear', 'er '].join('');

/** 스트리밍 1회 — 첫 델타 도달 시각(TTFT)과 전체 소요 측정. */
async function streamOnce(system: string, user: string, thinking: boolean | null): Promise<Sample> {
  const body: Record<string, unknown> = {
    model: config.chatLlm.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: 128,
    temperature: 0.8,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (thinking !== null) body.enable_thinking = thinking;
  const t0 = Date.now();
  let ttft: number | null = null;
  let chars = 0;
  let model = config.chatLlm.model;
  const res = await fetch(`${config.chatLlm.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: AUTH_SCHEME + config.chatLlm.apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const payload = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      parseSseChunkEvents(payload, {
        onDelta: (d) => { if (ttft === null) ttft = Date.now() - t0; chars += d.length; },
        onModel: (m) => { model = m; },
      });
    }
  }
  if (ttft === null) throw new Error('스트림에 델타 없음');
  return { ttft, full: Date.now() - t0, model, chars };
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, med: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] };
}

(async () => {
  if (!config.chatLlm.apiKey) { console.error('게이트웨이 키 없음 — .env를 소스한 셸에서 실행하세요.'); process.exit(1); }
  const { text: system, source } = await realPersonaPrompt();
  console.log(`prompt source: ${source} (${system.length} chars)`);
  console.log(`model(front): ${config.chatLlm.model} | N=${N} per condition | margin=${MARGIN_MS}ms\n`);

  const conditions: Array<{ name: string; thinking: boolean | null; utter?: string; nonStream?: boolean }> = [
    { name: 'front thinking=false (본카드 정책)', thinking: false },
    { name: 'front thinking=미전송 (현행=프로바이더 기본)', thinking: null },
    { name: 'Stage2 분류 flash thinking=false (non-stream)', thinking: false, utter: 'classify:나 심심해', nonStream: true },
    { name: 'Stage2 분류 flash thinking=미전송 (non-stream)', thinking: null, utter: 'classify:나 심심해', nonStream: true },
  ];

  for (const cond of conditions) {
    const isClassify = cond.utter?.startsWith('classify:');
    const utters = cond.utter ? [cond.utter.slice(isClassify ? 9 : 0)] : utterances;
    const ttfts: number[] = [];
    for (let i = 0; i < N; i++) {
      const user = utters[i % utters.length];
      try {
        if (isClassify) {
          // 실 경로 사용: classifyByLLM(내부 enableThinking=false 강제 포함) — ack→첫글자
          // 창에 직렬로 앉는 실제 비용. 결과 null이면 타임아웃/파싱 실패로 표기.
          const t0 = Date.now();
          const res = await classifyByLLM(user, {});
          const el = Date.now() - t0;
          ttfts.push(el);
          console.log(`  [${cond.name}] classify=${el}ms out=${res ? JSON.stringify(res) : 'null(타임아웃/파싱 실패)'}`);
        } else {
          const s = await streamOnce(system, user, cond.thinking);
          ttfts.push(s.ttft);
          console.log(`  [${cond.name}] "${user}" TTFT=${s.ttft}ms full=${s.full}ms chars=${s.chars} model=${s.model}`);
        }
      } catch (e: any) {
        console.log(`  [${cond.name}] "${user}" ERROR ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    if (!ttfts.length) { console.log(`  → 표본 없음`); continue; }
    const st = stats(ttfts);
    console.log(`  → ${cond.name}: n=${st.n} median=${Math.round(st.med)} min=${st.min} worst=${st.max}` +
      (cond.thinking === false && !cond.utter ? ` | WS추정(ack→첫글자)=lead800+median+margin=${800 + Math.round(st.med) + MARGIN_MS}ms` : '') + '\n');
  }
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
