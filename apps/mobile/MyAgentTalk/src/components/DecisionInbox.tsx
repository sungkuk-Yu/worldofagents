import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { DecisionCard } from './DecisionCard';
import type { DecisionItem } from '../lib/chatLogic';

interface DecisionInboxProps {
  decisions: DecisionItem[];
  onUpdate: (id: string, status: 'answered' | 'deferred' | 'dismissed', answer?: string) => void;
  /** 원본 메시지 점프 (t_2de069f3) — sourceMessageId가 있는 카드만 탭 가능 */
  onJump?: (sourceMessageId: string) => void;
}

/**
 * 결정 인박스 스트립 (t_2de069f3)
 * - decisions 배열 렌더 (pending 우선 정렬)
 * - 빈 배열이면 렌더 없음 (호출자가 decisions.length 체크)
 */
export function DecisionInbox({ decisions, onUpdate, onJump }: DecisionInboxProps) {
  // pending 우선 정렬
  const sorted = [...decisions].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return 0;
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>결정 요청</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {decisions.filter((d) => d.status === 'pending').length}
          </Text>
        </View>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {sorted.map((item) => (
          <DecisionCard
            key={item.id}
            item={item}
            onUpdate={onUpdate}
            onJump={onJump && item.sourceMessageId ? () => onJump(item.sourceMessageId!) : undefined}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f9f9f9',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginRight: 8,
  },
  badge: {
    backgroundColor: '#ff5722',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  scroll: {
    maxHeight: 400,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});
