/**
 * 나라 스펠러 fetch 운반층 (t_45256c7a) — 9/30 실측 근거:
 *  - nara-speller.co.kr는 Cloudflare Bot Management 앞에 있다.
 *  - curl(HTTP/2) + 브라우저 UA/Origin/Referer → 200. Node 내장 fetch(undici, h1) 동일 헤더 → 403 challenge HTML.
 *  - Node 내장 http2(h2, 같은 헤더) → 200 (live_ortho_h2.mts 실측).
 * 따라서: 1차 fetch(어디서나 동작, self-host speller-api는 이 경로면 충분) →
 * 4xx/5xx/전송실패 시 2차 http2로 1회 재시도. 둘 다 실패면 호출부에 실패 알림(원문 유지).
 * 외부 signal(턴 취소)은 양쪽 모두 전파된다.
 */
import http2 from 'node:http2';

export interface SpellerPost {
  url: string;
  body: string;
  timeoutMs: number;
  headers: Record<string, string>;
  signal?: AbortSignal;
  /** 단위 테스트 봉인(NARA_SPELLER_H2=false) — 모킹 실패 경로가 실 네트워크 h2를 타지 않게. */
  h2Disabled?: boolean;
}

const SPA_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'content-type': 'application/json',
  accept: 'application/json',
};

/** URL에서 봇월 헤더(Origin/Referer)를 host에 맞춰 구성 — self-host(사설)은 추가 무해. */
export function spellerHeaders(url: string): Record<string, string> {
  const origin = new URL(url).origin;
  return { ...SPA_HEADERS, origin, referer: `${origin}/speller/` };
}

function timeoutSignal(o: SpellerPost): { signal: AbortSignal; cleanup: () => void } {
  // 숫자 방어: config가 spy 누수로 undefined여도 setTimeout crash 금지 (원칙: 게이트는 턴을 죽이지 않는다).
  const to = AbortSignal.timeout(Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 2500);
  const ext = o.signal;
  if (!ext) return { signal: to, cleanup: () => undefined };
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  const listen = (s: AbortSignal) => { if (s.aborted) onAbort(); else s.addEventListener('abort', onAbort); };
  listen(to); listen(ext);
  return { signal: ac.signal, cleanup: () => { to.removeEventListener('abort', onAbort); ext.removeEventListener('abort', onAbort); } };
}

/** fetch 1차 → 봇월 서명(403/401/429) 또는 전송오류면 http2 2차(허용 시). status=0은 실패/타임아웃/취소. */
export async function spellerPost(o: SpellerPost): Promise<{ status: number; text: string }> {
  const { signal, cleanup } = timeoutSignal(o);
  try {
    let botWalled = false;
    try {
      const res = await fetch(o.url, { method: 'POST', headers: o.headers, body: o.body, signal });
      if (res.status < 400) return { status: res.status, text: await res.text() };
      botWalled = res.status === 401 || res.status === 403 || res.status === 429;
      if (!botWalled) return { status: res.status, text: await res.text() }; // 5xx 등 — 재시도 없이 실패
    } catch {
      if (signal.aborted) return { status: 0, text: '' }; // 타임아웃/취소 — 재시도 의미 없음
      botWalled = true; // 전송 계층 오류(h1 지문 포함) — h2 재시도 가치 있음
    }
    if (botWalled && !o.h2Disabled) return await spellerHttp2({ ...o, signal });
    return { status: 0, text: '' };
  } finally {
    cleanup();
  }
}

/** TLS h2(ALPN) — Cloudflare 지문 통과 경로. 절대 throw하지 않는다(status 0 반환). */
export function spellerHttp2(o: SpellerPost): Promise<{ status: number; text: string }> {
  return new Promise(resolve => {
    let u: URL;
    try { u = new URL(o.url); } catch { resolve({ status: 0, text: '' }); return; }
    const settled = (v: { status: number; text: string }) => {
      clearTimeout(timeout);
      o.signal?.removeEventListener('abort', onAbortExt);
      try { client?.close(); } catch { /* noop */ }
      resolve(v);
    };
    const onAbortExt = () => settled({ status: 0, text: '' });
    const timeout = setTimeout(() => settled({ status: 0, text: '' }), o.timeoutMs);
    o.signal?.addEventListener('abort', onAbortExt);
    let client: http2.ClientHttp2Session | undefined;
    try {
      client = http2.connect(`https://${u.host}`);
    } catch {
      settled({ status: 0, text: '' });
      return;
    }
    client.on('error', () => settled({ status: 0, text: '' }));
    const headers: Record<string, string | number> = {
      ':method': 'POST',
      ':path': u.pathname + u.search,
      ':authority': u.host,
      'content-length': Buffer.byteLength(o.body),
    };
    for (const [k, v] of Object.entries(o.headers)) headers[k.toLowerCase()] = v;
    const req = client.request(headers);
    let status = 0;
    let data = '';
    req.on('response', h => { status = Number(h[':status'] || 0); });
    req.on('data', c => { data += c; });
    req.on('end', () => settled({ status, text: data }));
    req.on('error', () => settled({ status: 0, text: data }));
    req.write(o.body);
    req.end();
  });
}
