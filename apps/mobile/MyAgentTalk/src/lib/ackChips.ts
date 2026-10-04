// 공감 재질문 카드 하단 예/아니요 대형 버튼 — 순수 로직
// (t_043539ff 소형 척에서 출발 → t_c62a2eb7 대표님 9/28 "예/아니요 크게, 텔레그램 reply keyboard 형태로")
// 백엔드 계약 (t_135a19b5 게이트 / t_44f8896c 재질문 / t_5e407a8a 집합 확장):
//   - empathy 행 content=재질문("이거 맞냐" 템플릿 4종 회전),
//     structured_payload = { empathy_full(복창 원문), empathy_question, template_id, empathy_ack }.
//   - 확인 발화 수신 시 복창 재생성 skip + answer 강제 활성 — isConfirmationUtterance 정확 일치 집합.
// 라벨 계약 (t_1b123e59, 대표님 9/28 원문② "맞아요가 아니고 예/아니요 로만 해야되"):
//   - 템플릿 바인딩(eq_confirm→'맞아요/아니에오', t_c62a2eb7 #4) 폐기 — template_id 무관 모든
//     재질문 카드 버튼은 고정 '예'/'아니요'(en 'Yes'/'No'). 두 발화 모두 백엔드 게이트 집합 등재.
// 노출 계약 (t_c62a2eb7 #2 → t_64e3edd6 9/29 개정):
//   - 대표님 9/29 원문: "예 아 니오도 3초 안에 안사라지고 내가 안누르더라도 3초 후에 그냥 바로 답변해야
//     하는거야" → 3초(→#321 2.5초) 미터치 시 자동 소진(버튼 행 사라짐). 답변은 같은 턴에 이미 파이프라인
//     진행 중이므로(t_135a19b5: 확인 발화 없으면 empathy 후 answer 직결) 프론트는 소멸만 담당 —
//     '발화 진행까지 무한 유지'(t_c62a2eb7 #2)는 폐기. ACK_AUTO_PROCEED_MS = 2500.
//   - 탭 시 즉시 발화('예'/'아니요') 불변. 발화 진행(user 행 발생) 소멸도 여전히 유효(더 늦기 전엔 타이머가 1차).
//   - #324/#325: 음성 경로의 전사확인 2.5초 게이트는 폐지 — 예/아니오는 텍스트 입력의 공감 재질문에만.
//   - 히스토리 재현(새로고침/loadOlder)에는 노출하지 않는다 — t_b2004d50 개정 집행: 대상은
//     '라이브 경로로 들어온 행'만. transport 도장(arrivedAt)이 없고 created_at이 ACK_LIVE_STALE_MS
//     를 넘긴 행은 후보 배제(이중 안전망). 배치 GET(히스토리/재구독)은 절대 도장하지 않는다.
//   - 스레드 답글 경로의 empathy(parentMessageId)는 대상 제외(메인 피드만). 마지막 공감 행 하나만.
// t_b2004d50 앵커 개정 (김비서 9/30, 부모 t_f46d1d7a followup) — 실측 근거(t_888c1669 프로브):
//   OFF 경로에서 empathy created_at = 턴 시작 스탬프(user와 동일)인데 발행은 런 종료 시(+144s).
//   답변이 긴 발화에서는 행이 렌더되는 즉시 창이 만료 → 예/아니요 발화 가능 창 실질 0, F 구간 flakes 15+.
//   새 수명 규칙 (계층):
//   ① 후보 게이트: 마지막 공감·뒤 user 발화 없음·(도장 있거나 created_at fresh ≤15s).
//   ② 창 개시 앵커 = useAckChip이 주입하는 exposureStartMs — '버튼 행이 렌더 가능해진 첫 관측'
//     (요구3 스트리밍 억제 해제 시점 포함, t_cc232982 'done 후 표시' 계약과 정합). 같은 id 재관측·
//     WS 재구독 버스트는 최초값 보존(리셋 금지).
//   ③ 미주입 폴백(unit·레거시): transport 도장 arrivedAt 보유 시 max(created_at, arrivedAt)
//     (스큐 상한: arrivedAt + ACK_LIVE_STALE_MS 초과 금지), 없으면 created_at 단독 = 기존 동작 1:1.
import type { ChatMessage } from './chatLogic';

