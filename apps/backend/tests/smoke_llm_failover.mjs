/**
 * LLM failover live smoke (t_67eaf475).
 *
 * DashScope outage is simulated by pointing the primary baseUrl at a closed
 * local port (runtime config mutation). The emergency-power fallback must then
 * answer for real (one small completion) and the pool must expose both ids.
 *
 * Usage (from apps/backend, .env loaded first):
 *   set -a && . ./.env && set +a
 *   node tests/smoke_llm_failover.mjs
 */
const { config } = await import('../src/config.ts');
const { chatCompletion, llmProviderChain } = await import('../src/lib/llm.ts');

if (!config.chatLlmFallback.apiKey) {
  console.error('FAIL: emergency power not configured - set CHAT_LLM_FB_KEY in .env first');
  process.exit(1);
}
config.chatLlm.baseUrl = 'http://127.0.0.1:9/v1'; // dead primary (discard port)

const chain = llmProviderChain();
console.log('chain:', chain.map(p => p.id));
if (chain.length < 2 || chain[chain.length - 1].id !== 'fallback') {
  console.error('FAIL: pool must be primary -> fallback');
  process.exit(1);
}

const r = await chatCompletion({
  messages: [{ role: 'user', content: 'Answer with exactly one word: lion' }],
  maxTokens: 16,
  timeoutMs: 30000,
});
console.log(JSON.stringify({ provider: r.provider, fallback: r.fallback, model: r.model, text: r.text.slice(0, 40) }));
if (r.provider !== 'fallback' || r.fallback !== true || !r.text) {
  console.error('FAIL: fallback did not answer');
  process.exit(1);
}
console.log('PASS: DashScope outage -> emergency power answered (live)');
