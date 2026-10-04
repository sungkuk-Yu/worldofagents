// 리빌 바디 (t_da4f8623 ②-프론트) — 한 글자씩 타이핑되는 에이전트 본문 렌더 (표시 계층만 소유).
// message.content(원문)는 절대 변형하지 않는다 — 답글/수출/검색/선택복제는 원문 그대로 (요구4 회귀 금지).
// 상태가 없는 행(히스토리 재현·배치 GET·플래그 OFF·reduced-motion)은 typing=false → 폴백(원문) 경로 = 기존 렌더 1:1.
// 본문 서브트리만 글자마다 재렌더 (useSyncExternalStore — 화면/리스트 전체 리렌더 없음, t_cc232982 교훈 승계).
import React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import RichText from './RichText';
import ChatMarkdown from './ChatMarkdown';
import { looksLikeChatMarkdown } from '../lib/chatMarkdown';
import { revealStore, type RevealStore, type RevealView } from '../lib/revealStore';

/** 리빌 진도 구독 — getSnapshot은 viewCache로 내용 불변 시 참조 재사용(Object.is 규약 충족,
 *  전역 notify가 다른 행을 재렌더하지 않는다). store 미지정 = 앱 공용 싱글턴. */
export function useRevealView(store: RevealStore | undefined, key: string, fallback: string): RevealView {
  const s = store ?? revealStore;
  const subscribe = React.useCallback((cb: () => void) => s.subscribe(key, cb), [s, key]);
  const getSnapshot = React.useCallback(() => s.view(key, fallback), [s, key, fallback]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 진행 중 리빌 존재의 React 반응형 뷰 (subscribeAll+hasPending) —
 *  타이핑 버블 소멸(t_da4f8623 요구1)·예/아니요 창 억제(충돌 방지)가 이 하나를 공유한다.
 *  서버 스냅샷 false는 항상 안전(재현 경로는 상태 미생성) → 기존 e2e reduced-motion 하네스는
 *  영구 false = 무회귀. */
export function useRevealPending(store: RevealStore = revealStore): boolean {
  const subscribe = React.useCallback((cb: () => void) => store.subscribeAll(cb), [store]);
  return React.useSyncExternalStore(subscribe, () => store.hasPending(), () => false);
}

/** 말미 커서 — 사람 타이핑 감각(550ms 펄스, StreamingCursor 계보). 리빌 소진·확정 시 미렌더=정지(요구3). */
export function RevealCaret({ testID = 'typing-caret' }: { testID?: string }) {
  const [pulse] = React.useState(() => new Animated.Value(0));
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.Text
      testID={testID}
      accessibilityElementsHidden
      style={[styles.caret, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }) }]}
    >▍</Animated.Text>
  );
}

const styles = StyleSheet.create({
  caret: { color: '#4C7DFF', fontSize: 16, fontWeight: '300', marginLeft: 1 },
});

interface Props {
  store?: RevealStore;
  /** 리빌 키 (스트림 카드 = stream-<runId>, 확정/재질문 행 = message.id) */
  revealKey: string;
  /** 원문 폴백 — 리빌 상태가 없거나 소진 후의 진실 (content 그대로) */
  content: string;
  /** 본문 Text 스타일 (호출 카드 경로와 동일 이식) */
  bodyStyle?: object;
  /** 리빌 중 markdown 감지 시 ChatMarkdown streaming=true (미닫힌 fence 임시 마감 — t_e9480e0f 계약 승계) */
  allowMarkdown?: boolean;
  /** 노출 0자 구간의 대체물 (placeholder quip 연속성) */
  emptyFallback?: React.ReactNode;
  caretTestId?: string;
  /** 패스-스루(미리빌) markdown testID — 기존 카드의 'chat-bubble' 계약 보존 (회귀 금지) */
  fallbackTestId?: string;
}

export default function RevealBody({ store, revealKey, content, bodyStyle, allowMarkdown = false, emptyFallback, caretTestId, fallbackTestId }: Props) {
  const view = useRevealView(store, revealKey, content);
  if (!view.typing) {
    // 상태 없음/소진 수렴: 기존 본문 렌더러로 패스-스루 (MarkdownView/RichText 경계 = 회귀 금지 계약)
    if (!content) return <>{emptyFallback ?? null}</>;
    if (allowMarkdown && looksLikeChatMarkdown(content)) return <ChatMarkdown content={content} testID={fallbackTestId ?? 'chat-bubble-reveal'} />;
    return <RichText content={content} />;
  }
  const shown = view.text;
  return (
    <View testID="reveal-body">
      {shown
        ? (allowMarkdown && looksLikeChatMarkdown(shown)
            ? <ChatMarkdown content={shown} streaming testID="chat-bubble-reveal" />
            : <Text testID="chat-bubble-reveal" style={bodyStyle} accessibilityLiveRegion="polite">{shown}</Text>)
        : emptyFallback ?? null}
      {view.revealing && <RevealCaret testID={caretTestId ?? 'typing-caret'} />}
    </View>
  );
}
