/**
 * 한국어 어문 규칙 (한글 문법①-백, t_45256c7a — 대표님 9/30: "이해오"류 깨진 표기 재발 방지)
 *
 * ① ORTHO_RULES — answerNode 시스템 프롬프트에 locale==='ko'일 때만 append되는 어문 규칙.
 *    appendLanguageInstruction의 'Respond in 한국어.' 꼬리 계약(run-e.test)을 깨지 않도록
 *    항상 프롬프트 본문 안에 넣는다(호출부 주석 참조).
 * ② applyNaraSpeller — 답변 원문을 나라맞춤법(PNU) 검사기에 POST해 suggestions[0] 우선순위
 *    규칙으로 후처리. 프롬프트 규칙과 무관하게 조사가 깨진 표기가 나옴(9/30 실측: 프롬프트
 *   만으론 재발 억제율이 낮다)에 대한 하드 게이트.
 *
 * upstream 실측(9/30, 백개발): jhaemin/speller-api가 wrapping하던 구엔드
 * POST nara-speller.co.kr/speller/results(form-encoded)는 폐기(Next.js 리뉴얼로 HTML 반환).
 * 사이트 SPA가 실제로 타는 신엔드 = POST https://nara-speller.co.kr/api/check (JSON
 * {text, isStrictCheck}) → {str, errInfo:[{errorIdx, correctMethod, start, end, orgStr,
 * candWord('a|b' 문자열), help}]}. start/end는 \n 정규화 없는 원문 코드유닛 오프셋(실측 확인).
 * 이 함수는 speller-api 응답 규격(suggestions:[{start,end,text,candidates:string[]}])과
 * 동형인 배열을 반환한다 — 테스트가 그 규격의 모크 fetch를 주입하면 백엔드 로직만 검증된다.
 *
 * 실패 정책(턴 사망 금지 — suggestedQuestions/perplexity 컨벤션 동일): 미구성/타임아웃/
 * 비200/파싱 실패/취소 모두 null. 호출부는 null이면 원문 그대로 사용.
 */
import { config } from '../config';
import { Locale } from './locale';
import { spellerPost, spellerHeaders } from './spellerTransport';

/** ko 답변 생성 프롬프트용 어문 규칙 (교과적 맞춤법·띄어쓰기 핵심만, 토큰 최소). */
export const KO_ORTHO_RULES =
  '\n[ORTHOS] 한국어 어문 규범을 정확히 지켜 쓴다. 조사를 잘못 붙여 음절이 깨진 표기(예: "이해오"→"이해도", "먹는게"→"먹는 게") 금지. '
  + '본용언과 보조용언은 띄어 쓴다(정리해 드릴게요, 알기 쉬워). 성과 이름 뒤의 호칭·관직은 띄어 쓴다(김 비서). '
  + '부사는 붙여 쓴다(잘했어요, 바로). 외래어 표기법을 따른다(프로젝트, 디자인).';

export function orthographyRules(locale: Locale): string {
  return locale === 'ko' ? KO_ORTHO_RULES : '';
}

export interface SpellerSuggestion {
  description?: string;
  start: number;
  end: number;
  text: string;
  candidates: string[];
}

/** speller-api 규격 응답 → suggestions 배열 (candidates가 문자열이면 '|' 분할 — 실 응답 규격 흡수). */
export function parseSpellerResponse(json: unknown): SpellerSuggestion[] | null {
  const raw = (json as any)?.suggestions ?? (json as any)?.errInfo;
  if (!Array.isArray(raw)) return null;
  const out: SpellerSuggestion[] = [];
  for (const s of raw) {
    if (!s || typeof s.start !== 'number' || typeof s.end !== 'number') continue;
    const text = typeof s.text === 'string' ? s.text : (typeof s.orgStr === 'string' ? s.orgStr : '');
    const cand = Array.isArray(s.candidates) ? s.candidates
      : (typeof s.candWord === 'string' && s.candWord ? s.candWord.split('|') : []);
    if (!cand.length) continue;
    out.push({ description: typeof s.description === 'string' ? s.description : undefined, start: s.start, end: s.end, text, candidates: cand });
  }
  return out;
}

/**
 * 결정적 후처리 — suggestions[0](최고 우선 후보)만 adopt, 나머지 후보는 structured_payload에
 * 대안으로 남긴다(과교정 방지). 오프셋 역순 적용으로 앞쪽 교정이 뒤쪽 오프셋을 무효화하지 않는다.
 * 후보가 원문과 같거나 빈 문자열이면 건너뛴다. 지시한 첫 후보만 채택하므로 동일 위치 중복 제안도 안전.
 */
export function applySuggestions(text: string, suggestions: SpellerSuggestion[]): { corrected: string; adopted: number } {
  const ordered = [...suggestions].sort((a, b) => b.start - a.start);
  let corrected = text;
  let adopted = 0;
  for (const s of ordered) {
    if (s.start < 0 || s.end > corrected.length || s.start >= s.end) continue;
    if (corrected.slice(s.start, s.end) !== s.text) continue; // 오프셋 불일치(모킹/응답 어긋남) → 그 항목 스킵
    // 후보는 그대로 사용(trim 금지): 오프셋 기반 교체라 후보 내부 공백이 의미 있다
    // ('이해오 했으니'→'이해도 했으니'). 공백뿐인 후보만 무의미로 제외.
    const cand = s.candidates[0] || '';
    if (!cand.trim() || cand === s.text) continue;
    corrected = corrected.slice(0, s.start) + cand + corrected.slice(s.end);
    adopted++;
  }
  return { corrected, adopted };
}

/** 검사기 구성 여부. 기본 OFF — speller-api는 LICENSE 파일 없음(GitHub API 404, 9/30 확인)이고
 *  나라 인포테크 위탁 서비스의 상업 이용 조건이 미확인. deploy.env에서 ON 하기 전 라이선스 확인. */
export function isSpellerConfigured(): boolean {
  return Boolean(config.naraSpeller.enabled && config.naraSpeller.url);
}

/**
 * 답변 원문 맞춤법 교정. 성공 시 {text, suggestions} (text는 교정본, suggestions는 검사기 원본),
 * 실패/미구성/취소/무오류 시 null — 호출부는 원문을 그대로 쓴다. 절대 throw하지 않는다.
 * 참고: 교정 대상은 LLM 원문뿐이고 뒤에서 디스클레이머 suffix가 붙으므로(1301 부근),
 * suffix 오프셋 오염은 원문 단계 교정으로 원천 차단된다.
 */
export async function applyNaraSpeller(
  text: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ text: string; suggestions: SpellerSuggestion[] } | null> {
  if (!isSpellerConfigured() || !text || text.length < 2) return null;
  if (opts.signal?.aborted) return null;
  try {
    const { status, text: raw } = await spellerPost({
      url: config.naraSpeller.url,
      body: JSON.stringify({ text, isStrictCheck: config.naraSpeller.strict }),
      headers: spellerHeaders(config.naraSpeller.url),
      timeoutMs: config.naraSpeller.timeoutMs,
      signal: opts.signal,
      h2Disabled: !config.naraSpeller.h2,
    });
    if (status < 200 || status >= 300) return null;
    const suggestions = parseSpellerResponse(JSON.parse(raw));
    if (!suggestions || !suggestions.length) return null; // 오류 없음 = 원문 유지
    const { corrected, adopted } = applySuggestions(text, suggestions);
    if (!adopted) return null;
    return { text: corrected, suggestions };
  } catch {
    return null; // 타임아웃/네트워크/파싱(JSON.parse 포함) — 턴에 영향 없음
  }
}
