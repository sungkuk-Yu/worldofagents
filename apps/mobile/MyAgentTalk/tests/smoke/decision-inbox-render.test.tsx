/**
 * 결정 인박스 렌더 스모크 (t_2de069f3)
 * - DecisionInbox/DecisionCard 마운트 검증
 * - DOM 텍스트 read-back
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from '@testing-library/react-native';
import { DecisionInbox } from '../../src/components/DecisionInbox';
import type { DecisionItem } from '../../src/lib/chatLogic';

test('DecisionInbox 마운트 — 헤더 "결정 요청" + pending 배지 표시', () => {
  const decisions: DecisionItem[] = [
    {
      id: 'd1',
      threadId: 'thread1',
      question: '프로젝트 A를 승인하시겠습니까?',
      agentId: 'pm-bot',
      status: 'pending',
      sourceMessageId: 'm1',
      createdAt: '2026-10-21T15:00:00Z',
    },
    {
      id: 'd2',
      threadId: 'thread1',
      question: '예산 B를 확정하시겠습니까?',
      agentId: 'finance-bot',
      status: 'answered',
      sourceMessageId: 'm2',
      createdAt: '2026-10-21T14:00:00Z',
      answer: '승인',
    },
  ];

  const { getByText } = render(
    <DecisionInbox
      decisions={decisions}
      onUpdate={() => {}}
    />
  );

  // 헤더 텍스트 존재
  const title = getByText('결정 요청');
  assert.ok(title, '헤더 "결정 요청" 렌더 확인');

  // pending 배지 (1개)
  const badge = getByText('1');
  assert.ok(badge, 'pending 배지 1 표시');
});

test('DecisionCard 마운트 — 질문 텍스트 표시', () => {
  const { getByText } = render(
    <DecisionInbox
      decisions={[
        {
          id: 'd3',
          threadId: 'thread2',
          question: '테스트 질문입니다',
          agentId: 'test-agent',
          status: 'pending',
          sourceMessageId: 'm3',
          createdAt: '2026-10-21T15:00:00Z',
        },
      ]}
      onUpdate={() => {}}
    />
  );

  // 카드 내 질문 텍스트
  const question = getByText('테스트 질문입니다');
  assert.ok(question, '카드 질문 텍스트 렌더 확인');
});
