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

/** ko 답변 생성 프롬프트용 어문 규칙 (교과적 맞춤법·띄어쓰기 핵심만, 토큰 최소).
 * t_f5a9b570: 호칭 예시를 '김 비서'에서 무관련 성(姓)으로 교체 — 브랜드명 '김비서'를
 * 프롬프트가 스스로 쪼개라고 교육하는 자기모순이었다(#454 실측의 절반). 고유명사 예외 조항 append. */
export const KO_ORTHO_RULES =
  '\n[ORTHOS] 한국어 어문 규범을 정확히 지켜 쓴다. 조사를 잘못 붙여 음절이 깨진 표기(예: "이해오"→"이해도", "먹는게"→"먹는 게") 금지. '
  + '본용언과 보조용언은 띄어 쓴다(정리해 드릴게요, 알기 쉬워). 성과 이름 뒤의 호칭·관직은 띄어 쓴다(예: "최 비서"). '
  + '부사는 붙여 쓴다(잘했어요, 바로). 외래어 표기법을 따른다(프로젝트, 디자인).';

/** 고유명사 보호 고지 (t_f5a9b570) — 어문 규칙과 같은 프롬프트 본문에 붙는다(꼬리 계약 보존). */
export function protectedTermsNotice(terms: string[]): string {
  const t = terms.map(s => String(s).trim()).filter(Boolean);
  if (!t.length) return '';
  return ` 고유명사(브랜드·에이전트명·사용자 지정 용어)는 원철자 그대로 쓰고 띄어쓰기를 바꾸지 않는다: ${t.slice(0, 20).join(', ')}.`;
}

export function orthographyRules(locale: Locale, protectedTerms: string[] = []): string {
  if (locale !== 'ko') return '';
  return KO_ORTHO_RULES + protectedTermsNotice(protectedTerms);
}

export interface SpellerSuggestion {
  description?: string;
  start: number;
  end: number;
  text: string;
  candidates: string[];
}

/**
 * 고유명사 보호 사전 (t_f5a9b570, 김비서 #454/#455 실측: PNU가 '비서'를 별개 명사로
 * 분석해 '김비서'→'김 비서' 과교정). 기본 브랜드 목록 + NARA_SPELLER_PROTECTED_TERMS(env)
 * + users.preferences.protectedTerms(사용자 사전) + 페르소나명을 합쳐 적용한다.
 * 원문 유지 원칙: 보호 용어와 겹치는 제안 항목만 스킵하고, 나머지 교정은 정상 적용한다.
 */
export const DEFAULT_PROTECTED_TERMS = ['김비서', '내변호사', '내보좌관', '에이전트톡', 'AgentTalk'];

export function normalizeProtectedTerms(terms: Array<string | undefined | null>): string[] {
  const out = new Set<string>();
  for (const t of terms) {
    const s = typeof t === 'string' ? t.trim() : '';
    // 1자 용어는 임의 교정과 겹쳐 전체 마비를 유발 — 최소 2자만 보호 (과보호 방지 안전판)
    if (s.length >= 2) out.add(s);
  }
  return [...out].slice(0, 50); // 악성/폭주 선호로부터 프롬프트·질주 보호
}

/** 보호 용어의 원문 출현 구간 전체 (ASCII 용어는 대소문자 무시, 한글은 정확 일치). */
export function protectedTermRanges(text: string, terms: string[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const term of terms) {
    const ascii = /^[\x00-\x7F]+$/.test(term);
    const hay = ascii ? text.toLowerCase() : text;
    const needle = ascii ? term.toLowerCase() : term;
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      ranges.push([i, i + needle.length]);
    }
  }
  return ranges;
}

