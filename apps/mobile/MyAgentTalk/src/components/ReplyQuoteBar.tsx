// 답글 인용 UI (t_62897e88 백로그④ — 텔레그램 관습)
//  1) ReplyDraftBar: 발송 대기 인용 바 — 입력바 위에 원문 1줄 + 취소(✕). 취소 시 발행 중단, 인용 해제.
//  2) ReplyQuoteLine: 발송된 카드 상단 원문 인용 라인 — message.structured_payload.reply_to 스냅샷
//     (백엔드 t_02f58030: {message_id, by, text≤120, 발행 시점 확정 — 원문 삭제 후에도 남는다).
//     탭 = 원문 카드 점프+하이라이트 (기존 strip.requestJump scrollToIndex 2.6초 패턴 재활용, 화면 주입).
// 렌더 데이터는 낙관(로컬 요약)과 서버 스냅샷이 동일 형태(ReplyQuote)라 분기 없음.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { ReplyQuote } from '../types';
import { colors, radii, spacing, typography } from '../theme';
import { CloseIcon } from './Icon';

/** 발송 대기 인용 바 — 제출 전 취소 가능 (텔레그램: 입력바 위 원문 인용 바) */
export function ReplyDraftBar({ quote, onCancel }: { quote: ReplyQuote; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.draftBar} testID="reply-draft-bar">
      <View style={styles.draftAccent} />
      <View style={styles.draftBody}>
        <Text style={styles.draftBy} numberOfLines={1}>{t('chat.replyQuoting', { name: quote.by })}</Text>
        <Text style={styles.draftText} numberOfLines={1}>{quote.text}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('chat.cancelQuote')} onPress={onCancel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="reply-cancel" style={styles.cancelBtn}>
        <CloseIcon size={16} color={colors.text2} />
      </Pressable>
    </View>
  );
}

/** 카드 상단 인용 라인 — 발송된 답글의 원문 1줄 요약. 탭 시 원문으로 스크롤(하이라이트 포함). */
export function ReplyQuoteLine({ quote, onJump, testIdSuffix }: { quote: ReplyQuote; onJump: (messageId: string) => void; testIdSuffix?: string }) {
  const { t } = useTranslation();
  const targetId = quote.message_id;
  return (
    <Pressable accessibilityRole="button" onPress={() => onJump(targetId)} testID={testIdSuffix ? `reply-quote-${targetId}-${testIdSuffix}` : `reply-quote-${targetId}`}
      style={({ pressed }) => [styles.quoteLine, pressed && { backgroundColor: colors.surfaceHover }]}>
      <View style={styles.quoteBody}>
        <Text style={styles.quoteBy} numberOfLines={1}>{quote.by || t('common.agent')}</Text>
        <Text style={styles.quoteText} numberOfLines={1}>{quote.text}</Text>
      </View>
      <Text accessibilityRole="button" style={styles.quoteReplyLabel}>{t('queue.replyAction')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  draftBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, backgroundColor: colors.surfaceRaise, borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, paddingVertical: spacing.sp2, paddingLeft: spacing.sp2, paddingRight: spacing.sp3, marginHorizontal: spacing.sp3 },
  draftAccent: { width: 3, alignSelf: 'stretch', borderRadius: radii.full, backgroundColor: colors.accent },
  draftBody: { flex: 1, minWidth: 0 },
  draftBy: { ...typography.micro, color: colors.accent, fontWeight: '700' },
  draftText: { ...typography.caption, color: colors.text2 },
  cancelBtn: { padding: spacing.sp1 },
  quoteLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, backgroundColor: colors.surfaceRaise, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: radii.sm, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, marginBottom: spacing.sp1, minWidth: 0 },
  quoteAccent: { display: 'none' },
  quoteBody: { flex: 1, minWidth: 0 },
  quoteBy: { ...typography.micro, color: colors.accent, fontWeight: '700' },
  quoteText: { ...typography.caption, color: colors.text2 },
  quoteReplyLabel: { ...typography.micro, color: colors.text3 },
});
