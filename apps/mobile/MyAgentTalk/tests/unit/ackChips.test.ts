// 공감 재질문 카드 하단 예/아니요 버튼 행 순수 로직 단위 테스트 — src/lib/ackChips.ts
// (t_043539ff 소형 척 → t_c62a2eb7 텔레그램식 50/50 대형 버튼 격상 → t_1b123e59 라벨/순서 고정)
// t_c62a2eb7 변경점: ① 3초 창(deadline) 폐기 — 발화 진행(뒤의 user 행)까지 유지 ③ 시작각 모듈 캐시 폐기.
// t_1b123e59 변경점: ② template_id 어미 라벨 바인딩(ackLabelKeysFor) 폐기 — 라벨 무조건 '예'/'아니요'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ackChips from '../../src/lib/ackChips';
import {
  ACK_LIVE_STALE_MS,
  ACK_AUTO_PROCEED_MS,
  isEmpathyEchoMessage,
  visibleAckChip,
  ackChipCandidateId,
  ackResultCardIds,
  normalizeAckText,
} from '../../src/lib/ackChips';
// t_b2004d50: 라이브 도착 도장/POST 확정 도장은 chatLogic 소유 (WS 에코·confirmTurn 경로)
import { stampAckArrival, confirmTurn, mergeIncoming } from '../../src/lib/chatLogic';
import type { ChatMessage } from '../../src/lib/chatLogic';

const T0 = Date.parse('2026-09-28T00:00:00Z');
const iso = (msFromT0: number) => new Date(T0 + msFromT0).toISOString();

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id'>): ChatMessage {
  return { role: 'agent', content: '공감 재질문', turnIndex: 1, ...partial } as ChatMessage;
}
const empathy = (over: Partial<ChatMessage> = {}) =>
  msg({ id: over.id ?? 'e1', role: 'agent', sourceNeuron: 'empathy', content: '이거 맞죠? 출장 일정', turnIndex: 2, createdAt: iso(0), ...over });

test('isEmpathyEchoMessage — 메인 피드 공감 행만 true', () => {
  assert.equal(isEmpathyEchoMessage(empathy()), true);
  assert.equal(isEmpathyEchoMessage(msg({ id: 'a1', sourceNeuron: 'answer' })), false);
  assert.equal(isEmpathyEchoMessage(msg({ id: 'u1', role: 'user', sourceNeuron: null })), false);
  assert.equal(isEmpathyEchoMessage(empathy({ id: 'te', parentMessageId: 'x' })), false); // 스레드 답글 제외
  assert.equal(isEmpathyEchoMessage(empathy({ id: 'e0', content: '  ' })), false);         // 빈 본문 제외
});

test('t_64e3edd6: 2.5초 미터치 자동 소진 — 표시 창 내만 노출, 그 후 null (자동 진행은 백엔드 파이프라인)', () => {
  const m = empathy();
  const list = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-1000) }), m];
  const first = visibleAckChip(list, T0 + 1000);
  assert.ok(first);
  assert.equal(first!.id, 'e1');
  assert.ok(!('deadline' in first!), 'deadline 제거 — 수명 판정은 visibleAckChip(now) 단일 진입');
  // 창 경계: 2.5s 이내 유지, 초과 시 소멸
  assert.ok(visibleAckChip(list, T0 + 2500));
  assert.equal(visibleAckChip(list, T0 + 2501), null);
  // 오래된 시각(T0+10s)도 소멸 — 무한 유지(t_c62a2eb7 #2)는 9/29 개정으로 폐기
  assert.equal(visibleAckChip(list, T0 + 10000), null);
});

test('소멸: 공감보다 늦은 user 발화(버튼 탭 낙관/직접 발화/큐 드레인) 시 즉시 소멸', () => {
  const e = empathy();
  const before = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-2000) }), e];
  assert.ok(visibleAckChip(before, T0));
  const tapped = [...before, msg({ id: 'u2', role: 'user', content: '예', turnIndex: 3, pending: true, createdAt: iso(500) })];
  assert.equal(visibleAckChip(tapped, T0 + 500), null);
  const drained = [...before, msg({ id: 'u2', role: 'user', content: '다음 질문', turnIndex: 3, createdAt: iso(500) })];
  assert.equal(visibleAckChip(drained, T0 + 500), null); // 큐 드레인 발화도 동일
});

