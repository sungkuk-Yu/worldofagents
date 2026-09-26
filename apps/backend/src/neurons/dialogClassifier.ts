/**
 * 대화 유형 판별 공용 엔진 (t_56498848) — dialogue-functionality-spec.md §2 3단계 하이브리드의 단일 구현.
 *
 * - 패턴 표(dialogPatterns.json)는 프론트(src/neurons/dialogPatterns.json)와 콘텐츠 미러 —
 *   드리프트는 tests/unit/dialog-classifier.test.ts가 파일 수준에서 강제한다.
 * - Stage 1: 다국어 패턴 매칭(한글 substring + 1음절 좌우경계, 영문 단어경계 case-insensitive).
 *   규칙 배열 순서 = 우선순위(file→data→task→multi).
 * - Stage 2: LLM 의도 분류(classifyByLLM) — 소형/저지연 호출, 실패 시 null(호출부가 폴백).
 * - Stage 3: 호출부 폴백(규칙 question/command/information 또는 사용자 확인).
 *
 * 백엔드 라우터(router.ts)와 REST /api/classify가 이 엔진을 쓰고,
 * 프론트 DialogTypeClassifier.ts가 동일한 표·동일한 임계값으로 Stage 1을 수행한다.
 */
import { DialogueType } from '../types/db';
import patterns from './dialogPatterns.json';

export interface DialogPatternRule {
  type: DialogueType;
  ko: string[];
  en: string[];
  /** 매칭을 무효화하는 오매칭 위험 단어(예: '파일' vs '파일러') — 규칙 단위 예외. */
  excludes_ko?: string[];
}

export interface PatternConfidence {
  pattern: number;
  adopt: number;
  fallback: number;
}

export const DIALOG_RULES = patterns.rules as DialogPatternRule[];
export const DIALOG_CONFIDENCE = patterns.confidence as PatternConfidence;
/** 판별 결과 인용 임계 (0.8) — Stage1=0.85 인용, Stage2는 LLM confidence와 비교. */
export const CONFIDENCE_ADOPT = DIALOG_CONFIDENCE.adopt;

const HANGUL_SYLLABLE = /[가-힣]/;
const ASCII_WORD = /^[a-z0-9 ]+$/;
/** 단음절 패턴 뒤 허용 조사(단일 음절): 표로/표를/표에/표는/표와… 매칭, 표현/표적은 차단. 표 JSON이 단일 소스. */
const SINGLE_SYLLABLE_PARTICLES = new Set<string>(patterns.single_syllable_particles as string[]);

/**
 * 패턴 하나 매칭 여부.
 * - ASCII 패턴: 단어경계(case-insensitive). 'tables'는 'table'에 매칭되되 'improbable'은 미매칭.
 * - 한글 2음절+: substring.
 * - 한글 1음절('표','팀'): 좌측 비한글 경계 + 우측 (비한글 | 단일음절 조사).
 *   '목표/발표' 좌측 차단, '표현' 우측 차단, '거래처 표 만들어줘'·'표로' 매칭 유지.
 *   bounded=false(Stage 3 의문/명령 어미: '왜요'·'뭐지')에서는 원본 regex처럼 단순 substring.
 */
export function matchPattern(text: string, normalized: string, pattern: string, bounded = true): boolean {
  const p = pattern.toLowerCase();
  if (ASCII_WORD.test(p)) {
    // 순수 단어/구: \b 경계 — 'doc'이 'dock'에, 'table'이 'suitable'에 걸리지 않는다.
    return new RegExp(`\\b${p}\\b`).test(normalized);
  }
  if (!HANGUL_SYLLABLE.test(pattern)) {
    // 정규식 문법 패턴('turn (it )?on' 등): 그대로 RegExp. 파싱 실패 시 substring 강등.
    try { return new RegExp(p, 'i').test(text); } catch { return normalized.includes(p); }
  }
  const idx = text.indexOf(pattern);
  if (idx === -1) return false;
  if (bounded && pattern.length === 1 && HANGUL_SYLLABLE.test(pattern)) {
    // 모든 출현을 순회 — '발표 자료 표'처럼 오탐 위치 뒤에도 유효 출현이 있을 수 있다.
    for (let i = text.indexOf(pattern); i !== -1; i = text.indexOf(pattern, i + 1)) {
      const prev = i > 0 ? text[i - 1] : '';
      const next = i + 1 < text.length ? text[i + 1] : '';
      if (prev && HANGUL_SYLLABLE.test(prev)) continue;
      if (next && HANGUL_SYLLABLE.test(next) && !SINGLE_SYLLABLE_PARTICLES.has(next)) continue;
      return true;
    }
    return false;
  }
  return true;
}

export interface PatternHit {
  type: DialogueType;
  confidence: number;
  /** 매칭된 패턴(디버그/로그용) */
  matched: string;
}

/** Stage 1: 언어 무관 다국어 패턴 매칭. ko 로케일 전용 필터 없음 — 영문 발화도 여기서 잡는다. */
export function detectDialogPattern(text: string): PatternHit | null {
  if (!text) return null;
  const normalized = text.toLowerCase();
  for (const rule of DIALOG_RULES) {
    // excludes: '파일러'처럼 부분일치 오탐이 확정적인 단어들이 발화에 있으면 이 규칙 스킵.
    if (rule.excludes_ko?.some(x => text.includes(x))) continue;
    for (const pattern of [...rule.ko, ...rule.en]) {
      if (matchPattern(text, normalized, pattern)) {
        return { type: rule.type, confidence: DIALOG_CONFIDENCE.pattern, matched: pattern };
      }
    }
  }
  return null;
}

/** Stage 3 규칙 폴백: 의문/명령 어미(한영) → question/command, 아니면 information. 패턴은 표 JSON stage3_fallback 소유. */
const STAGE3 = (patterns as unknown as { stage3_fallback: { question: { ko: string[]; en: string[] }; command: { ko: string[]; en: string[] } } }).stage3_fallback;
export function ruleFallbackType(text: string): DialogueType {
  if (!text) return 'information';
  const normalized = text.toLowerCase();
  const anyOf = (set: { ko: string[]; en: string[] }) =>
    [...set.ko, ...set.en].some(p => matchPattern(text, normalized, p, false));
  if (anyOf(STAGE3.question)) return 'question';
  if (anyOf(STAGE3.command)) return 'command';
  return 'information';
}

/** Stage 1+3 조합(동기) — 라우터용. 프론트 Stage1과 동일 표·동일 우선순위. */
export function classifyByRulesSync(text: string): { type: DialogueType; stage: 1 | 3; confidence: number; matched?: string } {
  const hit = detectDialogPattern(text);
  if (hit && hit.confidence >= CONFIDENCE_ADOPT) return { type: hit.type, stage: 1, confidence: hit.confidence, matched: hit.matched };
  return { type: ruleFallbackType(text), stage: 3, confidence: DIALOG_CONFIDENCE.fallback };
}
