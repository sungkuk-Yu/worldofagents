// '새 대화' 탭 판정 순수 로직 (t_5058e15f ① — 9/30 라이브 결함 #1 이관분)
// 원인: 버튼이 disabled={loading}이라 첫 refresh(라이브 DNS+TLS 수 초) 동안 탭이 조용히 흡수됨
//       (김비서 실패로그 ①: 재탭 2~5회 후에야 POST /api/agents 201).
// 계약: 흡수 금지 — 로딩 중 탭은 큐잉(queued)했다가 로딩 해지 시 그 순간의 데이터로 실행.
//       starting/offline은 명시적 비활성(스피너/오프라인 패널이 이미 시각 신호)이라 none.
export type NewChatAction = 'none' | 'queue' | 'chooserOpen' | 'chooserClose' | 'start';

/** 탭 순간의 화면 상태로 실행 판정 (렌더/타이머는 DialogueListScreen 소유) */
export function newChatTapAction(s: {
  starting: boolean;
  loading: boolean;
  offline: boolean;
  hasAgents: boolean;
  choosing: boolean;
}): NewChatAction {
  if (s.starting || s.offline) return 'none';
  if (s.loading) return 'queue';
  if (s.hasAgents) return s.choosing ? 'chooserClose' : 'chooserOpen';
  return 'start';
}

/** 큐잉된 탭의 해지 실행 — 로딩이 끝난 시점의 에이전트 목록 기준 (재탭과 동일 결과) */
export function newChatQueuedAction(hasAgents: boolean): 'chooserOpen' | 'start' {
  return hasAgents ? 'chooserOpen' : 'start';
}