test('같은 턴의 answer 행·이후 empathy 무관계 소멸 조건 아님 — 마지막 공감만 대상', () => {
  const e = empathy();
  const withAnswer = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-2000) }), e, msg({ id: 'a1', sourceNeuron: 'answer', turnIndex: 2, createdAt: iso(0) })];
  assert.equal(visibleAckChip(withAnswer, T0)!.id, 'e1');
  const second = [
    msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-2000) }),
    empathy({ id: 'e1' }),
    msg({ id: 'u2', role: 'user', turnIndex: 3, createdAt: iso(100) }),
    empathy({ id: 'e2', turnIndex: 4, createdAt: iso(200) }),
  ];
  // e1은 u2가 넘어갔으니 소멸 — e2만 노출(마지막 공감 하나만)
  assert.equal(visibleAckChip(second, T0 + 300)!.id, 'e2');
});

test('히스토리 재현 배제 — createdAt이 ACK_LIVE_STALE_MS 초과면 대상 아님; created_at 결측도 제외', () => {
  const stale = empathy({ id: 'es', createdAt: iso(-(ACK_LIVE_STALE_MS + 1000)) });
  assert.equal(visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-40000) }), stale], T0), null);
  const noStamp = empathy({ id: 'en', createdAt: undefined });
  assert.equal(visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1 }), noStamp], T0), null);
});

test('공감 행 없으면 null', () => {
  assert.equal(visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(0) })], T0), null);
  assert.equal(visibleAckChip([], T0), null);
});

// ── t_cc232982 요구3: 스트리밍 중 억제 — answer.done 전 반쯤 쓰인 카드에 버튼 행 금지 ──

test('t_cc232982 #3: streaming=true 이면 생생한 재질문도 버튼 행 억제 (기본값 false — 기존 호출 무변경)', () => {
  const m = empathy();
  const list = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-1000) }), m];
  assert.ok(visibleAckChip(list, T0 + 1000), '미스트리밍 = 기존 노출 유지');
  assert.equal(visibleAckChip(list, T0 + 1000, undefined, true), null, '스트리밍 중 = 억제');
  assert.equal(visibleAckChip(list, T0 + 1000, ACK_LIVE_STALE_MS, false)!.id, 'e1', 'false 명시 = 노출 (answer.done 후 해제 경로)');
});

// ── t_1b123e59 라벨 고정 — 템플릿 바인딩(t_c62a2eb7 #4) 폐기 regression 가드 ──

test('t_1b123e59 #1: ackChips는 라벨 바인딩을 노출하지 않는다 — eq_confirm이어도 예/아니요 고정 (원문②)', () => {
  assert.ok(!('ackLabelKeysFor' in ackChips), 'ackLabelKeysFor 폐기 — template_id→맞아요 바인딩 부재 보장');
  assert.ok(!('ACK_MATCH_TEMPLATE_IDS' in ackChips), 'ACK_MATCH_TEMPLATE_IDS 폐기');
});

// ── t_64e3edd6 (9/29): 자동 소진 상수 + ack 결과 카드 숨김 판정 ──

test('t_64e3edd6 ①: ACK_AUTO_PROCEED_MS = 2500 (3초→2.5초, #321)', () => {
  assert.equal(ACK_AUTO_PROCEED_MS, 2500);
});

