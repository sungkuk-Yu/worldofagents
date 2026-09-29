// 날짜 구분선 인-플로우 행 (t_34f3e92c 백로그②, 텔레그램 컨벤션)
// DOM 계약: data-testid="date-separator" (e2e 스모크 불변), 우측 상단 고정 탭은 본문 DOM 금지 —
// 고정 헤더는 ChatScreen의 오버레이(pinned-date)가 소유한다. 접근성 role은 본문 텍스트에만 부여
// (컨테이너까지 지정하면 자식이 semantic retires로 사라져 라벨이 DOM에서 안 보임 — 9/29 스모크 실측).
// 한국어 조사 끊김 방지: word-break: keep-all (스타일에 포함), textWrapBalanced 금지.
import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { styles } from '../../screens/chatScreenStyles';

export default function DateSeparatorRow({ separator }: { separator: { label: string } }) {
  return (
    <View testID="date-separator" style={styles.dateSepRow}>
      <View style={styles.dateSepPill}>
        <Text accessibilityRole="text" style={styles.dateSepText}>{separator.label}</Text>
      </View>
    </View>
  );
}