function overlapsAny(start: number, end: number, ranges: [number, number][]): boolean {
  return ranges.some(([ts, te]) => start < te && ts < end);
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
 * protectedTerms(t_f5a9b570): 교정 구간이 보호 용어 출현 구간과 겹치면 그 항목만 스킵 —
 * '김비서'→'김 비서'류 고유명사 과교정 차단, 나머지 교정('이해오→이해도')은 그대로 적용.
 */
export function applySuggestions(text: string, suggestions: SpellerSuggestion[], protectedTerms: string[] = []): { corrected: string; adopted: number; skippedProtected: number } {
  const ordered = [...suggestions].sort((a, b) => b.start - a.start);
  const guarded = protectedTerms.length ? protectedTermRanges(text, protectedTerms) : [];
  let corrected = text;
  let adopted = 0;
  let skippedProtected = 0;
  for (const s of ordered) {
    if (s.start < 0 || s.end > corrected.length || s.start >= s.end) continue;
    if (corrected.slice(s.start, s.end) !== s.text) continue; // 오프셋 불일치(모킹/응답 어긋남) → 그 항목 스킵
    // 후보는 그대로 사용(trim 금지): 오프셋 기반 교체라 후보 내부 공백이 의미 있다
    // ('이해오 했으니'→'이해도 했으니'). 공백뿐인 후보만 무의미로 제외.
    const cand = s.candidates[0] || '';
    if (!cand.trim() || cand === s.text) continue;
    if (guarded.length && overlapsAny(s.start, s.end, guarded)) { skippedProtected++; continue; } // 고유명사 보호
    corrected = corrected.slice(0, s.start) + cand + corrected.slice(s.end);
    adopted++;
  }
  return { corrected, adopted, skippedProtected };
}

/** 검사기 구성 여부. 기본 OFF — speller-api는 LICENSE 파일 없음(GitHub API 404, 9/30 확인)이고
 *  나라 인포테크 위탁 서비스의 상업 이용 조건이 미확인. deploy.env에서 ON 하기 전 라이선스 확인. */
export function isSpellerConfigured(): boolean {
  return Boolean(config.naraSpeller.enabled && config.naraSpeller.url);
}

/**
 * 답변 원문 맞춤법 교정. 성공 시 {text, suggestions, skippedProtected} (text는 교정본,
 * suggestions는 채택된 항목만 — 보호 스킵 항목은 오디트 카운트만 남긴다),
 * 실패/미구성/취소/무오류/전부-스킵 시 null — 호출부는 원문을 그대로 쓴다. 절대 throw하지 않는다.
 * 참고: 교정 대상은 LLM 원문뿐이고 뒤에서 디스클레이머 suffix가 붙으므로(1301 부근),
 * suffix 오프셋 오염은 원문 단계 교정으로 원천 차단된다.
 */
export async function applyNaraSpeller(
  text: string,
  opts: { signal?: AbortSignal; protectedTerms?: string[] } = {},
): Promise<{ text: string; suggestions: SpellerSuggestion[]; skippedProtected: number } | null> {
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
    const protectedTerms = mergeProtectedTerms(opts.protectedTerms);
    const { corrected, adopted, skippedProtected } = applySuggestions(text, suggestions, protectedTerms);
    if (!adopted) return null; // 전부 스킵(보호/동일 후보) = 원문 유지
    // structured_payload 감사 항목 = 실제로 채택된 항목만 (스킵된 고유명사 교정을 '적용'처럼 남기지 않는다)
    const guarded = protectedTerms.length ? protectedTermRanges(text, protectedTerms) : [];
    const applied = suggestions.filter(s => !guarded.some(([ts, te]) => s.start < te && ts < s.end));
    return { text: corrected, suggestions: applied, skippedProtected };
  } catch {
    return null; // 타임아웃/네트워크/파싱(JSON.parse 포함) — 턴에 영향 없음
  }
}

/** 기본+env(운영 사전)+호출자(user prefs/persona) 합산 — koreanOrthography의 단일 진실 소스. */
export function mergeProtectedTerms(extra: string[] = []): string[] {
  return normalizeProtectedTerms([
    ...DEFAULT_PROTECTED_TERMS,
    ...(config.naraSpeller.protectedTerms || []),
    ...extra,
  ]);
}