test("t_64e3edd6 ②: ackResultCardIds — 재질문 뒤 '예'/'아니요' user 행만 집합, 일반 발화 시 리셋", () => {
  const labels = ['예', '아니요'];
  const list = [
    msg({ id: 'u1', role: 'user', content: '일정 정리 도와줄래', turnIndex: 1, createdAt: iso(-1000) }),
    empathy({ id: 'e1', turnIndex: 2, createdAt: iso(0) }),
    msg({ id: 'u2', role: 'user', content: '예', turnIndex: 3, createdAt: iso(500) }),
  ];
  assert.deepEqual([...ackResultCardIds(list, labels)], ['u2']);
  // 어미 구두점/공백/대소문자 정규화 일치 ('예.', 'YES')
  assert.deepEqual([...ackResultCardIds([
    empathy({ id: 'e1' }), msg({ id: 'u2', role: 'user', content: '예. ', turnIndex: 3 }),
    empathy({ id: 'e2', turnIndex: 4 }), msg({ id: 'u3', role: 'user', content: 'YES', turnIndex: 5 }),
  ], ['예', '아니요', 'Yes', 'No'])], ['u2', 'u3']);
  // 그 사이 일반 user 발화 = 창 종료 → 이후 같은 라벨도 숨김 아님 (새 재질문 기준)
  const closed = [
    empathy({ id: 'e1', turnIndex: 2 }),
    msg({ id: 'u2', role: 'user', content: '아 맞다', turnIndex: 3 }),
    msg({ id: 'u3', role: 'user', content: '예', turnIndex: 4 }),
  ];
  assert.equal(ackResultCardIds(closed, labels).size, 0);
  // 재질문 없는 단독 '예' 발화(일반 대화)는 절대 숨기지 않는다
  assert.equal(ackResultCardIds([msg({ id: 'u1', role: 'user', content: '예', turnIndex: 1 })], labels).size, 0);
  // 에이전트 행은 대상 아님 (role=user만)
  assert.equal(ackResultCardIds([empathy({ id: 'e1' }), msg({ id: 'a1', role: 'agent', content: '예', turnIndex: 3 })], labels).size, 0);
  assert.equal(normalizeAckText(' 아니요!! '), '아니요');
});

// ── t_b2004d50 (김비서 9/30): 칩 창 앵커 = 서버 created_at → 클라이언트 도착/노출 시점 ──

test('t_b2004d50 ①: created_at 선버링(+144s 실측 모드) + 즉각 도착 도장 → 노출 창 열림 (t_888c1669 F 실패 모드 교정)', () => {
  // 서버는 empathy created_at을 턴 시작 각도로 고정 발행 — WS 도착이 144s 늦어도 도장 각도가 창을 연다.
  const pre = empathy({ id: 'eL', createdAt: iso(-144000), arrivedAt: T0 });
  const list = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-145000) }), pre];
  assert.equal(visibleAckChip(list, T0 + 1000)!.id, 'eL', '수신 후 1s = 창 내 (created_at 만료 무관)');
  assert.equal(visibleAckChip(list, T0 + 2500)!.id, 'eL', '수신 후 정확히 2.5s 경계 = 아직 노출');
  assert.equal(visibleAckChip(list, T0 + 2501), null, '수신 후 2.5s 초과 = 미터치 소진 유지');
});

test('t_b2004d50 ②: 히스토리 재현(미도장 + created 경화)은 노출 가능 시각이 있어도 배제 — 무버튼 회귀 유지', () => {
  const replay = empathy({ id: 'eH', createdAt: iso(-144000) }); // 배치 GET: arrivedAt 미스탬프
  // exposureStartMs를 now와 동일(='방금 노출 가능')으로 주입해도 라이브 게이트가 먼저 배제한다.
  assert.equal(visibleAckChip([replay], T0, undefined, false, T0), null);
  assert.equal(ackChipCandidateId([replay], T0), null, '각인 후보 자체가 없다(재진입 재점등 원천 차단)');
  // 이전 턴 실시간 행(도장+created 동시 경화) — useAckChip의 첫 관측 각인 = 도장각과 같으므로 창 종료 배제
  assert.equal(visibleAckChip([empathy({ id: 'eB', createdAt: iso(-60000), arrivedAt: T0 - 60000 })], T0, undefined, false, T0 - 60000), null);
});

