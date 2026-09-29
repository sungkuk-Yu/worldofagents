// t_55b7e30c 연속 발화 그룹핑 (백로그③ — 텔레그램/Slack 관습) 단위 검증
// 규칙: 발신자 헤더(이름) 재출력 = ① role 전환 ② agentId 변경(양쪽 있을 때) ③ createdAt 간격 >60초.
// 그 외 같은 발화자 연속 = 그룹 지속(헤더 생략 + 좌 오프셋). 푸터 연출 카드는 streamingHeaderAfter로 판정.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSenderGroups, streamingHeaderAfter, normalizeServerMessages, SENDER_GROUP_WINDOW_MS } from '../../src/lib/chatLogic';
import type { ChatMessage } from '../../src/lib/chatLogic';

const T0 = '2026-09-29T12:00:00Z';
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000).toISOString();
const msg = (id: string, role: ChatMessage['role'], extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role, content: id, turnIndex: 0, createdAt: T0, ...extra });

test('창 경계 — 첫 그룹 시작 / 60초 창 내 무명 / 경계 60초 포함 / 인접 간격 초과 시 재출력', () => {
  const flags = buildSenderGroups([
    msg('a', 'agent'),
    msg('b', 'agent', { createdAt: at(SENDER_GROUP_WINDOW_MS / 1000) }),      // 인접 간격 정확히 60초 = 경계 포함 → 같은 그룹
    msg('c', 'agent', { createdAt: at(SENDER_GROUP_WINDOW_MS / 1000 * 2 + 1) }), // b로부터 61초 → 그룹 전환
  ]);
  assert.deepEqual(flags.map((f) => [f.id, f.header, f.continuation]), [
    ['a', true, false], ['b', false, true], ['c', true, false],
  ]);
});

test('user↔agent 전환 시 헤더 재출력; 사용자 카드는 header 플래그와 무관(화면이 항상 노출)', () => {
  const flags = buildSenderGroups([
    msg('u1', 'user'), msg('a1', 'agent'), msg('a2', 'agent'),
    msg('u2', 'user', { createdAt: at(1) }), msg('a3', 'agent', { createdAt: at(2) }),
  ]);
  assert.equal(flags[1].header, true);  // user→agent 전환
  assert.equal(flags[2].header, false); // 같은 발화자 연속
  assert.equal(flags[3].header, false); // agent→user (role=user은 헤더 플래그 미사용 → false)
  assert.equal(flags[4].header, true);  // user→agent 재전환
});

test('agentId 분기 — 릴레이/다중 에이전트: id 다르면 60초 내라도 새 그룹, 한쪽 결측이면 단일 발화자 취급', () => {
  const flags = buildSenderGroups([
    msg('a', 'agent', { agentId: 'x' }),
    msg('b', 'agent', { agentId: 'y' }),          // 다른 에이전트 → 재출력
    msg('c', 'agent', { agentId: 'y' }),          // 연속 → 생략
    msg('d', 'agent'),                            // id 결측(미전환 환경) → 연속 취급
    msg('e', 'agent', { agentId: 'y' }),          // 앞 결측 = 비교 불가 → 연속 취급
  ]);
  assert.deepEqual(flags.map((f) => f.header), [true, true, false, false, false]);
});

test('createdAt 결측(낙관행/WS 미포함)은 그룹 유지 — 시간 창 판정 스킵', () => {
  const flags = buildSenderGroups([
    msg('a', 'agent'), msg('b', 'agent', { createdAt: undefined }), msg('c', 'agent', { createdAt: undefined }),
  ]);
  assert.deepEqual(flags.map((f) => f.header), [true, false, false]);
});

test('streamingHeaderAfter — 꼬리 에이전트+창 내=지속(생략), 없음/user/창 초과=노출', () => {
  const now = Date.parse(T0);
  assert.equal(streamingHeaderAfter(undefined, now), true);                       // 빈 목록
  assert.equal(streamingHeaderAfter(msg('u', 'user'), now), true);                // 꼬리가 user → 새 그룹
  assert.equal(streamingHeaderAfter(msg('a', 'agent'), now), false);              // 창 내 지속 (T0 = now)
  assert.equal(streamingHeaderAfter(msg('a', 'agent', { createdAt: at(-61) }), now), true); // 꼬리가 61초 전 → 창 초과
  assert.equal(streamingHeaderAfter(msg('a', 'agent', { createdAt: '오류' }), now), true); // 파싱 불가 → 안전측 노출
});

test('normalizeServerMessages — agent_id/agent_name 선행 계약 수신 (미송신 시 undefined)', () => {
  const rows = [
    { id: '1', turn_index: 1, role: 'agent', content: 'hi', agent_id: 'ag-1', agent_name: '김비서' },
    { id: '2', turn_index: 2, role: 'agent', content: 'yo' },
  ];
  const [a, b] = normalizeServerMessages(rows);
  assert.equal(a.agentId, 'ag-1');
  assert.equal(a.senderName, '김비서');
  assert.equal(b.agentId, undefined);
  assert.equal(b.senderName, undefined);
});

test('전체 시나리오 — 답변 연쇄(empathy+answer)에서 이름 1회, 질문 재도착 시 재출력', () => {
  const flags = buildSenderGroups([
    msg('u', 'user'),
    msg('e', 'agent', { sourceNeuron: 'empathy' }),
    msg('a', 'agent', { sourceNeuron: 'answer' }),
    msg('u2', 'user'),
    msg('e2', 'agent', { sourceNeuron: 'empathy' }),
    msg('a2', 'agent', { sourceNeuron: 'answer' }),
  ]);
  const named = flags.filter((f) => f.header).map((f) => f.id);
  assert.deepEqual(named, ['e', 'e2']); // 연쇄당 첫 카드만 이름 — 무명 연속은 continuation 오프셋
});
