// 리치텍스트 파서 — Wave 1 #4 (모든 텍스트 계열 카드 공통)
// 순수 함수 모듈(UI 의존 없음): 원문 → 세그먼트 리스트. 코드블록(```), 인용구(> 행),
// 마크다운 링크 [text](url), URL 자동 감지, 인라인 코드(`code`) 순으로 분리한다.
// 렌더(RichText.tsx)는 세그먼트를 Text/Pressable로 조립하고, 코드 세그먼트만 복제 대상이 된다.
export type RichSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'code'; text: string }
  | { kind: 'codeblock'; text: string }
  | { kind: 'quote'; text: string };

export const isSafeLink = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password;
  } catch { return false; }
};

/** 코드블록과 나머지를 분리한다. 닫히지 않은 ```는 끝까지 코드블록으로 본다. */
function splitCodeBlocks(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  const fence = /```[\w+-]*\n?([\s\S]*?)```|```[\w+-]*\n?([\s\S]*)$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    if (m.index > last) pushQuoteAware(text.slice(last, m.index), out);
    const body = (m[1] ?? m[2] ?? '').replace(/\n$/, '');
    if (body) out.push({ kind: 'codeblock', text: body });
    last = fence.lastIndex;
    if (m[2] !== undefined) break; // 열리고 닫히지 않은 블록 — 여기서 종료
  }
  if (last < text.length) pushQuoteAware(text.slice(last), out);
  return out;
}

/** 줄 단위: '>' 로 시작하면 quote, 나머지는 인라인 토큰으로 보낸다. */
function pushQuoteAware(chunk: string, out: RichSegment[]): void {
  if (!chunk) return;
  let buffer = '';
  const flush = () => { if (buffer) { pushInline(buffer, out); buffer = ''; } };
  const lines = chunk.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      out.push({ kind: 'quote', text: quote[1] });
    } else {
      buffer += (buffer || i > 0 ? '\n' : '') + line;
    }
  }
  flush();
}

/** 마크다운 링크 → 인라인 코드 → URL 자동 감지 순으로 토큰 분리. */
function pushInline(chunk: string, out: RichSegment[]): void {
  if (!chunk) return;
  const mdRe = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(chunk))) {
    if (m.index > last) pushCode(chunk.slice(last, m.index), out);
    const url = m[2].replace(/[.,;:!?)]+$/, '');
    if (isSafeLink(url)) {
      out.push({ kind: 'link', text: m[1], url });
      const trailing = m[2].slice(url.length);
      if (trailing) pushCode(trailing, out);
    } else {
      pushCode(m[0], out); // 안전하지 않은 대상은 원문 그대로 텍스트
    }
    last = mdRe.lastIndex;
  }
  if (last < chunk.length) pushCode(chunk.slice(last), out);
}

function pushCode(chunk: string, out: RichSegment[]): void {
  if (!chunk) return;
  const codeRe = /`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(chunk))) {
    if (m.index > last) pushUrls(chunk.slice(last, m.index), out);
    out.push({ kind: 'code', text: m[1] });
    last = codeRe.lastIndex;
  }
  if (last < chunk.length) pushUrls(chunk.slice(last), out);
}

function pushUrls(chunk: string, out: RichSegment[]): void {
  if (!chunk) return;
  const urlRe = /https?:\/\/[^\s<>()[\]"'`]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(chunk))) {
    if (m.index > last) out.push({ kind: 'text', text: chunk.slice(last, m.index) });
    const raw = m[0];
    const url = raw.replace(/[.,;:!?)]+$/, '');
    if (isSafeLink(url)) {
      out.push({ kind: 'link', text: url, url });
      last = m.index + url.length; // 말미 구두점은 다음 반복/마무리에서 텍스트로 복원
      urlRe.lastIndex = last;
    } else {
      out.push({ kind: 'text', text: raw });
      last = urlRe.lastIndex;
    }
  }
  if (last < chunk.length) out.push({ kind: 'text', text: chunk.slice(last) });
}

/** 원문 → 렌더 가능 세그먼트 리스트. 빈 입력은 빈 배열. */
export function parseRichText(text: string | undefined | null): RichSegment[] {
  if (!text || typeof text !== 'string') return [];
  return splitCodeBlocks(text);
}

/** 링크 세그먼트 URL만 추출 (테스트·프리로드용). */
export function extractLinks(segments: RichSegment[]): string[] {
  return segments.flatMap((s) => (s.kind === 'link' ? [s.url] : []));
}

export interface PayloadLink { label: string; url: string }

/** payload.links 검증 — 라벨/안전 URL만 통과 (전달 기능 링크 버튼). */
export function safePayloadLinks(value: unknown): PayloadLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({ label: typeof item.label === 'string' ? item.label : '', url: typeof item.url === 'string' ? item.url : '' }))
    .filter((item) => !!item.label && isSafeLink(item.url));
}
