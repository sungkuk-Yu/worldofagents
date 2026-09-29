// 채팅 버블 마크다운 게이트 (t_e9480e0f 백로그①) — 순수 함수 모듈(UI 의존 없음).
// 원칙(카드 검수조항): 마크다운 문법을 쓰지 않은 답변은 기존 RichText(Wave1) 경로로 100% 동일 렌더.
// 따라서 마크다운 판정 트리거는 RichText가 이미 처리하는 기능(마크다운 링크/인라인 코드/인용/
// 코드블록)이 아니라, RichText가 못 그리는 블록 문법(헤딩/리스트/볼드/표/hr)만 본다.
// 스트리밍 partially-valid 안전화(리서치 기준 — Prompt Bench/Streamdown): 미닫힌 ``` fence는
// 즉시 닫아 코드블록으로 임시 마감 렌더하고, answer.done의 최종 텍스트에서 자연 재파싱한다.
// 매 flush 누적 텍스트에 게이트·안전화를 재적용하는 형태(t_5c559e85 delta patch와 직교).

/** RichText가 못 그려 마크다운 렌더러로 넘겨야 하는 블록 문법인지 판정한다. */
const MD_TRIGGERS: RegExp[] = [
  /^#{1,6}[ \t]+\S/m,                      // 헤딩 (# ~ ######)
  /^[ \t]*(?:[-*+])[ \t]+\S/m,             // 비순서 목록 (- a / * a / + a)
  /^[ \t]*\d+[.)][ \t]+\S/m,               // 순서 목록 (1. a / 1) a)
  /\*\*[^*\n]+\*\*/,                       // 볼드 **text**
  /^[ \t]{0,3}(?:-{3,}|_{3,}|\*{3}[ \t]*)$/m, // 구분선 hr
  /\|[^\n]*\|[^\n]*\n[ \t]*[:|\- ]*\|/,    // 표 (헤더 행 + 파이프 구분 행)
];

export function looksLikeChatMarkdown(text: string | undefined | null): boolean {
  if (!text || typeof text !== 'string') return false;
  return MD_TRIGGERS.some((re) => re.test(text));
}

/** 라인 시작 ``` fence 카운트 홀수 = 열리고 안 닫힌 블록 (markdown-it과 동일하게 줄 시작만 인정). */
export function hasOpenFence(text: string): boolean {
  const fences = text.match(/^[ \t]*```/gm);
  return fences ? fences.length % 2 === 1 : false;
}

/**
 * 스트리밍 부분 텍스트 안전화:
 * ① 마지막 줄이 백틱 1~2개로만 구성됐으면(미완 fence 헤더; 3개 완성 전 토글 오집행 방지) 잘라낸다.
 *    인라인 `code`의 열림 백틱은 같은 줄에 다른 문자가 있어 보호된다.
 * ② 열린 fence가 홀수면 '\n```'를 append해 코드블록으로 임시 마감한다(Streamdown orphan-fence closure).
 * 최종(answer.done) 텍스트에는 손대지 않는다 — 호출측이 streaming 상태일 때만 이 함수를 쓴다.
 */
export function stabilizeStreamingMarkdown(text: string): string {
  if (!text) return text;
  let out = text;
  const nl = out.lastIndexOf('\n');
  const lastLine = out.slice(nl + 1);
  if (/^`{1,2}[ \t]*$/.test(lastLine)) {
    out = nl >= 0 ? out.slice(0, nl) : '';
  }
  if (hasOpenFence(out)) out += '\n```';
  return out;
}
