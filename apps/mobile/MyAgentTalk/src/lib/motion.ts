// 모션 공통 — 대표님 지시 #52 "애플 감성" (Apple HIG Motion: Purpose·Continuity·Responsiveness)
// 규칙 7: iOS "동작 줄이기(Reduce Motion)" 설정 시 애니메이션 생략 — 애플 감성의 일부는 이 배려다.
// 웹에서는 prefers-reduced-motion 미디어쿼리로 동일 신호를 받는다 (react-native-web 지원).
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (active) setReduced(value); })
      .catch(() => { /* 플랫폼 미지원 — 기본값(false) 유지 */ });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => setReduced(value));
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}
