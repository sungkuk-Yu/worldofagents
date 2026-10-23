import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import type { DecisionItem } from '../lib/api';

interface DecisionCardProps {
  item: DecisionItem;
  onUpdate: (id: string, status: 'answered' | 'deferred' | 'dismissed', answer?: string) => void;
  /** 원본 메시지 점프 (t_2de069f3) — 질문 탭 시 발화 위치로 스크롤 */
  onJump?: () => void;
}

/**
 * 결정 인박스 개별 카드 (t_2de069f3)
 * - pending 항목: 질문 + 답변 입력창 + 답변/보류/해제 버튼
 * - answered/deferred/dismissed: 읽기 전용 표시
 */
export function DecisionCard({ item, onUpdate, onJump }: DecisionCardProps) {
  const [answer, setAnswer] = useState('');

  const isPending = item.status === 'pending';
  const bgColor = item.status === 'answered' ? '#e8f5e9' : item.status === 'dismissed' ? '#f5f5f5' : '#fff3e0';

  return (
    <View style={[styles.card, { backgroundColor: bgColor }]}>
      {/* 에이전트 질문 — onJump 있으면 탭해 원본 메시지로 점프 */}
      {onJump ? (
        <Pressable onPress={onJump}>
          <Text style={styles.question}>{item.question}</Text>
        </Pressable>
      ) : (
        <Text style={styles.question}>{item.question}</Text>
      )}
      
      {/* 답변 입력 (pending만) */}
      {isPending && (
        <TextInput
          style={styles.input}
          value={answer}
          onChangeText={setAnswer}
          placeholder="답변 입력..."
          multiline
          numberOfLines={2}
        />
      )}

      {/* 유저 답변 표시 (answered) */}
      {item.status === 'answered' && item.answer && (
        <Text style={styles.answerText}>답변: {item.answer}</Text>
      )}

      {/* 액션 버튼 (pending만) */}
      {isPending && (
        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.btnAnswer]}
            onPress={() => onUpdate(item.id, 'answered', answer.trim())}
            disabled={!answer.trim()}
          >
            <Text style={styles.btnText}>답변</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnDefer]}
            onPress={() => onUpdate(item.id, 'deferred')}
          >
            <Text style={styles.btnText}>보류</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnDismiss]}
            onPress={() => onUpdate(item.id, 'dismissed')}
          >
            <Text style={styles.btnText}>해제</Text>
          </Pressable>
        </View>
      )}

      {/* 상태 배지 (non-pending) */}
      {!isPending && (
        <Text style={styles.statusBadge}>
          {item.status === 'answered' ? '✓ 답변 완료' : item.status === 'deferred' ? '⏸ 보류됨' : '✕ 해제됨'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  question: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    backgroundColor: '#fff',
    marginBottom: 12,
    minHeight: 60,
  },
  answerText: {
    fontSize: 15,
    color: '#555',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnAnswer: {
    backgroundColor: '#4caf50',
  },
  btnDefer: {
    backgroundColor: '#ff9800',
  },
  btnDismiss: {
    backgroundColor: '#9e9e9e',
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  statusBadge: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
});