test('t_b2004d50 ③: 후보 게이트는 스트리밍 억제와 무관(창 개시 자격 id), 창 판정만 억제 — done 후 새 각인', () => {
  const live = empathy({ id: 'eS', createdAt: iso(-144000), arrivedAt: T0 }); // 스트리밍 중 WS 도착·도장
  const list = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-145000) }), live];
  assert.equal(ackChipCandidateId(list, T0 + 1000), 'eS', '억제 중에도 후보 자격 id는 유효(useAckChip이 각인 폐기/재각인으로 처리)');
  assert.equal(visibleAckChip(list, T0 + 1000, undefined, true), null, '스트리밍 중 = 창 미노출(t_cc232982 요구3)');
  // useAckChip: 억제 중 Map 삭제 → done 후 첫 관측각(T0+4000) 재각인 = 새 창 개시 (해제 후 fresh 2.5s)
  assert.equal(visibleAckChip(list, T0 + 5000, undefined, false, T0 + 4000)!.id, 'eS');
  assert.equal(visibleAckChip(list, T0 + 6501, undefined, false, T0 + 4000), null, '해제 후 2.5s 초과 = 소진');
  // 각인 미주입 폴백 = 수신각 앵커 — 억제 없이 도착 즉시라면 수신각에서 창
  assert.equal(visibleAckChip(list, T0 + 2000)!.id, 'eS', '미주입도 arrivedAt=T0 기준 창 내');
});

test('t_b2004d50 ④: stampAckArrival 단일 도장 — 재구독 리플레이/지연 중복이 수신각을 리셋하지 않는다', () => {
  const stamped = stampAckArrival(empathy({ id: 'eR' }), T0);
  assert.equal(stamped.arrivedAt, T0);
  const replayed = stampAckArrival(stamped, T0 + 90000);
  assert.equal(replayed.arrivedAt, T0, '이미 도장된 행은 그대로(동일 참조 반환)');
  assert.equal(replayed, stamped);
  assert.equal(stampAckArrival(msg({ id: 'n1' }), T0).arrivedAt, T0, '미도장 행은 도장 부여');
});

test('t_b2004d50 ⑤: confirmTurn POST 확정 = 신규 행에만 수신각 도장 — 기존 히스토리 행 무도장 유지', () => {
  const history = empathy({ id: 'eOld', createdAt: iso(-300000) });
  const out = confirmTurn([msg({ id: 'u0', role: 'user', turnIndex: 1, createdAt: iso(-301000) }), history],
    'opt1', {
      user_message_id: 'u1', empathy_message_id: 'eNew', empathy_response: '이거 맞죠? 새 발화',
      answer_message_id: 'aNew', answer_response: '답변 본문',
    }, '새 발화', 2, T0 + 1000);
  const byId = new Map(out.map((m) => [m.id, m]));
  assert.equal((byId.get('eNew') as ChatMessage).arrivedAt, T0 + 1000, 'POST 응답 empathy = 라이브 도장');
  assert.equal((byId.get('aNew') as ChatMessage).arrivedAt, T0 + 1000);
  assert.equal((byId.get('eOld') as ChatMessage).arrivedAt, undefined, '기존 히스토리 행 소급 도장 금지');
  // 도장된 새 empathy가 바로 칩 후보가 된다 (created_at 없는 legacy confirm 응답 형태도 수신각으로 열림)
  assert.equal(visibleAckChip(out, T0 + 2000)!.id, 'eNew');
});

test('t_b2004d50 ⑥: WS 에코 merge 경유 도장 — mergeIncoming 후 candidate/창이 수신각 기준', () => {
  const echo = stampAckArrival(empathy({ id: 'eW', createdAt: iso(-144000) }), T0);
  const merged = mergeIncoming([msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-145000) })], [echo]);
  assert.equal(ackChipCandidateId(merged, T0 + 500), 'eW');
  // created가 미래로 배버링된 스큐(서버 시계 +1h)는 수신각이 대체 — 창이 즉시 만료되지 않는다
  const skewed = stampAckArrival(empathy({ id: 'eK', createdAt: iso(3600000) }), T0);
  assert.equal(visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1 }), skewed], T0 + 1000)!.id, 'eK', '미주입 = arrivedAt 앵커 (created 미래 스큐 무시)');
  assert.equal(visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1 }), skewed], T0 + 2501), null, '수신각 기준 2.5s 후 소진(스크어가 창을 무한 연장하지 못함)');
});
