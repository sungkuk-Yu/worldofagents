// 답글/인용 프론트 계약 (t_62897e88 / 백엔드 t_02f58030) — 요약 정규화·낙관 발췌·자격 판정·서버 행 흡수
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReplyQuote, localReplyQuote, canReplyTo, normalizeServerMessages, REPLY_QUOTE_MAX } from '../../src/lib/chatLogic';
import type { ChatMessage } from '../../src/lib/chatLogic';

const base = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1', role: 'user', content: 'hello', turnIndex: 0, ...over,
});

test('normalizeReplyQuote — 백엔드 스냅샷 {message_id,by,text} 흡수', () => {
  assert.deepEqual(
    normalizeReplyQuote({ message_id: 'a1', by: '김비서', text: '견적서를 먼저 보내도 될까요?' }),
    { message_id: 'a1', by: '김비서', text: '견적서를 먼저 보내도 될까요?' },
  );
});

test('normalizeReplyQuote — 방어: message_id 없으면 undefined, by/text 결측은 빈 문자열 강등', () => {
  assert.equal(normalizeReplyQuote(undefined), undefined);
  assert.equal(normalizeReplyQuote('string'), undefined);
  assert.equal(normalizeReplyQuote({ by: 'x', text: 'y' }), undefined); // message_id 필수
  assert.deepEqual(normalizeReplyQuote({ message_id: 'a1' }), { message_id: 'a1', by: '', text: '' });
});

test('normalizeServerMessages — structured_payload.reply_to와 reply_to_id 동시 흡수 (계약 병기)', () => {
  const [m] = normalizeServerMessages([{
    id: 'u9', turn_index: 9, role: 'user', content: '답글 본문',
    reply_to_id: 'a1',
    structured_payload: { reply_to: { message_id: 'a1', by: '에이전트', text: '원문 발췌' } },
  }]);
  assert.equal(m.replyToId, 'a1');
  assert.deepEqual(m.replyTo, { message_id: 'a1', by: '에이전트', text: '원문 발췌' });
  // 강등/미인용 행: 필드 없으면 undefined (012 미적용 서버에서도 크래시 없음)
  const [plain] = normalizeServerMessages([{ id: 'u10', turn_index: 10, role: 'user', content: '일반 발화' }]);
  assert.equal(plain.replyToId, undefined);
  assert.equal(plain.replyTo, undefined);
  // 형태 불량 payload는 조용히 강등
  const [bad] = normalizeServerMessages([{ id: 'u11', turn_index: 11, role: 'user', content: 'x', structured_payload: { reply_to: 42 } }]);
  assert.equal(bad.replyTo, undefined);
});

test('localReplyQuote — 낙관 요약: 1줄 접기 + 120자 컷 (백엔드 스냅샷과 동일 관례)', () => {
  const source = base({ id: 'a1', role: 'agent', content: '여러\n줄에   걸쳐\t있는\n원문입니다' });
  const q = localReplyQuote(source, '에이전트');
  assert.equal(q.message_id, 'a1');
  assert.equal(q.by, '에이전트');
  assert.equal(q.text, '여러 줄에 걸쳐 있는 원문입니다');
  const long = base({ content: '가'.repeat(REPLY_QUOTE_MAX + 50) });
  assert.equal(localReplyQuote(long, '나').text.length, REPLY_QUOTE_MAX);
});

test('canReplyTo — 미전송/실패 행은 답글 대상 불가(서버 FK 될 수 없음)', () => {
  assert.equal(canReplyTo(base({})), true);
  assert.equal(canReplyTo(base({ status: 'sent' })), true);
  assert.equal(canReplyTo(base({ pending: true, status: 'pending' })), false);
  assert.equal(canReplyTo(base({ status: 'failed' })), false);
});
