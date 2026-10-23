// 공감 재질문 카드 하단 예/아니요 대형 버튼 행 (t_043539ff 소형 척 → t_c62a2eb7 텔레그램식 격상).
// 레이아웃 (대표님 9/28 원문 "예와 아니요가 반반씩 텔레그램 형태로" + t_1b123e59 원문① "맞아요가 왼쪽에 있어야되"):
//   - 카드 폭을 50/50 분할, 높이 ≥44px, 두 버튼 사이 1px 구분선 + 외곽 테두리.
//   - 순서: 좌 '예'(affirmative 고정) / 우 '아니요' — affirmative는 항상 왼쪽.
//   - 초록 채움은 '예'만(affirmative 강조), '아니요'는 극회색 테두리형 — 2색 게이트 유지.
// 수명(3초 폐기·발화 진행까지 유지)은 lib/ackChips+useAckChip 소유, 이 컴포넌트는 렌더+탭 전송만.
// 라벨 (t_1b123e59 원문② "맞아요가 아니고 예/아니요 로만 해야되"): 템플릿 바인딩(t_c62a2eb7 #4) 폐기 —
//   template_id 무관 고정 chat.ackYes/ackNo('예'/'아니요', en 'Yes'/'No'). 라벨과 탭 payload가 같은
//   i18n 키에서 파생되어 발화=문구 불일치 원천 차단. 두 발화 모두 백엔드 게이트 집합 등재 (t_135a19b5).
// t_b13756a9: 2.5초 카운트다운 표시 + 무응답 시 자동 "예" 전송 (대표님 요청)
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { ACK_AUTO_PROCEED_MS } from '../lib/ackChips';

interface Props {
  /** 탭 시 전송 문장 확정 콜백 — 화면(send)으로 전달 */
  onPressAck: (text: string) => void;
  /** 확인 대상 공감 메시지의 실제 본문 */
  decisionText?: string | null;
  /** 남은 시간 (ms) — 카운트다운 표시용 (t_b13756a9) */
  remainingMs?: number;
}

export default function AckChipRow({ onPressAck, decisionText, remainingMs }: Props) {
  const { t } = useTranslation();
  const yes = t('chat.ackYes');
  const no = t('chat.ackNo');
  // 카운트다운 프로그레스: 남은 비율 (0~1)
  const progress = remainingMs != null ? Math.max(0, Math.min(1, remainingMs / ACK_AUTO_PROCEED_MS)) : 1;
  // 초 단위 표시 (소수점 1자리)
  const secondsLeft = remainingMs != null ? Math.max(0, remainingMs / 1000).toFixed(1) : null;
  return (
    <View style={styles.container} testID="ack-chips">
      {!!decisionText?.trim() && <Text style={styles.decisionText} testID="ack-decision-text">{decisionText.trim()}</Text>}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onPressAck(yes)}
          testID="ack-chip-yes"
          style={({ pressed }) => [styles.button, styles.buttonYes, pressed && { opacity: 0.85 }]}
        >
          {/* 카운트다운 프로그레스 바 (예 버튼 하단) */}
          <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
          <View style={styles.yesContent}>
            <Text style={styles.yesText}>{yes}</Text>
            {secondsLeft != null && <Text style={styles.countdown}>{secondsLeft}s</Text>}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onPressAck(no)}
          testID="ack-chip-no"
          style={({ pressed }) => [styles.button, styles.buttonNo, pressed && { backgroundColor: colors.surfaceHover }]}
        >
          <Text style={styles.noText}>{no}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.sp2, gap: spacing.sp2 },
  decisionText: {
    ...typography.body,
    color: colors.text1,
    flexShrink: 1,
    lineHeight: 22,
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
    backgroundColor: colors.surfaceHover,
    borderRadius: radii.md,
  },
  // 카드 폭 50/50 분할 행 — 외곽 1px 테두리 + 좌우 버튼 사이 1px 구분선, 라운드 코너는 프레임에
  row: {
    flexDirection: 'row',
    marginTop: 0,
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
    position: 'relative',
  },
  // affirmative 강조: 초록 채움은 좌측 '예'만 + 우측 1px 구분선 (텔레그램 키보드 규약)
  buttonYes: { backgroundColor: colors.accent, borderRightWidth: 1, borderRightColor: colors.border },
  // 극회색 테두리형 (무채색 유지 — 채움은 affirmative만)
  buttonNo: { backgroundColor: colors.surface },
  yesContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  yesText: { ...typography.bodyBold, color: colors.onPrimary },
  noText: { ...typography.bodyBold, color: colors.text2 },
  // 카운트다운 프로그레스 바 (t_b13756a9)
  progressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  // 카운트다운 초 표시
  countdown: { ...typography.caption, color: colors.onPrimary, opacity: 0.8 },
});
