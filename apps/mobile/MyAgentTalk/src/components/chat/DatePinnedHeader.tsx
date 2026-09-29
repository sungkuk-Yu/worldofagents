// 상단 고정 날짜 탭 (t_34f3e92c 백로그② — Telegram push-out 재현)
// 본문 DOM 계약과 분리: 인-플로우 구분선은 data-testid="date-separator", 이 오버레이는
// data-testid="pinned-date" (스크롤 중 뷰 상단에 붙는 것). 접근성 이중 노출 방지 — 오버레이는 aria-hidden.
// 스크린 전체 리렌더 회피: 화면이 핸들(update)을 스크롤/레이아웃 이벤트에서만 호출, 내부 state는
// (key, h, shift)가 실제로 바뀔 때만 갱신 → push-out 애니메이션 동안 이 컴포넌트만 렌더.
import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { Platform, View } from 'react-native';
import { Text } from 'react-native-paper';
import { styles } from '../../screens/chatScreenStyles';
import { computePinnedDate, PinnedDate } from '../../lib/chatLogic';

export interface SepMetric { key: string; label: string; y: number; h: number }
export interface DatePinnedHandle {
  update(seps: SepMetric[], offset: number): void;
}

const DatePinnedHeader = forwardRef<DatePinnedHandle>(function DatePinnedHeader(_props, ref) {
  const [pinned, setPinned] = useState<PinnedDate | null>(null);
  useImperativeHandle(ref, () => ({
    update(seps, offset) {
      const next = computePinnedDate(seps, offset);
      setPinned((prev) => (!next && !prev) || (next && prev && prev.key === next.key && prev.h === next.h && prev.shift === next.shift) ? prev : next);
    },
  }), []);
  if (!pinned) return null;
  // 인-플로우와 동일 패딩(sp1) — 클립 높이는 h+2·sp1. 스크롤박스 상단 1px 라인에서 pill 위 여백이
  // 잘려 보이지 않게 +1 보정. shift ≤ 0 구간만 렌더(내려오는 다음 탭 이중 표시 방지).
  if (pinned.shift > 0) return null;
  // RNW 0.21 실측: accessibilityElementsHidden은 웹 전달 목록에 없고, accessibilityRole:'text'는
  // propsToAriaRole에서 의도적으로 폐기(null) — aria-hidden/inert는 createDOMProps가 그대로 매핑한다.
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      testID="pinned-date"
      {...(Platform.OS === 'web' ? { 'aria-hidden': true, inert: '' } as never : {})}
      style={[styles.pinnedDateOverlay, { height: pinned.h + 1, overflow: 'hidden' }]}
    >
      <View style={{ transform: [{ translateY: pinned.shift }] }}>
        <View style={styles.dateSepRow}>
          <View style={styles.dateSepPill}>
            <Text style={styles.dateSepText}>{pinned.label}</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

export default DatePinnedHeader;