/** created_at 이 경과한(미도장) 행은 히스토리 재현으로 간주 (클럭 오차/재진입 유예 포함 15s).
 *  t_b2004d50: 비교 기준이 created_at 단독에서 '라이브 도착(도장) 또는 created_at fresh' 게이트로
 *  교체됐지만 가드 값·의미(재현 배제)는 유지 — 김비서 결정 #2. */
export const ACK_LIVE_STALE_MS = 15000;

/** 재질문 버튼 행 자동 소진 (t_64e3edd6 9/29, #321: 3초→2.5초) — 표시 후 미터치면 사라진다 */
export const ACK_AUTO_PROCEED_MS = 2500;

/** 메인 피드 실시간 공감(재질문) 행 판별 */
export function isEmpathyEchoMessage(m: ChatMessage): boolean {
  return m.role === 'agent' && m.sourceNeuron === 'empathy' && !m.parentMessageId && m.content.trim().length > 0;
}

export interface AckChipView {
  id: string;
}

/** ① 후보 게이트 (창 길이 무관) — 마지막 공감 행을 리턴, 대상 아니면 null.
 *  messages는 turnIndex 오름차순 (normalizeServerMessages/group 정렬 보장). */
function ackChipCandidate(messages: ChatMessage[], now: number, streaming: boolean): ChatMessage | null {
  if (streaming) return null;
  let last: ChatMessage | null = null;
  for (const m of messages) if (isEmpathyEchoMessage(m)) last = m;
  if (!last) return null;
  // 답변 시작 이후 잔존 금지 — 이 공감보다 늦은 user 발화(탭 낙관 pending 포함)가 있으면 소멸
  if (messages.some((m) => m.role === 'user' && m.turnIndex > last!.turnIndex)) return null;
  // 라이브 게이트: transport 도장 없는 행은 created_at fresh(≤15s)만 후보 — 히스토리 재현(배치
  // GET·재구독 버스트에 섞인 구 empathy) 배제. 도장 행(WS/POST 실시간)은 created 선버링과 무관.
  const createdMs = last.createdAt ? Date.parse(last.createdAt) : NaN;
  if (last.arrivedAt == null && !(Number.isFinite(createdMs) && now - createdMs <= ACK_LIVE_STALE_MS)) return null;
  return last;
}

/** ②③ 창 개시 앵커 — t_b2004d50 개정 (김비서 카드: "비교 기준을 created_at→도착시로 같이 교체"):
 *  - 라이브 도장(arrivedAt = WS/POST 최초 수신각) 행만: 노출 가능 첫 관측(exposureStartMs, =
 *    useAckChip Map<id, firstSeenMs> 각인) → 없으면 수신각. created_at의 턴시작 선버링
 *    (+144s 실측, = 이 카드가 교정한 결함)과 무관하게 '도착/노출한 시점'부터 2.5s.
 *  - 미도장(=배치 GET 히스토리 재현·loadOlder·레거시 unit 호출): created_at 단독 — exposure
 *    주입과 무관하게 적용 불가. 새로고침이 15s 내 재현 행을 '지금 도착'으로 속여 재점등하는
 *    경로를 원천 차단(verify_ack_live ④ / smoke_ack_chips ⑦ 회귀 가드). */
function anchorMs(last: ChatMessage, exposureStartMs: number | undefined): number {
  if (last.arrivedAt != null) return exposureStartMs != null ? exposureStartMs : last.arrivedAt;
  return last.createdAt ? Date.parse(last.createdAt) : NaN;
}

