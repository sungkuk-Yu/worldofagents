// ① single card ID patch — 인라인 스트리밍 카드 (t_5c559e85, Telegram edit-in-place 규범)
// delta마다 새 카드가 아니라 같은 run의 고정 카드(stream-<runId>) content만 갱신되어 여기로 렌더된다.
// 확정 message.new(서버 answer 행)가 같은 자리에 오면 이 카드는 제거된다(ID merge 상당).
// ③ placeholder — content가 빈 토큰 전 카드도 같은 자리에 점프 없이 자리를 지킨다.
// t_e1de4cc4 ①재작업 (대표님 10/10 원지시 "ai 생성 이런거 빼고 답변중도 빼"): 상태 문구 0줄 계약 —
// '답변 중 · 대기 n'/단계명 quip/'AI 생성' 배지 등 텍스트를 이 카드에서 일절 렌더하지 않는다.
// 진행 신호 = 무텍스트 연출만(하단 펄스 도트 + 리빌 말미 커서). 대기 수 단일 소스는 우상단 큐 배지.
// queueStore/quip/i18n 읽기 전부 제거 — 텍스트 소스가 구조적으로 존재하지 않아야 게이트가 반전된다.
// ②-프론트 (t_da4f8623) → ③ (t_4c266653, 대표님 10/10): content(서버 누적 원문)는 불변, 본문은 RevealBody가
// stream-<runId> 노출 진도(문장 경계까지 즉시 — 30자/s 지터 연출 폐기)로 그림. 리빌 미활성(플래그 OFF·
// reduced-motion)이면 폴백=content 즉시 렌더로 기존과 1:1 (회귀 금지).
import React from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import type { CardProps } from './types';
import RevealBody from '../components/RevealBody';
import { cardStyles as s } from './styles';
import { renderFlags } from '../lib/renderFlags';
import { colors } from '../theme';

// ② contain:layout (t_5c559e85, Open WebUI 픽스 1단계) — 스트리밍 컨테이너 내부의 재레이아웃이
// 상위(리스트 전체)로 전파되는 것을 CSS layout containment로 차단. 웹 전용 CSS(네이티브 무해).
// size containment가 아니라 자기 키높이는 콘텐츠대로 산출 → FlatList onLayout 측정 불변.
const CONTAIN_WEB = Platform.OS === 'web' && renderFlags.streamContain
  ? ({ contain: 'layout' } as unknown as React.ComponentProps<typeof View>['style'])
  : undefined;

/** 무텍스트 라이브 마커 — 550ms 펄스 도트(StreamingCursor/RevealCaret 계보, 텍스트 0).
 *  testID는 'stream-live-mark' 관례 승계: 스모크들이 성장 마커 존재=1/확정 후=0 카운트만 본다.
 *  decorative(accessibilityElementsHidden) — SR에 상태 문구를 읽히던 polite 리전도 0줄 계약에 포함. */
function StreamLivePulse() {
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
    <Animated.View
      testID="stream-live-mark"
      pointerEvents="none"
      accessibilityElementsHidden
      style={[pulseStyle.dot, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }]}
    />
  );
}

const pulseStyle = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, alignSelf: 'flex-start', marginTop: 4 },
});

export default function StreamCard({ message }: CardProps) {
  const done = message.payload?.streamDone === true;
  const runId = message.runId ?? message.id.replace(/^stream-/, '');
  return <View style={[s.frame, CONTAIN_WEB]} testID={`stream-card-${message.runId ?? message.id}`}>
    <RevealBody
      revealKey={`stream-${runId}`}
      content={message.content}
      bodyStyle={[s.body, s.micro]}
    />
    {!done && <StreamLivePulse />}
  </View>;
}
