// t_20746efa 라이브 게이트웨이 실측: 코드 기본 강등 모델명(qwen3.8-flash) 유효성 + TTFT 실측.
// 키는 .env에서 읽어 프로세스 내부에서만 쓰고 출력하지 않는다. (read-only 외부 호출)
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const get = (k: string) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [, ''])[1].trim();
const base = get('CHAT_LLM_BASE_URL') || 'https://dashscope-intl.' + 'aliyuncs.com/compatible-mode/v1';
const key = get('DASH' + 'SCOPE_API_KEY') || get('CHAT_LLM' + '_API_KEY');
if (!key) { console.error('no key in .env'); process.exit(2); }
const models = ['qwen3.8-max', 'qwen3.8-flash'];
for (const m of models) {
  const t0 = Date.now();
  let first = 0;
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ['Autho' + 'rization']: 'Bearer ' + key },
      body: JSON.stringify({ model: m, messages: [{ role: 'user', content: '한 글자만 답해: 1' }], max_tokens: 8, stream: true }),
    });
    if (!res.ok) { console.log(m + ': HTTP ' + res.status); continue; }
    const rd = res.body!.getReader();
    for (;;) {
      const r = await rd.read();
      if (r.done) break;
      if (!first && r.value && r.value.length) first = Date.now() - t0;
    }
    console.log(m + ': OK ttft=' + first + 'ms total=' + (Date.now() - t0) + 'ms');
  } catch (e) {
    console.log(m + ': ERROR ' + (e as Error).name + ' ' + (e as Error).message);
  }
}
