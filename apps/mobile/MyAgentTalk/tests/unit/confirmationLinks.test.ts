// 확인응답 판정 순수 함수 단위 테스트 (t_0e03e405 FINAL SCOPE — 확인응답 스레드화의 단일 원천)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmationLinks, buildConfirmFrames, isConfirmationUtterance } from '../../src/lib/ackChips';
import type { ChatMessage } from '../../src/lib/chatLogic';

const at = (msAgo = 30000) => new Date(Date.UTC(2026, 9, 4, 12) - msAgo).toISOString();
const user = (id: string, turn: number, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: 'user', content: `질문 ${id}`, turnIndex: turn, createdAt: at(), ...over }) as ChatMessage;
const empathy = (id: string, turn: number, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: 'agent', content: `재질문 ${id}`, turnIndex: turn, sourceNeuron: 'empathy', createdAt: at(), ...over }) as ChatMessage;
const answer = (id: string, turn: number): ChatMessage =>
  ({ id, role: 'agent', content: `답 ${id}`, turnIndex: turn, sourceNeuron: 'answer', createdAt: at() }) as ChatMessage;

test('isConfirmationUtterance — 백엔드 집합 미러: 정확 일치만, 부분일치 금지', () => {
  for (const t of ['예', '네', '아니요', 'Y', 'ok', 'ㅇ', '맞아요', '아니에오', '틀렸어', '예.', '네!!', '아니요~']) {
    assert.ok(isConfirmationUtterance(t), `${t} 확인 문장`);
  }
  for (const t of ['예를 들어 아침 루틴 알려줘', '아니요 그거 말고 다른 거', '예' + ' '.repeat(1) + '스러워', '', '   ', 'y'.repeat(9)]) {
    assert.ok(!isConfirmationUtterance(t), `${t} != 확인 (오탐 금지)`);
  }
});

test('confirmationLinks — 구조 신호(replyToId→empathy) 우선: 본문 길이 무관', () => {
  const msgs = [user('u1', 0), empathy('e1', 1), user('ack1', 2, { content: '-long text, but replied to the empathy card', replyToId: 'e1' })];
  assert.deepEqual([...confirmationLinks(msgs).entries()], [['ack1', 'e1']]);
});

test('confirmationLinks — 열린 공감 윈도우에서만 매칭 (empathy 없는 맨 \'예\'는 링크 NOT)', () => {
  const bare = [user('u1', 0, { content: '예' })];
  assert.equal(confirmationLinks(bare).size, 0, '공감 없음 = 확인 아닌 사용자 발화 (顶级 질문 유지)');
  // empathy가 이미 다른 발화로 닫힌 후 오는 '예'도 링크 안 함 (백엔드 hasTrailingEmpathyRow과 동일 전제)
  const closed = [empathy('e1', 0), user('u1', 1), user('u2', 2, { content: '예' })];
  assert.equal(confirmationLinks(closed).size, 0);
});

test('confirmationLinks — 연속 확인 체인 [empathy][예][네] 모두 같은 empathy에 링크', () => {
  const msgs = [user('u1', 0), empathy('e1', 1), user('a1', 2, { content: '예' }), user('a2', 3, { content: '네' })];
  assert.deepEqual([...confirmationLinks(msgs).values()], ['e1', 'e1']);
});

test('confirmationLinks — 답글 스레드 user 행(parentMessageId)은 윈도우 닫지 않고 링크 대상도 아니다', () => {
  const msgs = [user('u1', 0), empathy('e1', 1), user('r1', 2, { content: '예', parentMessageId: 'u1' }), user('a1', 3, { content: '예' })];
  const links = confirmationLinks(msgs);
  assert.equal(links.has('r1'), false, '스레드 답글은 확인응답 흡수 대상 아님');
  assert.equal(links.get('a1'), 'e1', '메인 확인은 여전히 열린 윈도우에 링크');
});

test('confirmationLinks — 낙관(pending) \'예\'도 즉시 링크 (상단 스트립/트래커 반짝 질문 방지)', () => {
  const msgs = [user('u1', 0), empathy('e1', 1), user('ack1', 2, { content: '예', pending: true, status: 'pending' })];
  assert.equal(confirmationLinks(msgs).get('ack1'), 'e1');
});

test('buildConfirmFrames — empathy → 원 질문 프레임, root → empathy 목록 (뱃지)', () => {
  const msgs = [user('u1', 0, { content: '견적 알려줘' }), empathy('e1', 1), answer('a1', 2), user('u2', 3, { content: '다음' }), empathy('e2', 4)];
  const { byEmpathy, byRoot } = buildConfirmFrames(msgs);
  assert.equal(byEmpathy.get('e1')!.rootId, 'u1');
  assert.equal(byEmpathy.get('e1')!.rootText, '견적 알려줘');
  assert.equal(byEmpathy.get('e2')!.rootId, 'u2');
  assert.deepEqual(byRoot.get('u1'), ['e1']);
  assert.equal(byEmpathy.has('a1'), false, 'answer 행은 프레임 아님');
});

test('buildConfirmFrames — empathy preceding user 발화 없으면 프레임 없음 (데모/이상 데이터 강등)', () => {
  const msgs = [empathy('e1', 0), user('u1', 1)];
  assert.equal(buildConfirmFrames(msgs).byEmpathy.size, 0);
});

test("buildConfirmFrames — 연속 확인 후 재질문 [q][e1][예][e2]: e2의 원문은 q ('예'는 원문 아니다)", () => {
  const msgs = [user('q', 0, { content: '질문' }), empathy('e1', 1), user('a1', 2, { content: '예' }), empathy('e2', 3)];
  const { byEmpathy, byRoot } = buildConfirmFrames(msgs);
  assert.equal(byEmpathy.get('e2')!.rootId, 'q');
  assert.deepEqual(byRoot.get('q'), ['e1', 'e2']);
});
