// 답글 목록 인덱스 순수 로직 (t_2f45ccb1 확장 3·4) — 그룹핑/종료(7일)/정렬/병합
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildThreadIndex, mergeThreadIndex, ChatMessage } from '../../src/lib/chatLogic';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const msg = (over: Partial<ChatMessage>): ChatMessage =>
  ({ id: 'm1', role: 'user', content: '질문', turnIndex: 1, ...over }) as ChatMessage;

test('buildThreadIndex — 답글 딸린 루트만 행, 답글 수/순번/마지막 활동', () => {
  const out = buildThreadIndex([
    msg({ id: 'q1', turnIndex: 1, createdAt: '2026-09-27T10:00:00Z' }),
    msg({ id: 'a1', role: 'agent', turnIndex: 1, createdAt: '2026-09-27T10:00:05Z' }),
    msg({ id: 'q2', turnIndex: 2, content: '두 질문', createdAt: '2026-09-20T10:00:00Z' }),
    msg({ id: 'r1', role: 'agent', content: '답글A', turnIndex: 3, parentMessageId: 'q2', rootMessageId: 'q2', createdAt: '2026-09-21T09:00:00Z' }),
    msg({ id: 'r2', content: '답글B', turnIndex: 4, parentMessageId: 'q2', rootMessageId: 'q2', createdAt: '2026-09-25T08:00:00Z' }),
  ], NOW);
  assert.deepEqual(out.map((e) => e.rootId), ['q2'], '답글 없는 q1은 인덱스에 없다');
  assert.equal(out[0].replyCount, 2);
  assert.equal(out[0].rootSeq, 2, '루트 질문의 세션 순번');
  assert.equal(out[0].lastActivity, '2026-09-25T08:00:00Z', '답글 중 최신 시각');
  assert.equal(out[0].ended, false, '7일 내 활동 = 활성');
});

test('buildThreadIndex — 7일 무활동 = 종료 배지, 정렬은 활성>종료 후 활동 최신순', () => {
  const out = buildThreadIndex([
    msg({ id: 'old', content: '오래된 질문', turnIndex: 1, createdAt: '2026-09-01T00:00:00Z' }),
    msg({ id: 'oldr', content: '오래된 답글', role: 'agent', turnIndex: 2, parentMessageId: 'old', rootMessageId: 'old', createdAt: '2026-09-01T00:01:00Z' }),
    msg({ id: 'fresh', content: '최신 질문', turnIndex: 3, createdAt: '2026-09-28T11:00:00Z' }),
    msg({ id: 'freshr', content: '최신 답글', role: 'agent', turnIndex: 4, parentMessageId: 'fresh', rootMessageId: 'fresh', createdAt: '2026-09-28T11:30:00Z' }),
    msg({ id: 'mid', content: '중간 질문', turnIndex: 5, createdAt: '2026-09-22T10:00:00Z' }),
    msg({ id: 'midr', content: '중간 답글', role: 'agent', turnIndex: 6, parentMessageId: 'mid', rootMessageId: 'mid', createdAt: '2026-09-22T10:00:00Z' }),
  ], NOW);
  assert.deepEqual(out.map((e) => e.rootId), ['fresh', 'mid', 'old']);
  assert.equal(out[2].ended, true);
  assert.equal(out[1].ended, false, '6일 전 활동 = 아직 활성');
});

test('buildThreadIndex — 답글 행이 페이징 밖이어도 서버 thread_reply_count로 행이 선다', () => {
  const out = buildThreadIndex([
    msg({ id: 'q1', turnIndex: 1, threadReplyCount: 3, createdAt: '2026-09-27T00:00:00Z' }),
  ], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].replyCount, 3, '응답 행 미탑재 시 서버 카운터 우선');
});

test('buildThreadIndex — root_message_id 없으면 부모 체인 역추적, 유실 체인은 조용히 스킵', () => {
  const out = buildThreadIndex([
    msg({ id: 'q1', turnIndex: 1 }),
    msg({ id: 'r1', role: 'agent', parentMessageId: 'q1', content: '답글' }),
    msg({ id: 'r2', role: 'agent', parentMessageId: 'ghost', content: '루트 실종' }),
  ], NOW);
  assert.deepEqual(out.map((e) => e.rootId), ['q1']);
});

test('mergeThreadIndex — 같은 루트는 최신 활동/큰 답글 수, 정렬 재계산', () => {
  const prev = buildThreadIndex([
    msg({ id: 'q1', createdAt: '2026-09-20T00:00:00Z' }),
    msg({ id: 'r', role: 'agent', parentMessageId: 'q1', rootMessageId: 'q1', createdAt: '2026-09-20T00:00:00Z' }),
  ], NOW);
  const fresh = buildThreadIndex([
    msg({ id: 'q1', createdAt: '2026-09-20T00:00:00Z' }),
    msg({ id: 'r', role: 'agent', parentMessageId: 'q1', rootMessageId: 'q1', createdAt: '2026-09-27T00:00:00Z' }),
    msg({ id: 'r2', role: 'agent', parentMessageId: 'q1', rootMessageId: 'q1', createdAt: '2026-09-27T01:00:00Z' }),
  ], NOW);
  const merged = mergeThreadIndex(prev, fresh);
  assert.equal(merged.length, 1, '같은 루트 중복 방지');
  assert.equal(merged[0].replyCount, 2);
  assert.equal(merged[0].lastActivity, '2026-09-27T01:00:00Z');
});