/**
 * 현재 버튼 행을 노출할 공감 카드 (없으면 null).
 * 수명 (t_64e3edd6 9/29): 표시 후 autoProceedMs(기본 2.5s) 미터치 → 소멸(자동 진행은 백엔드 파이프라인이
 * 이미 담당). 그 전에 user 발화(탭 낙관 포함)가 오면 소멸. autoProceedMs는 테스트 주입용.
 * streaming (t_cc232982 요구3): 답변 토큰 성장 중이면 억제 — answer.done(확정) 후 표시.
 * t_b2004d50: 5번째 인자 exposureStartMs(=useAckChip의 '노출 가능 첫 관측' Map 값, 브리프의
 * arrivedAtMs 인자에 대응) 주입 시 그것을 창 개시로 삼고, 미주입 시 created_at/arrivedAt 폴백
 * (기존 unit 테스트 호환 — 기본값 유지).
 */
export function visibleAckChip(messages: ChatMessage[], now: number, autoProceedMs: number = ACK_AUTO_PROCEED_MS, streaming = false, exposureStartMs?: number): AckChipView | null {
  const last = ackChipCandidate(messages, now, streaming);
  if (!last) return null;
  const anchor = anchorMs(last, exposureStartMs);
  if (!Number.isFinite(anchor) || now - anchor > Math.min(autoProceedMs, ACK_LIVE_STALE_MS)) return null;
  return { id: last.id };
}

/**
 * 창 개시 각인용 후보 id (t_b2004d50) — visibleAckChip과 동일 후보 게이트를 재사용하되 '2.5s 창
 * 경과'와 '스트리밍 억제'는 묻지 않는다. (창 판정까지 후보 배제에 섞으면 노출 개시 각인 자체가
 * 불가능해져 개정의 실행 지점이 소실된다.) useAckChip은 이 id의 최초 관측각을 Map에 보존하고
 * visibleAckChip에 exposureStartMs로 주입한다 — WS 재구독 버스트·재전송 응답이 앵커를 리셋하지
 * 못한다(같은 id 최초값). 단, 스트리밍 억제(t_cc232982 요구3) 구간은 앵커를 무효화한다: 억제 중
 * useAckChip이 Map에서 삭제 → done 후 첫 관측이 새 창 개시. OFF 경로(empathy=런 종료 시 도착)는
 * 억제 구간과 무관하게 도착 각인이 살면서 F 구간의 '도착+2.5s' 창을 만든다.
 */
export function ackChipCandidateId(messages: ChatMessage[], now: number): string | null {
  const last = ackChipCandidate(messages, now, false);
  return last ? last.id : null;
}

/** 백엔드 isConfirmationUtterance와 동일한 정규화 (trim + 어미 구두점/공백 제거 + 소문자). */
export function normalizeAckText(s: string): string {
  return s.trim().toLowerCase().replace(/[.!~〜？?。，,\s]+$/g, '');
}

/** 백엔드 graph.ts CONFIRMATION_UTTERANCES 미러 (t_0e03e405 — 프론트측 확인응답 판정 단일 원천).
 *  백엔드 집합 변경 시 여기와 src/neurons/graph.ts 함께 갱신 (주석 미러 계약). */
export const CONFIRMATION_UTTERANCES: ReadonlySet<string> = new Set([
  '예', '네', '요', 'ㅇ', 'ㄴ', '응', '어', '넵', '넹', 'ㅇㅋ', 'ㄴㄴ',
  '아니', '아니요', '아니오', 'yes', 'no', 'yeah', 'yep', 'nope', 'nah', 'y', 'n', 'ok', 'okay',
  '맞아요', '맞습니다', '맞음', '맞아', '아니에오', '아니에요', '아닙니다',
  '틀렸어', '틀렸어요', '틀림',
]);

/** 백엔드 isConfirmationUtterance(graph.ts:360)와 동일 판정: 정규화 + 길이 ≤8 + 정확 일치 (부분일치 금지).
 *  '예를 들어 아침 루틴…'은 길이/집합 밖 → 오탐 0. */
