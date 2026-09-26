// 대화 유형 판별기 (Dialog Type Classifier)
// 설계서: dialogue-functionality-spec.md §2 — 3단계 하이브리드: 패턴 → 서버(LLM) 분류 → 폴백(사용자 확인)
//
// t_56498848 (i18n 이관): 패턴 표를 서버와 단일 콘텐츠로 공유한다 — dialogPatterns.json (ko+en 통합).
//   - Stage 1: 공유 표 기반 다국어 패턴 매칭 (즉각, 0ms). 영문 발화("chart", "schedule")도 여기서 잡힌다.
//   - Stage 2: 서버 POST /api/classify 위임 — 서버가 Stage 1+2(LLM)+3를 순서대로 판별해 returns.
//     미로그인/네트워크 실패 시 null → Stage 3 폴백. 임계값(pattern/adopt/fallback)도 표에서 공유.
//   - 드리프트 방어: apps/backend/tests/unit/dialog-classifier.test.ts가 양쪽 JSON 파일 콘텐츠 동치를 강제.
// 패턴은 인식 데이터(UI 문구 아님) — JSON 분리 자체로 i18n 감사 스코프(ts/tsx)를 벗어나 면제 불필요.
import { DialogType } from '../types';
import patterns from './dialogPatterns.json';

/** 서버 DialogueType 기준 명명(백엔드 types/db.ts) — 'multi'는 프론트 'multi-agent'에 대응. */
export type PatternDialogType = 'information' | 'data' | 'file' | 'task' | 'multi';

interface PatternRule { type: PatternDialogType; ko: string[]; en: string[]; excludes_ko?: string[]; }
interface PatternConfidence { pattern: number; adopt: number; fallback: number; }

const RULES = patterns.rules as PatternRule[];
const CONFIDENCE = patterns.confidence as PatternConfidence;

/** 서버 유형 → 프론트 DialogType 매핑. 서버 Stage 3 폴백(question/command)은 프론트 타입 집합에 없어 information으로 수렴. */
export function toDialogType(t: PatternDialogType | 'question' | 'command' | string): DialogType {
  if (t === 'multi') return 'multi-agent';
  if (t === 'information' || t === 'data' || t === 'file' || t === 'task') return t;
  return 'information';
}

const HANGUL_SYLLABLE = /[가-힣]/;
const ASCII_WORD = /^[a-z0-9 ]+$/;
/** 단음절 패턴 뒤 허용 조사 — '표로/표를' 매칭, '표현/표적' 차단. 서버 dialogClassifier.ts와 동일 규칙(JSON 단일 소스). */
const SINGLE_SYLLABLE_PARTICLES = new Set<string>((patterns as { single_syllable_particles?: string[] }).single_syllable_particles ?? []);

/** 패턴 하나 매칭 — 서버 구현과 1:1 대응 (ASCII: 단어경계 ci / 한글 2+: substring / 한글 1음절: 좌우 경계+조사). */
export function matchPattern(text: string, normalized: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (ASCII_WORD.test(p)) {
    return new RegExp(`\\b${p}\\b`).test(normalized);
  }
  if (!HANGUL_SYLLABLE.test(pattern)) {
    // 정규식 문법 패턴: 그대로 RegExp — 서버 dialogClassifier.ts와 1:1.
    try { return new RegExp(p, 'i').test(text); } catch { return normalized.includes(p); }
  }
  const idx = text.indexOf(pattern);
  if (idx === -1) return false;
  if (pattern.length === 1 && HANGUL_SYLLABLE.test(pattern)) {
    // 모든 출현 순회 — 서버 dialogClassifier.ts와 동일.
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

export interface ClassificationResult {
  type: DialogType;
  confidence: number;
  stage: 1 | 2 | 3;
}

// Stage 1: 패턴 매칭 (공유 표, 언어 무관 — ko/en 통합)
export function classifyByPattern(input: string): ClassificationResult | null {
  if (!input) return null;
  const normalized = input.toLowerCase();
  for (const rule of RULES) {
    if (rule.excludes_ko?.some(x => input.includes(x))) continue;
    for (const pattern of [...rule.ko, ...rule.en]) {
      if (matchPattern(input, normalized, pattern)) {
        return { type: toDialogType(rule.type), confidence: CONFIDENCE.pattern, stage: 1 };
      }
    }
  }
  return null;
}

export interface ServerClassification {
  /** 서버는 7분류 universe(question/command 포함) — toDialogType가 5분류로 수렴시킨다. */
  type: string;
  confidence: number;
  stage: 1 | 2 | 3;
}

export type ClassifyRequest = (input: string, history?: string[]) => Promise<ServerClassification | null>;

let classifyRequest: ClassifyRequest | null = null;
/** 부팅 시 주입: (input, history) → 서버 POST /api/classify 응답 or null(실패/미로그인). 테스트는 모의 주입. */
export function setClassifyRequest(fn: ClassifyRequest | null): void { classifyRequest = fn; }

// Stage 2: 서버 분류 위임 (비동기 — 서버가 LLM까지 판별). 실패는 null, 절대 던지지 않는다.
export async function classifyByLLM(input: string, history?: string[]): Promise<ClassificationResult | null> {
  if (!classifyRequest) return null;
  try {
    const r = await classifyRequest(input, history);
    if (!r || typeof r.confidence !== 'number' || !r.type) return null;
    return { type: toDialogType(r.type), confidence: r.confidence, stage: r.stage === 1 || r.stage === 2 ? r.stage : 3 };
  } catch {
    return null; // 판별 실패로 대화 흐름을 실패시키지 않는다 — Stage 3 폴백.
  }
}

// 통합 판별 함수 (3단계 하이브리드)
export async function classifyDialogType(input: string, history?: string[]): Promise<ClassificationResult> {
  // Stage 1: 패턴 매칭 (즉각) — 오탐 방지가 우선, 놓치는 건 Stage 2가 회수. 서버 왕복 없음.
  const patternResult = classifyByPattern(input);
  if (patternResult && patternResult.confidence >= CONFIDENCE.adopt) {
    return patternResult;
  }

  // Stage 2: 서버(LLM) 분류 — 인용 임계 이상만 채택. 서버 Stage 3 응답(저신뢰)은 타입 근거로 쓰지 않는다.
  const llmResult = await classifyByLLM(input, history);
  if (llmResult && llmResult.stage !== 3 && llmResult.confidence >= CONFIDENCE.adopt) {
    return llmResult;
  }

  // Stage 3: 폴백 — 정보 응답형 기본값 + 사용자 확인 필요 (spec §2.5)
  return {
    type: 'information',
    confidence: CONFIDENCE.fallback,
    stage: 3,
  };
}
