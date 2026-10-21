// DecisionInbox.tsx — 결정 대기 목록 (t_2de069f3)
// QueueBacklog 패턴 재사용: 패널 섹션 + 모달 상세

import React, { useState, useCallback } from 'react';
import { View, TouchableOpacity, Modal, ScrollView, TextInput, Platform, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { DecisionItem } from '../lib/api';
import { api } from '../lib/api';
import { colors, radii, spacing, typography } from '../theme';

interface DecisionInboxProps {
  sessionId: string;
  decisions: DecisionItem[];
  /** 원본 메시지 점프 콜백 */
  onJumpToMessage?: (turnIndex: number) => void;
  /** 답변 제출 성공 후 부모 상태 갱신 (useChatSession decisions 단일 원천) */
  onAnswered: (decisionId: string) => void;
}

export function DecisionInbox({ sessionId, decisions, onJumpToMessage, onAnswered }: DecisionInboxProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pending = decisions.filter((d) => d.status === 'pending');
  const selected = pending.find((d) => d.id === selectedId);

  const handleSubmit = useCallback(async () => {
    if (!selectedId || !answer.trim()) return;
    setSubmitting(true);
    try {
      await api.answerDecision(selectedId, answer.trim());
      onAnswered(selectedId);
      setSelectedId(null);
      setAnswer('');
    } catch (err) {
      console.error('결정 답변 실패', err);
      // TODO: 에러 토스트
    } finally {
      setSubmitting(false);
    }
  }, [selectedId, answer, sessionId, onAnswered]);

  const handleJump = useCallback(() => {
    if (selected?.source_turn_index !== undefined) {
      onJumpToMessage?.(selected.source_turn_index);
      setSelectedId(null);
    }
  }, [selected, onJumpToMessage]);

  if (pending.length === 0) {
    return (
      <View style={styles.empty}>
        <Text variant="bodyMedium" style={{ color: colors.text2 }}>
          {t('decisions.empty')}
        </Text>
      </View>
    );
  }

  return (
    <View>
      {pending.map((item, idx) => (
        <Pressable
          key={item.id}
          onPress={() => setSelectedId(item.id)}
          style={[
            styles.item,
            idx < pending.length - 1 && styles.itemBorder,
          ]}
        >
          <Text variant="bodyMedium" numberOfLines={2} style={styles.question}>
            {item.question}
          </Text>
          <Text variant="bodySmall" style={styles.timestamp}>
            {new Date(item.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </Pressable>
      ))}

      <Modal
        visible={!!selectedId}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedId(null)}
      >
        <Pressable
          onPress={() => setSelectedId(null)}
          style={styles.overlay}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <Text variant="titleMedium" style={styles.modalTitle}>
                  {t('decisions.title')}
                </Text>
                <Pressable onPress={() => setSelectedId(null)}>
                  <Text variant="bodyLarge" style={{ color: colors.accent }}>
                    {t('common.close')}
                  </Text>
                </Pressable>
              </View>

              <ScrollView style={styles.modalBody}>
                <Text variant="bodyMedium" style={styles.modalQuestion}>
                  {selected?.question}
                </Text>

                {selected?.source_turn_index !== undefined && (
                  <Pressable onPress={handleJump} style={styles.jumpButton}>
                    <Text variant="bodyMedium" style={{ color: colors.accent }}>
                      {t('decisions.jumpToOriginal')}
                    </Text>
                  </Pressable>
                )}

                <TextInput
                  value={answer}
                  onChangeText={setAnswer}
                  placeholder={t('decisions.answerPlaceholder')}
                  placeholderTextColor={colors.text2}
                  multiline
                  numberOfLines={4}
                  style={styles.input}
                />

                <Pressable
                  onPress={handleSubmit}
                  disabled={!answer.trim() || submitting}
                  style={[
                    styles.submitButton,
                    (!answer.trim() || submitting) && styles.submitButtonDisabled,
                  ]}
                >
                  <Text variant="bodyLarge" style={styles.submitText}>
                    {submitting ? t('common.submitting') : t('decisions.submit')}
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp3,
  },
  item: {
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp3,
  },
  itemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  question: {
    color: colors.text1,
  },
  timestamp: {
    color: colors.text2,
    marginTop: spacing.sp1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '80%',
  },
  modalHeader: {
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    color: colors.text1,
  },
  modalBody: {
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp3,
  },
  modalQuestion: {
    color: colors.text1,
    marginBottom: spacing.sp4,
  },
  jumpButton: {
    paddingVertical: spacing.sp2,
    paddingHorizontal: spacing.sp3,
    backgroundColor: colors.surfaceRaise,
    borderRadius: radii.sm,
    marginBottom: spacing.sp4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
    fontSize: typography.body.fontSize,
    color: colors.text1,
    backgroundColor: colors.bg,
    minHeight: Platform.OS === 'web' ? 80 : undefined,
    maxHeight: 200,
    textAlignVertical: 'top',
  },
  submitButton: {
    marginTop: spacing.sp3,
    paddingVertical: spacing.sp3,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: colors.border,
  },
  submitText: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
});
