// 답변 대기 모달 (t_363c0faa — 대표님 9/28 09:07 "그런건 미해결 건으로 계속 알려줘야지… 상단에 답변대기 버튼을")
// 답글 목록 모달(ThreadListModal, t_2f45ccb1) 관례 재사용: fade backdrop + 하단 시트 + 행(발췌+배지).
// 행 = 에이전트가 회신을 요구한 문장 발췌(excerpt) + 종류 배지(예/아니오 또는 주관식) + 카드 점프 딕링크.
// 빠른 회신: yesno·both 행 안에 예/아니오 칩 → 탭 시 '예'/'아니오' 발화 전송(t_043539ff 조이스틱 예/아니오
// 대응 — 발화 문구 '예'/'아니오' 동일, 백엔드 confirm 게이트 t_135a19b5가 수신). freeform은 행 탭→카드 점프+입력창 개방.
// 실시간: WS reply.pending.updated 스냅샷(카운트 0이면 모달 자동 닫힘 — 해소된 항목을 붙들지 않는다).
// 계층: 상태는 useChatSession의 단일 pendingReplies 원천만 쓴다(이중 상태원천 금지).
import React, { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { formatNumber } from '../i18n/format';
import type { PendingReplyItem } from '../lib/chatLogic';

interface Props {
  visible: boolean;
  items: PendingReplyItem[];
  onClose: () => void;
  /** 예/아니오 발화 전송 ('예' | '아니오') — 화면(send)이 소유, 1회 소모 후 모달 유지(해소 스냅샷이 닫음) */
  onQuickReply: (messageId: string, utterance: string) => void;
  /** freeform 행 탭 = 카드 점프 + 입력창 개방 */
  onJumpCompose: (messageId: string) => void;
}

export default function PendingReplyModal({ visible, items, onClose, onQuickReply, onJumpCompose }: Props) {
  const { t, i18n } = useTranslation();
  // 해소(count 0)되면 열려 있던 모달은 스스로 닫힌다 — 미해결 목록이 빈 채로 떠 있으면 안 된다.
  useEffect(() => { if (visible && items.length === 0) onClose(); }, [visible, items.length, onClose]);
  // 1회 소모 (카드 요구 3): 발화 전송한 행의 칩은 재탭 불가 — 중복 발화 스팸 방지.
  // 리셋 없음이 정상: 해소된 행은 스냅샷에서 사라지고(칩과 운명 공유), 실패 복구는 입력창 원문 경로가 담당.
  const [consumed, setConsumed] = React.useState<Set<string>>(() => new Set());
  const reply = (messageId: string, utterance: string) => {
    if (consumed.has(messageId)) return;
    setConsumed((prev) => new Set(prev).add(messageId));
    onQuickReply(messageId, utterance);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} testID="pending-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal testID="pending-modal">
          <View style={styles.header}>
            <Text style={styles.title}>{t('pending.title', { countText: formatNumber(items.length, i18n.language) })}</Text>
            <Pressable onPress={onClose} accessibilityLabel={t('common.close')} testID="pending-close" style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {items.map((it) => {
              const showYesNo = it.replyKind === 'yesno' || it.replyKind === 'both';
              return (
                <Pressable
                  key={it.messageId}
                  onPress={() => { onClose(); onJumpCompose(it.messageId); }}
                  testID={`pending-row-${it.messageId}`}
                  accessibilityRole="button"
                  accessibilityLabel={it.excerpt}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHover }]}
                >
                  <View style={styles.rowBody}>
                    <Text numberOfLines={2} style={styles.rowText}>{it.excerpt || t('pending.noExcerpt')}</Text>
                    <View style={styles.kindRow}>
                      <View style={styles.kindBadge} testID={`pending-kind-${it.messageId}`}>
                        <Text style={styles.kindText}>{t(it.replyKind === 'freeform' ? 'pending.kindFreeform' : 'pending.kindYesNo')}</Text>
                      </View>
                    </View>
                  </View>
                  {/* 행 탭(카드 점프)과 분리된 발화 칩 — stopPropagation 불요: 중첩 Pressable이 부모 onPress를 가로채지 않도록
                      이 칩들만 Pressable로 감싼다 (RN 중첩 터치 규격). */}
                  {showYesNo && (
                    <View style={styles.chipCol}>
                      <Pressable accessibilityRole="button" onPress={() => reply(it.messageId, t('joystick.actions.yes'))}
                        testID={`pending-yes-${it.messageId}`} style={({ pressed }) => [styles.replyChip, styles.replyChipYes, (pressed || consumed.has(it.messageId)) && { opacity: 0.7 }]}>
                        <Text style={styles.replyChipYesText}>{t('joystick.actions.yes')}</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" onPress={() => reply(it.messageId, t('joystick.actions.no'))}
                        testID={`pending-no-${it.messageId}`} style={({ pressed }) => [styles.replyChip, (pressed || consumed.has(it.messageId)) && { opacity: 0.7 }]}>
                        <Text style={styles.replyChipText}>{t('joystick.actions.no')}</Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  // ThreadListModal과 동일 시트 규격 — 관례 재사용 (t_2f45ccb1)
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '70%', paddingBottom: spacing.sp4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sp4, paddingTop: spacing.sp4, paddingBottom: spacing.sp2 },
  title: { ...typography.title2, color: colors.text1 },
  closeBtn: { padding: spacing.sp1 },
  closeText: { ...typography.title2, color: colors.text3 },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: spacing.sp2, paddingBottom: spacing.sp2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sp2, paddingVertical: spacing.sp2 + 2, paddingHorizontal: spacing.sp2, borderRadius: radii.md },
  rowBody: { flex: 1, minWidth: 0, gap: spacing.sp1 },
  rowText: { ...typography.body, color: colors.text1 },
  kindRow: { flexDirection: 'row', alignItems: 'center' },
  kindBadge: { paddingHorizontal: spacing.sp2, paddingVertical: 2, borderRadius: radii.sm, backgroundColor: colors.accentTint },
  kindText: { ...typography.micro, color: colors.accent },
  chipCol: { gap: spacing.sp1, flexShrink: 0 },
  replyChip: { paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp1, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  // 예는 강조(액센트 테두리+글자), 아니오는 중립 — 발화 구분 1차 cues는 라벨 자체(색맹 대비 텍스트)
  replyChipYes: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  replyChipText: { ...typography.caption, color: colors.text2 },
  replyChipYesText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
});
