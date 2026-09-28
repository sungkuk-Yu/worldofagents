/**
 * 비서실 백스테이지 릴레이 자막 (t_583d9fed 案1, 대표님 9/28 확정: "일단 a이고 나머진 기획으로 가져가자")
 * - 사용자는 비서(relationship_type='secretary' 페르소나) 한 명과 1:1로 대화한다.
 * - 뒤에서 도는 뉴런 릴레이(배정→자료→초안→마무리)의 실체는 자막 스타일 `relay.updated` 이벤트로
 *   순서대로 노출된다 — 최종 답변은 기존 계약대로 하나의 통합 메시지(B1). channels/메시지 마이그레이션 없음.
 * - 자막은 휘발성 연출: 별도 테이블 저장 없음, 재접속 재생은 eventlog seq 버퍼로만 보장.
 * - 비서 외 페르소나에서는 0 이벤트 — 기존 run.progress 동작과 완전히 동일하다.
 * - quip 금지 노출 규칙(t_b2b86cd6) 준수: 영문 코드 단어·기술 용어 없음.
 */
import type { Locale } from './locale';

export type RelayStage = 'briefing' | 'research' | 'drafting' | 'wrapping' | 'done';

/** 자막 진행 순서 (단조 증가만 허용 — 역주행·중복 금지). */
export const RELAY_ORDER: RelayStage[] = ['briefing', 'research', 'drafting', 'wrapping', 'done'];

export const RELAY_QUIPS: Record<RelayStage, Record<Locale, string>> = {
  briefing: { ko: '네, 접수했어요. 담당 팀에 바로 전달합니다', en: 'Understood — routing this to the right desk now.' },
  research: { ko: '지금 자료팀이 최신 사례를 뒤지고 있어요', en: 'Our research desk is pulling the latest references.' },
  drafting: { ko: '초안이 올라오고 있어요, 바로 다듬습니다', en: 'A draft just came in — polishing it now.' },
  wrapping: { ko: '팀 작업이 끝났어요, 제 이름으로 정리해 드립니다', en: 'The team is done — I will sign off as one voice.' },
  done: { ko: '정리 끝났어요. 여기까지 제가 챙겼습니다', en: 'All wrapped up. Here is what we have.' },
};

export function relayQuip(stage: RelayStage, locale: Locale): string {
  return RELAY_QUIPS[stage][locale];
}

/** 뉴런 상태 이벤트 → 릴레이 스테이지. 매핑 표에 없는 이벤트(empathy/queue 등)는 null.
 *  answerNode 내 실제 발생 순서(router processing → answer processing → grounding → answer idle → visual)에
 *  맞춘 비트 배정: 자료 검색은 answer 작업 구간과 겹치므로 answer processing이 'research'를 담당하고,
 *  grounding 이벤트는 같은 'research'로 dedup된다. */
export function relayStageForEvent(e: { neuron: string; status: string }): RelayStage | null {
  if (e.neuron === 'router' && e.status === 'processing') return 'briefing';
  if (e.neuron === 'answer' && e.status === 'processing') return 'research';
  if (e.neuron === 'answer' && e.status === 'idle') return 'drafting';
  if (e.neuron === 'visual' && e.status === 'processing') return 'wrapping';
  return null;
}

/** 실행(run)당 자막 커튼 — 같은 스테이지 재발송과 역주행을 막는다. */
export class RelayCurtain {
  private current: RelayStage | null = null;
  constructor(private readonly locale: Locale) {}
  /** 새 스테이면 자막 문구를 반환, 이미 보냈거나 뒤로 가는 스테이면 null. */
  advance(stage: RelayStage): string | null {
    const from = this.current ? RELAY_ORDER.indexOf(this.current) : -1;
    if (RELAY_ORDER.indexOf(stage) <= from) return null;
    this.current = stage;
    return RELAY_QUIPS[stage][this.locale];
  }
}
