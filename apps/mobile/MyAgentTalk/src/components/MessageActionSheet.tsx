// 카드 롱프레스 액션 시트 (t_62897e88 백로그④) — 텔레그램 관습: 길누르기(모바일)/호버 대용 홀드(웹) →
// '답글' 메뉴. 웹 마우스 홀드는 react-native-web PressResponder의 450ms longpress 타이머로 동일 경로.
// ※ FlatList 히트테스트에 압도되지 않도록 transparent Modal로 렌더 (t_3116c5bc/t_dee9e982 루트cause 교훈).
// 행 = 쓰레드(인용 바 오픈) / 즐겨찾기 토글 / 새프로젝트(canFork 게이트) / 선택(다중 선택 모드 진입+이 카드 선택)
//       (t_7f86eefb 10/4 라벨 승계: 답글→쓰레드·갈라내기→새프로젝트 — testID action-reply/action-fork 불변)
//       / 되물음 끄기·켜기(t_8bf12fa4 — 설정 진입 없이 echoMode 즉시 반전. 설정 토글과 동일 상태: 같은 userPrefs).
// 실행 즉시 시트 종료. 미전송/실패 행은 화면이 진입 자체를 거부한다(canReplyTo/카드 가드와 동일 원칙).
import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { StarIcon, MicIcon } from './Icon';

interface Props {
  visible: boolean;
  /** 대상 카드 본문 발췌 (시트 상단 1줄) */
  excerpt: string;
  canFork: boolean;
  /** 대상 행의 즐겨찾기 현재 상태 */
  favorited: boolean;
  /** 현재 echoMode가 'on'인지 (t_8bf12fa4 — 시트 행 라벨 반전 표시의 근거) */
  echoOn: boolean;
  onClose: () => void;
  onReply: () => void;
  onFavorite: () => void;
  onFork: () => void;
  onSelect: () => void;
  /** '답변 전 되물음' 즉시 반전 — 설정 화면과 동일 상태(userPrefs.echoMode), 진입 없이 카드에서 토글 */
  onToggleEcho: () => void;
}

export default function MessageActionSheet({ visible, excerpt, canFork, favorited, echoOn, onClose, onReply, onFavorite, onFork, onSelect, onToggleEcho }: Props) {
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
          {/* 되물음 토글 (t_8bf12fa4) — 현재 상태의 반전을 권하는 라벨: 켜져 있으면 '끄기', 꺼져 있으면 '켜기'.
              설정 화면 Switch와 동일 소스(getEchoMode/setEchoMode)라 상태 분기 없음. */}
          {row('action-echo', t(echoOn ? 'cards.echoOffAction' : 'cards.echoOnAction'), onToggleEcho, <MicIcon size={18} color={colors.text2} />)}
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
