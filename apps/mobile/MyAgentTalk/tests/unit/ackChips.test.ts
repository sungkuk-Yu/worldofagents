// 예/아니요 칩 수명 순수 로직 단위 테스트 — src/lib/ackChips.ts (카드 t_043539ff)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACK_CHIP_WINDOW_MS,
  ACK_LIVE_STALE_MS,
  isEmpathyEchoMessage,
  resetAckChipStarts,
  visibleAckChip,
} from '../../src/lib/ackChips';
import type { ChatMessage } from '../../src/lib/chatLogic';

const T0 = Date.parse('2026-09-28T00:00:00Z');
const iso = (msFromT0: number) => new Date(T0 + msFromT0).toISOString();

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id'>): ChatMessage {
  return { role: 'agent', content: '공감 복창', turnIndex: 1, ...partial } as ChatMessage;
}
const empathy = (over: Partial<ChatMessage> = {}) =>
  msg({ id: over.id ?? 'e1', role: 'agent', sourceNeuron: 'empathy', content: '출장 일정 문의하셨어요', turnIndex: 2, createdAt: iso(0), ...over });

const reset = () => resetAckChipStarts();

test('isEmpathyEchoMessage — 메인 피드 공감 행만 true', () => {
  assert.equal(isEmpathyEchoMessage(empathy()), true);
  assert.equal(isEmpathyEchoMessage(msg({ id: 'a1', sourceNeuron: 'answer' })), false);
  assert.equal(isEmpathyEchoMessage(msg({ id: 'u1', role: 'user', sourceNeuron: null })), false);
  assert.equal(isEmpathyEchoMessage(empathy({ id: 'te', parentMessageId: 'x' })), false); // 스레드 답글 제외
  assert.equal(isEmpathyEchoMessage(empathy({ id: 'e0', content: '  ' })), false);         // 빈 본문 제외
});

test('칩 노출: 공감 행 등장 후 3초 창 내/외', () => {
  reset();
  const m = empathy();
  const inWindow = visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-1000) }), m], T0 + 1000);
  assert.ok(inWindow);
  assert.equal(inWindow!.id, 'e1');
  assert.equal(inWindow!.deadline, T0 + 1000 + ACK_CHIP_WINDOW_MS); // 시작각 = 최초 판정 시점(T0+1000)+3000
  // 창 종료(시작각 기준이므로 시계 진행만으로 소멸)
  assert.equal(visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-1000) }), m], T0 + 4001), null);
});

test('컴포넌트 재마운트(재판정)로도 수명 갱신 없음 — 시작각 캐시 유지', () => {
  reset();
  const list = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-1000) }), empathy()];
  assert.ok(visibleAckChip(list, T0));                 // mount 1
  const second = visibleAckChip(list, T0 + 2000);       // remount 2 — 같은 id
  assert.ok(second);
  assert.equal(second!.deadline, T0 + ACK_CHIP_WINDOW_MS); // deadline 고정(갱신 없음)
  assert.equal(visibleAckChip(list, T0 + ACK_CHIP_WINDOW_MS + 1), null);
});

test('답변 시작 후 잔존 금지 — 공감보다 늦은 user 발화(칩 탭 낙관 행 포함) 시 즉시 소멸', () => {
  reset();
  const e = empathy();
  const before = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-2000) }), e];
  assert.ok(visibleAckChip(before, T0));
  const tapped = [...before, msg({ id: 'u2', role: 'user', content: '예', turnIndex: 3, pending: true, createdAt: iso(500) })];
  assert.equal(visibleAckChip(tapped, T0 + 500), null);
  reset();
  const drained = [...before, msg({ id: 'u2', role: 'user', content: '다음 질문', turnIndex: 3, createdAt: iso(500) })];
  assert.equal(visibleAckChip(drained, T0 + 500), null); // 큐 드레인 발화도 동일
});

test('같은 턴의 answer 행·이후 empathy 무관계 소멸 조건 아님 — 마지막 공감만 대상', () => {
  reset();
  const e = empathy();
  const withAnswer = [msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-2000) }), e, msg({ id: 'a1', sourceNeuron: 'answer', turnIndex: 2, createdAt: iso(0) })];
  assert.equal(visibleAckChip(withAnswer, T0)!.id, 'e1');
  reset();
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
  reset();
  const stale = empathy({ id: 'es', createdAt: iso(-(ACK_LIVE_STALE_MS + 1000)) });
  assert.equal(visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(-40000) }), stale], T0), null);
  reset();
  const noStamp = empathy({ id: 'en', createdAt: undefined });
  assert.equal(visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1 }), noStamp], T0), null);
});

test('공감 행 없으면 null', () => {
  reset();
  assert.equal(visibleAckChip([msg({ id: 'u1', role: 'user', turnIndex: 1, createdAt: iso(0) })], T0), null);
  assert.equal(visibleAckChip([], T0), null);
});
