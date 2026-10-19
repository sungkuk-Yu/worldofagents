/**
 * 단일 페르소나 보이스 채널 (t_5cba9ebb, 대표님 9/29 핵심 지적:
 * "지금 뉴런들을 많이 넣는 이유는 사실상 에이전트들을 하나의 채팅방에 하나의
 *  페르소나로 묶어서 대화 빈틈 없이 보일려고 하는건데, 그 의미가 지금 전혀
 *  반영 안 됐잖아").
 *
 * 원칙: 뉴런 출력(릴레이 진행·큐 대기·patience quip)을 하나의 대화체 스트림으로
 * 수렴 — 한 시점에 화면엔 그 페르소나의 말 한 줄만 존재한다. 칩·배지·리스트 등
 * 병렬 위젯은 전면 폐지(프론트). 침묵 = 실패: 발화 간 공백은 페르소나가 말로 메운다.
 *
 * 규칙 기반 템플릿 풀(LLM 호출 0 — 지연 증가 금지, 대표님 9/29 보강 2항).
 * 릴레이 스테이지(relay.ts)는 '백스테이지 팀' 비유를 유지하되 큐 합류 안내를
 * 같은 라인에서 이어 말한다(다중 발화 대기: "앞에 N개 처리 중이에요"식, 3항).
 */
import type { Locale } from './locale';
import type { RelayStage } from './relay';

export type PersonaLineSource = 'ack' | 'progress' | 'queue' | 'relay';

export interface PersonaLineEvent {
  type: 'persona.line';
  session_id: string;
  run_id?: string;
  line: string;
  source: PersonaLineSource;
}

/** 릴레이 스테이지 → 페르소나 1인칭 진행 줄 (백스테이지 팀 비유 폐기, 한 사람 말투). */
const RELAY_LINES: Record<RelayStage, Record<Locale, string>> = {
  briefing: { ko: '네, 접수했어요. 바로 살펴볼게요', en: 'Got it — looking into it now.' },
  research: { ko: '지금 확인 중이에요, 조금만 기다려주세요', en: 'Checking on it right now — one moment.' },
  drafting: { ko: '이어서 정리하고 있어요, 곧 답변 드릴게요', en: 'Pulling it together — answer coming right up.' },
  wrapping: { ko: '거의 다 됐어요, 바로 이어서 말씀드려요', en: 'Almost there — continuing right after this.' },
  done: { ko: '정리 끝났어요', en: 'All set.' },
};

/** 끼어들기 질문 수신 시 즉시 응답 — 수신 인지 + 큐 상태 안내 (t_500b674d, 대표님 10/19 ①).
 *  pending=1: 방금 들어온 것만 대기 → 앞 질문(현재 답변 중) 완료 후 바로 처리
 *  pending>1: 앞에 대기 중인 것들도 있음 → 개수 고지 */
export function queueJoinLine(pending: number, locale: Locale): string {
  if (pending <= 0) return '';
  const extra = pending > 1 ? (locale === 'en' ? ` (${pending - 1} more ahead)` : ` (앞에 ${pending - 1}개 더 대기 중)`) : '';
  return locale === 'en'
    ? `Got it — I'm still answering the previous question. I'll get to yours right after${extra}.`
    : `네, 접수했어요. 지금 앞 질문 답변 중이라 주신 질문은 그 다음 순서로 답해드릴게요${extra}.`;
}

export function personaLine(stage: RelayStage, locale: Locale, opts: { pending?: number } = {}): string {
  const base = RELAY_LINES[stage][locale];
  const join = queueJoinLine(opts.pending ?? 0, locale);
  return join ? `${base} ${join}` : base;
}

/** 발화 간 공백을 메우는 patience 줄 (기존 run.progress quip의 대체 노출 — 프론트는 line만 사용). */
export function personaPatienceLine(tick: number, locale: Locale): string {
  const ko = ['아직 확인 중이에요, 조금만요', '거의 다 됐어요, 바로 이어갈게요'];
  const en = ['Still working on it — hang tight.', 'Nearly done, continuing right away.'];
  const pool = locale === 'en' ? en : ko;
  return pool[Math.min(tick, pool.length - 1)];
}

/** 접수 확인 줄 (ack) — 9/29 확정 3항 문안: "이해했어요, 맞으면 바로 진행할게요" 수준.
 *  답변 착수를 막지 않는다 — 발화이지 게이트가 아니다 (복명복창·재질문 금지 유지). */
export function personaAckLine(locale: Locale): string {
  return locale === 'en' ? "Understood — going ahead if that's right." : '이해했어요, 바로 진행할게요.';
}

/** 침묵 SLA (t_5cba9ebb 볼트 리서치 §2 / 대표님 9/29 보강): 4초 초과 구간은 content-bearing
 *  한 줄 강제. 단일 상수 — 프론트가 이 값에 의존하지는 않지만(라인은 수동적 표시) 테스트가
 *  같은 상수를 import해 지연 바운드를 검증한다. */
export const PERSONA_SILENCE_FILL_MS = 4000;
