// 비서실 릴레이 자막 프론트 커튼 (t_961ca593 Phase B) — relay.updated 순수 로직
// 서버 RelayCurtain(t_583d9fed)과 동일 규칙(단조·dedup)의 수신 측 보존 + malformed 차단 + 런 종료 정리.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyRelayEvent, clearRelayOnRunEnd, normalizeRelayEvent, RELAY_ORDER, RelayCaption,
} from '../../src/lib/chatLogic';

const frame = (over: Record<string, unknown> = {}) => ({
  type: 'relay.updated', session_id: 's', run_id: 'r1', stage: 'briefing', quip: '접수했어요', seq: 1, ...over,
});

test('normalizeRelayEvent — 계약 프레임과 malformed 차단', () => {
  assert.deepEqual(normalizeRelayEvent(frame()), { runId: 'r1', stage: 'briefing', quip: '접수했어요' });
  assert.equal(normalizeRelayEvent({ ...frame(), type: 'queue.updated' }), null);
  assert.equal(normalizeRelayEvent({ ...frame(), stage: 'hacking' }), null, 'RELAY_ORDER 밖 stage 차단(i18n 키 유실 방지)');
  assert.equal(normalizeRelayEvent({ ...frame(), stage: undefined }), null);
  assert.equal(normalizeRelayEvent({ ...frame(), run_id: 42 }), null);
  // quip이 빈 문자열/누락이어도 자막 자체는 유효(i18n 우선 렌더 — 폴백만 소실)
  assert.deepEqual(normalizeRelayEvent({ ...frame(), quip: '' }), { runId: 'r1', stage: 'briefing', quip: null });
});

test('applyRelayEvent — 스테이지 진행은 교체, 역주행·중복·이전 run 잔영은 무시 (멱등)', () => {
  let cur: RelayCaption | null = applyRelayEvent(null, frame());
  assert.equal(cur?.stage, 'briefing');
  cur = applyRelayEvent(cur, frame({ stage: 'research', seq: 2 }));
  assert.equal(cur?.stage, 'research');
  // 동일 stage 재도착(eventlog 재생 이중 포함) → prev 동일성(리렌더 트리거 없음)
  assert.equal(applyRelayEvent(cur, frame({ stage: 'research', seq: 2 })), cur);
  // 역주행 → 무시
  assert.equal(applyRelayEvent(cur, frame({ stage: 'briefing' })), cur);
  // 새 run의 낮은 stage는 교체 (이전 run 잔영으로 새 자막을 막지 않는다)
  const next = applyRelayEvent(cur, frame({ run_id: 'r2', stage: 'briefing' }));
  assert.equal(next?.runId, 'r2');
  // done까지 순주행
  let done: RelayCaption | null = next;
  for (const stage of ['research', 'drafting', 'wrapping', 'done']) done = applyRelayEvent(done, frame({ run_id: 'r2', stage }));
  assert.equal(done?.stage, 'done');
  assert.equal(RELAY_ORDER[RELAY_ORDER.length - 1], 'done');
});

test('clearRelayOnRunEnd — 같은 run의 종료만 정리, 남의 run 종료는 무해', () => {
  const cap = applyRelayEvent(null, frame({ stage: 'research' }));
  assert.equal(clearRelayOnRunEnd(cap, 'r1'), null);
  assert.equal(clearRelayOnRunEnd(cap, 'other-run'), cap, '다른 run_id 종료는 현 자막 유지');
  assert.equal(clearRelayOnRunEnd(cap, undefined), null, 'run_id 없는 종료는 관행상 현 자막 정리');
  assert.equal(clearRelayOnRunEnd(null, 'r1'), null, '이미 없으면 멱등');
});

test('i18n — relay.<stage> 키가 양 언어·전 stage에 존재하고 보간 변수가 없다 (quir 파손 방지)', () => {
  const flatten = (data: Record<string, unknown>, prefix = ''): [string, string][] =>
    Object.entries(data).flatMap(([key, value]) =>
      typeof value === 'string' ? [[`${prefix}${key}`, value] as [string, string]]
        : flatten(value as Record<string, unknown>, `${prefix}${key}.`));
  for (const file of ['ko', 'en']) {
    const dict = Object.fromEntries(flatten(JSON.parse(readFileSync(`src/i18n/locales/${file}.json`, 'utf8'))));
    for (const stage of RELAY_ORDER) {
      const key = `relay.${stage}`;
      assert.ok(dict[key]?.trim(), `${file}: ${key} 누락`);
      assert.equal(dict[key].includes('{{'), false, `${file}: ${key}는 보간 변수 없는 완성 문구여야 함(t_b2b86cd6)`);
      // 한글 로케일에 영문 코드/기술어 노출 금지 — en 파일은 영어 문구가 정상이라 면제
      if (file === 'ko') assert.equal(/[A-Za-z]{6,}/.test(dict[key]), false, `${file}: ${key} 영문 노출 금지`);
    }
  }
});