export function isConfirmationUtterance(text: string): boolean {
  const n = normalizeAckText(text || '');
  return n.length > 0 && n.length <= 8 && CONFIRMATION_UTTERANCES.has(n);
}

/**
 * 확인응답 → 재질문(empathy) 링크 맵 (t_0e03e405 FINAL SCOPE — '예/아니오가 무조건 나오면 그건 쓰레드화')
 *   key = 확인응답 user 행 id, value = 대상 empathy 행 id.
 * 판정 2계층 (백엔드 empathySuppressed 게이트와 동일 전제, history 재현 포함):
 *   ① 구조 신호: user 행의 replyToId가 열린 공감 윈도우의 empathy 행을 가리키면 본문 길이 무관 확인응답.
 *      (열린 윈도우 = 이 empathy 뒤 다른 user 발화 없음. '예'를 리플라이 칩으로 달면 확인 취급 — 대표님
 *      오탐 금지 조항과 정합: 맨 발화 '예를 들어…'는 顶级 유지.)
 *   ② 문장 매칭 폴백: 본문이 CONFIRMATION_UTTERANCES 정확 일치 + 열린 공감 윈도우 존재.
 *      백엔드는 empathy created_at 기준으로 판정하지만 프론트 history에는 타임스탬프 순서만 남는다 →
 *      'empathy 직후(사이 user 발화 없음) 확인 문장' = 백엔드가 empathySuppressed로 처리한 발화와 동일 귀결.
 *   ③ 연속 체인: 직전 user 발화가 확인응답이었고 본인도 확인 문장이면 같은 empathy에 링크
 *      (백엔드 previousTurnWasConfirmation 미러 — '[empathy][예][네]'에서 '네'가 새 질문이 되지 않게).
 * 열린 윈도우가 없으면 ('예' 단독 발화 = 공감 없음) 링크하지 않는다 → 顶级 질문 유지 (김비서 케이스 1 후속).
 * 답글 스레드 user 행(parentMessageId)은 대상 아님 — 메인 피드 발화만 윈도우를 연다/닫는다.
 * 낙관(pending) '예'도 링크 — 상단 스트립/트래커가 POST 왕복 전에 확인응답으로 흡수(반짝 질문 행 방지).
 */
export function confirmationLinks(messages: ChatMessage[]): Map<string, string> {
  const out = new Map<string, string>();
  let open: ChatMessage | null = null; // 메인 피드 empathy — 그 뒤 user 발화가 없을 때만 '열린' 상태
  let lastAckEmpathy: string | null = null; // ③ 체인 앵커 (직전 user 발화가 확인응답だった empathy)
  for (const m of messages) {
    if (isEmpathyEchoMessage(m)) { open = m; lastAckEmpathy = null; continue; }
    if (m.role !== 'user' || m.parentMessageId) continue;
    if (open) {
      const structural = !!m.replyToId && m.replyToId === open.id;
      const matched = isConfirmationUtterance(m.content || '');
      if (structural || matched) { out.set(m.id, open.id); lastAckEmpathy = open.id; open = null; continue; }
    } else if (lastAckEmpathy && isConfirmationUtterance(m.content || '')) {
      out.set(m.id, lastAckEmpathy); // ③ 연속 확인 체인
      continue;
    }
    open = null; // 그 외 user 발화 = 윈도우 닫힘 (일반 질문/장문 '아니요 그거 말고' 등)
    lastAckEmpathy = null;
  }
  return out;
}

/** 확인 스레드 프레임 (t_0e03e405 렌더 층위 스레드화) — empathy 행 → 원 질문 {id, text}.
 *  원 질문 = 그 empathy 직전(턴 순) 메인 피드 user 루트 행. 없으면 프레임 없음(데모/이상 데이터 강등). */
