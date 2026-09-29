// 공감 재질문 카드 하단 예/아니요 버튼 행 순수 로직 단위 테스트 — src/lib/ackChips.ts
// (t_043539ff 소형 척 → t_c62a2eb7 텔레그램식 50/50 대형 버튼 격상 → t_1b123e59 라벨/순서 고정)
// t_c62a2eb7 변경점: ① 3초 창(deadline) 폐기 — 발화 진행(뒤의 user 행)까지 유지 ③ 시작각 모듈 캐시 폐기.
// t_1b123e59 변경점: ② template_id 어미 라벨 바인딩(ackLabelKeysFor) 폐기 — 라벨 무조건 '예'/'아니요'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ackChips from '../../src/lib/ackChips';
import {
  ACK_LIVE_STALE_MS,
  isEmpathyEchoMessage,
  visibleAckChip,
} from '../../src/lib/ackChips';
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

test('t_c62a2eb7 #2: 3초 창 폐기 — 발화 진행 없으면 재질문 카드에 버튼 행 유지 (deadline 필드 없음)', () => {
  const m = empathy();
  const list = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-1000) }), m];
  const first = visibleAckChip(list, T0 + 1000);
  assert.ok(first);
  assert.equal(first!.id, 'e1');
  assert.ok(!('deadline' in first!), 'deadline 제거 — 시각 수명 소유권 폐기');
  // 구 3초 창 종료 지점(T0+4001)에서도 여전히 노출 (staleMs 15s 내)
  assert.ok(visibleAckChip(list, T0 + 4001));
  // 10초 후에도 유지 (ACK_LIVE_STALE_MS=15s 내)
  assert.ok(visibleAckChip(list, T0 + 10000));
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
