// 뉴런 오케스트레이터 테스트 (src/neurons/NeuronOrchestrator.ts)
// neuron-architecture-spec.md — 동적 연결/해제, 신뢰도 클램프, 이벤트 발행
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NeuronOrchestrator } from '../../src/neurons/NeuronOrchestrator';

test('공감 에이뉴런은 생성 시점에 항상 활성화되어 있다', () => {
  const orch = new NeuronOrchestrator();
  assert.equal(orch.getNeuron('empathy')?.active, true);
  assert.equal(orch.getNeuron('empathy')?.confidence, 1);
});

test('뉴런 활성화/비활성화 상태 전환', () => {
  const orch = new NeuronOrchestrator();
  orch.activate('answer', '질문 수신');
  assert.equal(orch.getNeuron('answer')?.active, true);
  orch.deactivate('answer', '완료');
  assert.equal(orch.getNeuron('answer')?.active, false);
});

test('이미 활성화된 뉴런은 중복 활성화하지 않는다 (멱등)', () => {
  const orch = new NeuronOrchestrator();
  orch.activate('visual');
  const before = orch.getAllNeurons().length;
  orch.activate('visual');
  assert.equal(orch.getAllNeurons().length, before);
});

test('신뢰도는 0~1 범위로 클램프된다', () => {
  const orch = new NeuronOrchestrator();
  orch.activate('custom');
  orch.updateConfidence('custom', 1.7);
  assert.equal(orch.getNeuron('custom')?.confidence, 1);
  orch.updateConfidence('custom', -0.5);
  assert.equal(orch.getNeuron('custom')?.confidence, 0);
});

test('getActiveNeurons 는 활성화된 뉴런만 반환한다', () => {
  const orch = new NeuronOrchestrator();
  orch.activate('answer');
  const slugs = orch.getActiveNeurons().map((n) => n.type);
  assert.ok(slugs.includes('empathy'));
  assert.ok(slugs.includes('answer'));
  assert.ok(!slugs.includes('visual'));
});

test('활성화/비활성화 시 이벤트가 발행되고 구독 해제가 동작한다', () => {
  const orch = new NeuronOrchestrator();
  const events: string[] = [];
  const unsubscribe = orch.onEvent((e) => events.push(e.type));

  orch.activate('answer', '이유');
  orch.deactivate('answer');
  assert.deepEqual(events, ['activated', 'deactivated']);

  unsubscribe();
  orch.activate('visual');
  assert.equal(events.length, 2); // 구독 해제 이후 이벤트 미수신
});