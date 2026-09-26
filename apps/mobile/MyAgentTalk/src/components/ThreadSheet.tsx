// 스레드 바텀시트 — 대표님 지시 #52 (애플 감성 전환)
// 채팅 → 카드 스레드: @gorhom/bottom-sheet 디텐트 25%→50%→90% 스냅, 드래그로 내리면 닫힘.
// 레퍼런스: Apple 지도/App Store 카드 시트. 스프링 곡선은 bottom-sheet 기본(Apple 계열 damping).
// 연속성(Continuity): 카드를 탭해 시트로 열 때 같은 폭/라운드닝으로 시각 연속성 유지 (#52 규칙 3 최소 요건).
// 웹: BottomSheetModal은 웹에서도 CSS transition으로 폴백 렌더됨(라이브러리 내장 styles.web) — Playwright로 검증.
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import ThreadPanel from './ThreadPanel';
import type { ThreadTarget } from './ThreadPanel';
import type { ChatMessage } from '../types';
import { colors, radii, spacing } from '../theme';

export interface ThreadSheetHandle {
  open: (target: ThreadTarget) => void;
  close: () => void;
}

// 중첩 스레드(시트 안에서 스레드 열기)는 내부 스택으로 관리 — 시트 자체는 유지
export default React.forwardRef<ThreadSheetHandle, { navigation: any }>(function ThreadSheet({ navigation }, ref) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [target, setTarget] = useState<ThreadTarget | null>(null);
  const [stack, setStack] = useState<ThreadTarget[]>([]);
  const active = stack.length ? stack[stack.length - 1] : target;
  // dismiss 애니메이션 진행 중 open 요청은 큐잉 — present()가 닫힘 도중 무시되는 경쟁 회피
  const dismissingRef = useRef(false);
  const pendingRef = useRef<ThreadTarget | null>(null);

  useImperativeHandle(ref, () => ({
    open: (next: ThreadTarget) => {
      setStack([]);
      if (dismissingRef.current) pendingRef.current = next;
      else setTarget(next);
    },
    close: () => {
      if (!target) return;
      dismissingRef.current = true;
      sheetRef.current?.dismiss();
    },
  }), [target]);

  // 모달은 항상 마운트 유지 — present()는 target 설정 후 마운트된 시트에 호출
  useEffect(() => {
    if (target && !dismissingRef.current) sheetRef.current?.present();
  }, [target]);

  const openNested = useCallback((message: ChatMessage) => {
    setStack((prev) => [...prev, { ...(active as ThreadTarget), rootMessageId: message.id }]);
  }, [active]);

  const back = useCallback(() => {
    if (stack.length) { setStack((prev) => prev.slice(0, -1)); return; }
    if (!active) return;
    dismissingRef.current = true;
    sheetRef.current?.dismiss();
  }, [stack.length, active]);

  const onDismiss = useCallback(() => {
    dismissingRef.current = false;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) { setStack([]); setTarget(pending); }
    else { setTarget(null); setStack([]); }
  }, []);

  return <BottomSheetModal
    ref={sheetRef}
    index={1}
    snapPoints={['25%', '50%', '90%']}
    onDismiss={onDismiss}
    enablePanDownToClose
    enableDynamicSizing={false}
    backgroundStyle={styles.background}
    handleIndicatorStyle={styles.indicator}
  >
    <BottomSheetView style={styles.content} testID="thread-sheet">
      {active && <ThreadPanel navigation={navigation} target={active} onBack={back} onOpenNested={openNested} />}
    </BottomSheetView>
  </BottomSheetModal>;
});

const styles = StyleSheet.create({
  background: { backgroundColor: colors.surface, borderRadius: radii.lg },
  indicator: { backgroundColor: colors.borderStrong },
  content: { flex: 1, paddingHorizontal: spacing.sp2 },
});
