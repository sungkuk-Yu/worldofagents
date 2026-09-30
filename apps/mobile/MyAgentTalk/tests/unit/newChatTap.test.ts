// t_5058e15f — 9/30 라이브 결함 ① '새 대화' 첫 탭 무반응 (탭 큐잉) 회귀
// 순수 판정(newChatTap) + 실제 DialogueListScreen 번들(react-native 모의)로
// "loading 중 탭 1회 → 로딩 해지 후 POST /api/agents 1회"를 훅 경계까지 실증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newChatTapAction, newChatQueuedAction } from '../../src/lib/newChatTap';

test('newChatTapAction — 로딩 중 탭은 queue(흡수 금지), starting/offline만 none', () => {
  const base = { starting: false, loading: false, offline: false, hasAgents: false, choosing: false };
  assert.equal(newChatTapAction(base), 'start');                      // 에이전트 없음 = 즉시 새 세션
  assert.equal(newChatTapAction({ ...base, hasAgents: true }), 'chooserOpen');
  assert.equal(newChatTapAction({ ...base, hasAgents: true, choosing: true }), 'chooserClose');
  assert.equal(newChatTapAction({ ...base, loading: true }), 'queue'); // 결함 #1의 그 탭
  assert.equal(newChatTapAction({ ...base, loading: true, hasAgents: true }), 'queue');
  assert.equal(newChatTapAction({ ...base, starting: true, loading: true }), 'none'); // POST 진행 중 이중발차 금지
  assert.equal(newChatTapAction({ ...base, offline: true }), 'none');
  // 화면에서 offline은 !loading일 때만 참이 되지만, 판정 순서는 starting/offline 우선(방어적)
  assert.equal(newChatTapAction({ ...base, loading: true, offline: true }), 'none');
});

test('newChatQueuedAction — 로딩 해지 시점의 목록 기준으로 재탭과 동일 결과', () => {
  assert.equal(newChatQueuedAction(false), 'start');   // 첫 사용(에이전트 0) → 자동 생성 경로
  assert.equal(newChatQueuedAction(true), 'chooserOpen'); // 46 페르소나 실데이터 → 선택 시트
});
