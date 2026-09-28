// 공감 재질문 카드 하단 예/아니요 대형 버튼 행 (t_043539ff 소형 척 → t_c62a2eb7 텔레그램식 격상).
// 레이아웃 (대표님 9/28 원문 "예와 아니요가 반반씩 텔레그램 예 아니요 형태로"):
//   - 카드 폭을 50/50 분할, 높이 ≥44px, 두 버튼 사이 1px 구분선 + 외곽 테두리.
//   - 초록 채움은 '예'만(affirmative 강조), '아니요'는 극회색 테두리형 — 2색 게이트 유지.
//   - 순서: 좌 '아니요' / 우 '예' (카드 폭의 반반, 텔레그램 reply keyboard 규약).
// 수명(3초 폐기·발화 진행까지 유지)은 lib/ackChips+useAckChip 소유, 이 컴포넌트는 렌더+탭 전송만.
// 라벨 바인딩 (t_c62a2eb7 #4): template_id가 '~맞죠?' 어미면 '맞아요'/'아니에오', 아니면 기본
// '예'/'아니요' — 라벨과 탭 payload가 같은 i18n 키에서 파생되어 발화=문구 불일치 원천 차단.
// 4종 모두 백엔드 isConfirmationUtterance 집합에 등재 (t_5e407a8a c090d94a 게이트 확장 완료 확인).
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { ackLabelKeysFor } from '../lib/ackChips';
import { colors, radii, spacing, typography } from '../theme';
import type { ChatMessage } from '../lib/chatLogic';

interface Props {
  /** 버튼 행이 붙은 공감 재질문 행 — structured_payload.template_id로 라벨 어미 결정 (#4) */
  message: ChatMessage;
  /** 탭 시 전송 문장 확정 콜백 — 화면(send)으로 전달 */
  onPressAck: (text: string) => void;
}

export default function AckChipRow({ message, onPressAck }: Props) {
  const { t } = useTranslation();
  const { yesKey, noKey } = ackLabelKeysFor(message);
  const yes = t(yesKey);
  const no = t(noKey);
  return (
    <View style={styles.row} testID="ack-chips">
      <Pressable
        accessibilityRole="button"
        onPress={() => onPressAck(no)}
        testID="ack-chip-no"
        style={({ pressed }) => [styles.button, styles.buttonNo, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Text style={styles.noText}>{no}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPressAck(yes)}
        testID="ack-chip-yes"
        style={({ pressed }) => [styles.button, styles.buttonYes, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.yesText}>{yes}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // 카드 폭 50/50 분할 행 — 외곽 1px 테두리 + 좌우 버튼 사이 1px 구분선, 라운드 코너는 프레임에
  row: {
    flexDirection: 'row',
    marginTop: spacing.sp2,
    marginHorizontal: spacing.sp1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  button: {
    flex: 1,
    minHeight: 44, // 대표님 요구: 높이 ≥ 44px (터치 타깃 포함)
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sp2,
  },
  // 극회색 테두리형 (무채색 유지 — 채움은 affirmative만) + 우측 1px 구분선 (텔레그램 키보드 규약)
  buttonNo: { backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border },
  // affirmative 강조: 초록 채움은 '예'만
  buttonYes: { backgroundColor: colors.accent },
  yesText: { ...typography.bodyBold, color: colors.onPrimary },
  noText: { ...typography.bodyBold, color: colors.text2 },
});
