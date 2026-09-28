// 비서실 백스테이지 릴레이 자막 스트립 (t_961ca593 Phase B 案①) — 입력 콘솔 위 상시 1줄.
// WS relay.updated(서버 t_583d9fed 案1)의 최신 stage 한 줄만 노출: 백스테이지(배정→자료→초안→마무리)가
// 일하는 중임을 '같은 세션의 무대 위에서' 암시. 피드 고정 행(案③)도 아님, 별도 창(案②)도 아님 —
// 타이핑 카드/스트리밍과 같은 '현재 런'의 연출 레이어다.
// 계약 경계: 휘발성 연출(DB 미저장·message 아님) → messages 병합 절대 금지, 렌더 소스는 useChatSession.relay 단일 원천.
// 문구: i18n 키 `relay.<stage>` 우선, 서버 quip 폴백(t_b2b86cd6 노출 규칙 — stage 코드/영문 기술어 노출 없음).
// 이벤트 0건(비서 외 페르소나)이면 relay=null → 렌더 0(빈 바 금지, 큐 스트립과 동일 철학).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import type { RelayCaption } from '../lib/chatLogic';

interface Props {
  /** 현재 자막 (null = 이벤트 없음/런 종료 → 정리 후 완전 숨김) */
  caption: RelayCaption | null;
}

const FADE_MS = 240;

export default function RelayCaptionStrip({ caption }: Props) {
  const { t, i18n } = useTranslation();
  // Animated.Value는 TypingCard와 동일하게 useState lazy-init (렌더 중 ref 접근 회피 — react-hooks/refs)
  const [opacity] = useState(() => new Animated.Value(0));
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const [shown, setShown] = useState<RelayCaption | null>(caption);
  // 진행 중 애니메이션 정지 후 새 페이드 — fade-out 중 새 자막 도착 시 값 경합 방지.
  const fade = (to: number, done?: () => void) => {
    animRef.current?.stop();
    const anim = Animated.timing(opacity, { toValue: to, duration: FADE_MS, easing: to > 0 ? Easing.in(Easing.quad) : Easing.out(Easing.quad), useNativeDriver: false });
    animRef.current = anim;
    anim.start(({ finished }) => { if (animRef.current === anim) animRef.current = null; if (finished) done?.(); });
  };
  // 렌더 확정 이력 ref — state와 무관하게 '지금 화면에 무엇이 떠 있는지'만 추적.
  // (shownKey를 deps에 넣으면 setShown 재렌더마다 이펙트가 재실행되어 페이드가 재시작되는 결함 → ref로 차단)
  const liveKey = useRef<string | null>(caption ? `${caption.runId}:${caption.stage}` : null);

  useEffect(() => {
    if (!caption) {
      // 런 종료(run.completed 등) 또는 세션 전환 — 아웃 페이드 후 언마운트(제로잔류).
      // 페이드아웃 중 새 자막이 먼저 도착하면(liveKey 갱신) 이 콜백은 정리하지 않는다.
      if (!liveKey.current) return;
      const closingKey = liveKey.current;
      liveKey.current = null;
      fade(0, () => { if (liveKey.current === null && closingKey !== null) setShown((s) => (s ? `${s.runId}:${s.stage}` === closingKey ? null : s : s)); });
      return;
    }
    const key = `${caption.runId}:${caption.stage}`;
    if (liveKey.current === key) return; // 동일 자막 재렌더 — 요동 금지(커튼 멱등과 별개의 UI 가드)
    liveKey.current = key;
    // 단계 전환: 이전 자막을 갈아쓰는 1줄 갱신(히스토리 아님). 역주행/중복 이벤트는
    // 상류 applyRelayEvent(단조·dedup 커튼)에서 이미 소거되어 여기까지 오지 않는다.
    opacity.setValue(0);
    setShown(caption);
    fade(1);
  }, [caption, opacity]); // eslint-disable-line react-hooks/exhaustive-deps -- fade는 opacity-per-mount불변 ref 클로저
  useEffect(() => () => { animRef.current?.stop(); opacity.setValue(0); }, [opacity]); // 언마운트 시 애니메이션 해제

  if (!shown) return null; // 이벤트 0건 / 정리 완료 = 렌더 없음 (빈 바 금지)

  // i18n 우선 → 서버 quip 폴백. stage는 normalizeRelayEvent가 RELAY_ORDER 밖을 차단했으므로 키 존재 보장.
  const textKey = `relay.${shown.stage}`;
  const text = i18n.exists(textKey) ? t(textKey) : shown.quip || '';
  if (!text) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity }]}>
      <View testID="relay-caption" accessibilityLiveRegion="polite" style={styles.pill}>
        <View testID="relay-dot" style={styles.dot} />
        <Text style={styles.text} numberOfLines={1}>{text}</Text>
      </View>
    </Animated.View>
  );
}

// 라이트 모드 기준 칙칙함 금지 (t_64af90b0 #5): 화이트 기반 극박 tint + 그린 점 1개. 전면 도색 금지.
// useNativeDriver: false — 웹 export에서 네이티브 드라이버 미지원(RNW는 JS 드라이버), 네이티브는 opacity 만의 잔잔한 페이드.
const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.sp3,
    paddingTop: spacing.sp1,
    paddingBottom: 2,
  },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp1 + 2,
    paddingHorizontal: spacing.sp2 + 2,
    paddingVertical: 3,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceRaise,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: '100%',
  },
  dot: {
    width: spacing.sp1,
    height: spacing.sp1,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  text: { ...typography.caption, color: colors.text2, flexShrink: 1 },
});