export interface ConfirmFrame { empathyId: string; rootId: string; rootText: string }
export interface ConfirmFrames {
  /** empathy id → 프레임 (ChatTurnRow가 해당 카드를 '확인 스레드' 컨테이너로 감싼다) */
  byEmpathy: Map<string, ConfirmFrame>;
  /** 원 질문 id → 그 아래 열린 empathy id 목록 (질문 카드의 '확인 스레드' 진입 배지) */
  byRoot: Map<string, string[]>;
}
export function buildConfirmFrames(messages: ChatMessage[]): ConfirmFrames {
  const byEmpathy = new Map<string, ConfirmFrame>();
  const byRoot = new Map<string, string[]>();
  const links = confirmationLinks(messages);
  let lastRoot: ChatMessage | null = null;
  for (const m of messages) {
    // 顶级 질문 = 마지막 비답글 user 행 중 **확인응답 아닌 것** ([q][e][예][e2]에서 e2의 원문은 q)
    if (m.role === 'user' && !m.parentMessageId && !links.has(m.id)) { lastRoot = m; continue; }
    if (!isEmpathyEchoMessage(m) || !lastRoot) continue;
    byEmpathy.set(m.id, { empathyId: m.id, rootId: lastRoot.id, rootText: (lastRoot.content || '').trim() });
    byRoot.set(lastRoot.id, [...(byRoot.get(lastRoot.id) ?? []), m.id]);
  }
  return { byEmpathy, byRoot };
}

/** 화면(ChatScreen useMemo) → ChatTurnRow 배선 팩 (t_0e03e405) — frames + empathy별 병합 ack 행. */
export interface ConfirmView extends ConfirmFrames {
  /** empathy id → 확인응답 user 행(스레드 내부_reply 라인; 메인 버블에서는 숨김) */
  acksByEmpathy: Map<string, ChatMessage[]>;
  /** 병합 확인응답 user 행 id 집합 (O(1) 렌더 필터) */
  ackIds: Set<string>;
}
export function buildConfirmView(messages: ChatMessage[]): ConfirmView {
  const links = confirmationLinks(messages);
  const frames = buildConfirmFrames(messages);
  const acksByEmpathy = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    const emp = links.get(m.id);
    if (emp) acksByEmpathy.set(emp, [...(acksByEmpathy.get(emp) ?? []), m]);
  }
  return { ...frames, acksByEmpathy, ackIds: new Set(links.keys()) };
}

/**
 * ack 결과 카드 숨김 판정 (t_64e3edd6 ②, 대표님 9/29 "예 아 니오의 결과는 사실상 카드로 안 보여줘도 돼"):
 * 공감 재질문(empathy 행) 이후, 그 사이에 다른 user 발화 없이 등장한 user 행 중 본문이
 * 예/아니요 라벨(현 locale '예'/'아니요', en 'Yes'/'No')과 정확 일치하면 렌더에서 제외한다.
 * 전송 자체는 정상 진행(백엔드 게이트 판정 전달) — 숨김은 화면 layer만. 라벨 외 일반 발화는
 * 재질문 창을 닫고(리셋), 이후 같은 라벨 재발화는 다시 숨김 대상(새 재질문 기준).
 * 낙관행/서버행 동일 규칙 적용 — 재진입 히스토리에서도 일관되게 숨김(결과는 카드 불필요 계약).
 */
export function ackResultCardIds(messages: ChatMessage[], labels: string[]): Set<string> {
  const want = new Set(labels.map(normalizeAckText).filter(Boolean));
  const out = new Set<string>();
  if (!want.size) return out;
  let empathyTurn: number | null = null;
  for (const m of messages) {
    if (isEmpathyEchoMessage(m)) { empathyTurn = m.turnIndex; continue; }
    if (m.role !== 'user') continue;
    if (empathyTurn !== null && m.turnIndex > empathyTurn && want.has(normalizeAckText(m.content || ''))) {
      out.add(m.id);
    } else {
      empathyTurn = null; // 그 외 user 발화 = 재질문 창 종료
    }
  }
  return out;
}
