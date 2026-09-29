// 카드 롱프레스 액션 시트 (t_62897e88 백로그④) — 텔레그램 관습: 길누르기(모바일)/호버 대용 홀드(웹) →
// '답글' 메뉴. 웹 마우스 홀드는 react-native-web PressResponder의 450ms longpress 타이머로 동일 경로.
// ※ FlatList 히트테스트에 압도되지 않도록 transparent Modal로 렌더 (t_3116c5bc/t_dee9e982 루트cause 교훈).
// 행 = 답글(인용 바 오픈) / 즐겨찾기 토글 / 갈라내기(canFork 게이트) / 선택(다중 선택 모드 진입+이 카드 선택).
// 실행 즉시 시트 종료. 미전송/실패 행은 화면이 진입 자체를 거부한다(canReplyTo/카드 가드와 동일 원칙).
import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { StarIcon } from './Icon';

interface Props {
  visible: boolean;
  /** 대상 카드 본문 발췌 (시트 상단 1줄) */
  excerpt: string;
  canFork: boolean;
  /** 대상 행의 즐겨찾기 현재 상태 */
  favorited: boolean;
  onClose: () => void;
  onReply: () => void;
  onFavorite: () => void;
  onFork: () => void;
  onSelect: () => void;
}

export default function MessageActionSheet({ visible, excerpt, canFork, favorited, onClose, onReply, onFavorite, onFork, onSelect }: Props) {
  const { t } = useTranslation();
  const row = (testID: string, label: string, onPress: () => void, icon?: React.ReactNode) => (
    <Pressable accessibilityRole="button" testID={testID} onPress={() => { onPress(); onClose(); }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHover }]}>
      {icon ?? <View style={styles.iconSlot} />}
      <Text style={styles.rowText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} testID="msg-action-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal testID="msg-action-sheet">
          <View style={styles.grabber} />
          {!!excerpt && <Text style={styles.excerpt} numberOfLines={1}>{excerpt}</Text>}
          {row('action-reply', t('queue.replyAction'), onReply)}
          {row('action-favorite', t(favorited ? 'cards.unfavorite' : 'cards.favorite'), onFavorite, <StarIcon size={18} color={colors.text2} filled={favorited} />)}
          {canFork && row('action-fork', t('queue.forkAction'), onFork)}
          {row('action-select', t('selection.enter'), onSelect)}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.sp4, paddingTop: spacing.sp2, paddingBottom: spacing.sp6 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: radii.full, backgroundColor: colors.border, marginBottom: spacing.sp3 },
  excerpt: { ...typography.caption, color: colors.text3, marginBottom: spacing.sp2, minHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp3, paddingVertical: spacing.sp3, minHeight: 48 },
  iconSlot: { width: 18 },
  rowText: { ...typography.body, color: colors.text1 },
});
