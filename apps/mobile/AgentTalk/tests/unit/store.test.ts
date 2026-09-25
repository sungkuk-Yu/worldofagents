// 전역 스토어 테스트 (src/store/index.ts) — Phase 1 상태 관리
// 트랜스크립트 upsert / 세그먼트 히스토리 인덱스 산술 / 경계 클램프 검증
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useStore, getState, setState } from '../../src/store';
import type { SegmentHistoryEntry } from '../../src/types';

function makeSeg(id: string, type: SegmentHistoryEntry['type']): SegmentHistoryEntry {
  return { id, type, label: id };
}

beforeEach(() => {
  // 테스트 격리 — 스토어 초기 상태로 재설정
  setState({
    dialogues: [],
    transcripts: [],
    segmentHistory: [],
    activeSegmentIndex: -1,
    isRecording: false,
  });
});

test('스토어 API 서피스가 노출된다 (useSyncExternalStore 기반 React 훅 + 명령형 get/set)', () => {
  assert.equal(typeof useStore, 'function');
  assert.equal(typeof getState, 'function');
  assert.equal(typeof setState, 'function');
  assert.equal(getState().connectionStatus, 'idle');
});

test('addTranscript 는 최대 200개로 제한한다 (링 버퍼)', () => {
  for (let i = 0; i < 250; i++) {
    getState().addTranscript({
      id: `t-${i}`,
      text: `m${i}`,
      isFinal: true,
      speaker: 'user',
      timestamp: new Date(),
    });
  }
  assert.equal(getState().transcripts.length, 200);
  assert.equal(getState().transcripts[0].id, 't-50'); // 오래된 것부터 순환 제거
});

test('upsertTranscript: final 트랜스크립트가 동일 텍스트 partial 을 대체한다', () => {
  getState().upsertTranscript({
    id: 'p1',
    text: '날씨 알려줘',
    isFinal: false,
    speaker: 'user',
    timestamp: new Date(),
  });
  assert.equal(getState().transcripts.length, 1);
  getState().upsertTranscript({
    id: 'f1',
    text: '날씨 알려줘',
    isFinal: true,
    speaker: 'user',
    timestamp: new Date(),
  });
  assert.equal(getState().transcripts.length, 1);
  assert.equal(getState().transcripts[0].isFinal, true);
  assert.equal(getState().transcripts[0].id, 'f1');
});

test('addSegment: 세그먼트 추가 시 activeSegmentIndex 가 마지막으로 이동', () => {
  getState().addSegment(makeSeg('s1', 'information'));
  getState().addSegment(makeSeg('s2', 'data'));
  assert.equal(getState().segmentHistory.length, 2);
  assert.equal(getState().activeSegmentIndex, 1);
});

test('prev/nextSegment: 인덱스 경계에서 클램프 (0 미만/최대 초과 금지)', () => {
  getState().setSegmentHistory([makeSeg('s1', 'information'), makeSeg('s2', 'data')]);
  getState().prevSegment(); // 1 → 0
  assert.equal(getState().activeSegmentIndex, 0);
  getState().prevSegment(); // 0에서 더 못 감
  assert.equal(getState().activeSegmentIndex, 0);

  getState().nextSegment(); // 0 → 1
  getState().nextSegment(); // 1에서 더 못 감
  assert.equal(getState().activeSegmentIndex, 1);
});

test('selectSegment: 범위 밖 인덱스 요청을 클램프한다', () => {
  getState().setSegmentHistory([
    makeSeg('s1', 'information'),
    makeSeg('s2', 'data'),
    makeSeg('s3', 'file'),
  ]);
  getState().selectSegment(99);
  assert.equal(getState().activeSegmentIndex, 2);
  getState().selectSegment(-5);
  assert.equal(getState().activeSegmentIndex, 0);
});

test('removeSegment: 현재 세그먼트 삭제 시 이전 인덱스로 안정 이동', () => {
  getState().setSegmentHistory([
    makeSeg('s1', 'information'),
    makeSeg('s2', 'data'),
    makeSeg('s3', 'file'),
  ]);
  getState().selectSegment(2); // file
  getState().removeSegment(2); // file 삭제 → data(1) 유지
  assert.equal(getState().segmentHistory.length, 2);
  assert.equal(getState().activeSegmentIndex, 1);
});

test('removeSegment: 현재 이전 세그먼트 삭제 시 인덱스 보정', () => {
  getState().setSegmentHistory([
    makeSeg('s1', 'information'),
    makeSeg('s2', 'data'),
    makeSeg('s3', 'file'),
  ]);
  getState().selectSegment(2);
  getState().removeSegment(0); // 정보 삭제 → file 인덱스 2→1 보정
  assert.equal(getState().segmentHistory.length, 2);
  assert.equal(getState().activeSegmentIndex, 1);
});

test('removeSegment: 마지막 하나는 삭제할 수 없다 (보호)', () => {
  getState().setSegmentHistory([makeSeg('s1', 'information')]);
  getState().removeSegment(0);
  assert.equal(getState().segmentHistory.length, 1);
});

test('setRecording: 녹음 상태 토글 반영', () => {
  getState().setRecording(true);
  assert.equal(getState().isRecording, true);
  setState({ isRecording: false });
  assert.equal(getState().isRecording, false);
});