// 음성 스테이지 (VoiceStage) — t_4758f25d 최종 재스펙 (대표님 9/28 밤, #303/#304/#307/#311/#316/#318 종합).
// 고정 조이스틱 콘솔 폐기 → 수직 2분할: 상부 = 스크롤/탭 영역(히스토리 절대 안 가림),
// 하부 ~30% = 투명 조이스틱 스트립(0-호스트 위 absolute, bottom:0). 대기 상태는 빈 영역만(잘림/겹침 버그 소멸):
//  - 첫 진입 힌트 알약 "여길 길게 눌러 말하기" 3초 후 페이드(localStorage로 2차 진입부터 생략)
//  - 홀드 → 링+초록 마이크 + 홀 둘레 글로우 호흡 펄스(#316)
//  - 실시간 sine 리본 3중(100/60/35%, 초록 단색): 진폭 = 마이크 실측 게인(level prop),
//    rAF 구동 + 지수 감쇠(매끄럽게 차오름), 무음 = 잔물결만, bg 투명(채팅 배후 비침). 막대 EQ 금지(#318).
//  - 놓기 = 전송 → 초록 체크 200ms 후 원상복구(잔상/점멸 금지) / ↑ 슬라이드 = 키보드 계층(B) /
//    좌·우 끝 홀드 = 예/아니요(t_043539ff 계승) / 좌·우·하단 링 밖 완전 이탈 = 폐기.
// t_64e3edd6 (대표님 9/29 #324/#325 확정):
//  - 음성 = 무확인 진행: 홀드-릴리스는 전사→즉시 답변 파이프라인(텔레그램식). 예/아니오 게이트·타이머 없음.
//  - 조이스틱 좌예·우아니오는 **재질문 버튼 행이 활성일 때만** 발동(ackActive prop) — 비활성 시
//    좌우 끝도 평범한 홀드로 send 경로(전사 진행)를 따른다(↑/이탈 계약은 불변).
//  - 마이크 링 축소 (#321 ~60%): STAGE_RING 160→96, 마이크 디스크 56→34. 아이콘 ≥16px.
//    탭 판독 최소 44px = 중앙 서클 패드(96px)가 담당 — t_f8c40db0(9/30) 폐지: 스트립 전체 홀드 →
//    지문형 원만 인식, 원 밖 전역 스크롤 통과.
// 제스처: getDirection(8방향 스냅 — JoystickMic과 동일 lib, 제스처 매핑 호환) — 벡터는 그랜트 지점 기준.
// 권한 첫 요구 = 그랜트 시점(onPressHoldStart) — 로드 중 getUserMedia 없음(계약 불변).
// 웹 모바일(voiceFirstConsole 게이트) 전용 마운트 — PC/네이티브/데모는 기존 텍스트 입력바(t_e735d936 ⑧).
// t_f8c40db0 (대표님 9/30): 홀드 히트영역 = 중앙 지문형 서클 패드(STAGE_RING 크기)만.
//   스트립 전체(box-none)는 터치 통과 — 원 밖 드래그는 리스트 스크롤이 그대로 받는다.
//   스트립 레이아웃/패딩 계약(#311)·제스처 계약(↑/좌우/이탈 경계=스트립)은 불변 — 히트 시작점만 축소.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, View, type GestureResponderHandlers } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { getDirection, selectActionFromVector, vectorToAngle, COMPASS_DIRECTIONS, armedCompassLabelKey, inlineCompassLabelKey, type StageAction } from '../lib/gesture';
import { ackPhraseForDirection } from '../lib/ackHold';
import { formatRecordingDuration, PAD_TOP_PERCENT } from '../lib/voiceStage';
import { getGripHand, subscribePrefs, type GripHand } from '../lib/userPrefs';
import { JoystickGesture } from '../types';
import { colors, radii, spacing, typography } from '../theme';
import { MicIcon } from './Icon';

export const STAGE_RING = 96;       // t_64e3edd6 ④ (#321): 160 → 96 (~60%) — "마이크 버튼이 너무 커"
const MIC_BUTTON = 34;              // 56 → 34 (링의 ~35% 유지, 아이콘 18px ≥16px 판독)
const DONE_MS = 200;                // 체크 유지 후 소멸 (#316)
const HINT_KEY = 'at-voicestage-hint-seen';
const RIBBON_W = 160;               // t_64e3edd6 ④: 240 → 160 — 링 축소에 맞춰 리본도 축소(링 폭과 같아 부조화 제거)
const RIBBON_H = 40;
const ESCAPE = 10;                  // 링 밖 완전 이탈 판정 오차(px) — ↑ 이탈은 DIR_UP 스냅 후라 keyboard 우선

interface Props {
  /** 스트립 높이 (voiceStageHeight(viewportH) — 리스트 패딩 계약과 동일 값) */
  height: number;
  /** 홀드 시작 (touchstart — 마이크 권한 첫 요청 지점) */
  onPressHoldStart: () => void;
  /** 릴리스 전송 (audio.end) */
  onHoldEnd: () => void;
  /** 릴리스 폐기 (audio.cancel) */
  onHoldAbort: () => void;
  /** 예/아니요 발화 ('예'/'아니요') — ackActive일 때만 좌/우 끝 릴리스로 발생 */
  onSendAck: (text: string) => void;
  /** t_64e3edd6 #324/#325: 공감 재질문 예/아니요 버튼 행 활성 여부 — false면 좌/우도 일반 send(음성 무확인 진행) */
  ackActive?: boolean;
  /** ↑ 슬라이드 = 키보드 계층(B) 개방 */
  onOpenKeyboard: () => void;
  recording: boolean;
  /** 0..1 마이크 실측 게인 — sine 리본 진폭 원천 (정지 영상 금지, #316) */
  level: number;
  /** errors.* 키 — 폴백 안내 한 줄 (부모가 병행 개방하는 경우에도 노출 유지) */
  error?: string | null;
  /** t_5058e15f ②: 그랜트 쥠 + talk.ready 대기 — '연결 중' 안내(캡처 지연 시작, 조용한 스킵 금지) */
  pending?: boolean;
  /** t_2f296081 ③ (대표님 10/4): 키보드 PTT 경로(pttKey 홀드/토글)의 활성 캡처 — ptt.active.
   *  true인데 제스처 그랜트가 없으면 합성 홀드(링+리본+타이머)로 진입, false 전환 시 제자리
   *  릴리스와 동일하게 done 체크로 마무리. 터치 홀드(이미 phase='holding')에는 무영(no-op). */
  externalHolding?: boolean;
  // t_08d671a8 5방향 액션 콜백
  /** → 수정: 녹음 완료하되 전송 전 텍스트 편집 상태로. t_616e9abf 실행 배선 — 이 콜백이
   *  릴리스 실행자 단독(ptt.endHoldDraft = audio.end{draft:true}); onHoldEnd 병행 호출 금지. */
  onEdit?: () => void;
  /** ↓ 사진첨부: 앨범 픽커 열기 */
  onPhoto?: () => void;
  /** ↗ 파일첨부: 파일 픽커 열기 */
  onFile?: () => void;
}

type Phase = 'idle' | 'holding' | 'done';

export default function VoiceStage({ height, onPressHoldStart, onHoldEnd, onHoldAbort, onSendAck, ackActive = false, onOpenKeyboard, recording, level, error, pending, externalHolding, onEdit, onPhoto, onFile }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [ackHint, setAckHint] = useState<'yes' | 'no' | null>(null);
  const [upTarget, setUpTarget] = useState(false);
  // t_08d671a8: 현재 드래그 방향의 액션 — 나침반 강조용
  const [activeAction, setActiveAction] = useState<StageAction | null>(null);
  const [hintSeen, setHintSeen] = useState(() => {
    try { return Platform.OS === 'web' && typeof localStorage !== 'undefined' && localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
  });
  const [hintOpacity] = useState(() => new Animated.Value(1));
  const [pulse] = useState(() => new Animated.Value(0));
  const [doneOpacity] = useState(() => new Animated.Value(1));
  // t_08d671a8: 그립 손 설정에 따라 패드 좌우 위치 변경 — prefs 구독으로 실시간 반영
  const [gripHand, setGripHandLocal] = useState<GripHand>(getGripHand);
  useEffect(() => subscribePrefs(() => setGripHandLocal(getGripHand())), []);
  // t_5131cb09 (대표님 10/10): 홀드 중 브라우저 카피 Callout/텍스트 선택이 제스처를 탈취·지연 —
  //   1차 봉인 = 전역 CSS(public/index.html #mat-callout; -webkit-touch-callout은 RN 스타일
  //   화이트리스트 밖이라 CSS가 유일한 실행 지점 — RNW 드롭 실측). 2차 = 스트립 DOM에서
  //   selectstart/contextmenu 원천 preventDefault. RNW View는 ref가 실제 DOM 요소(div)로
  //   포워딩(memo forwardRef → useMergeRefs)되고 박스이벤트는 자식(ring/pad/힌트)에서
  //   스트립을 통해 전파된다(pointer-events:none은 히트만 제외, 전파 아님) — 스트립 부착이
  //   홀드 계층(힌트·나침반·타이머·ring 전부 직계 서브트리)을 덮는 최소 지점. mount-effect 대신
  //   콜백 ref로 부착/해제 — 노드 실존 시점에 정확히 붙고 언마운트 시 정리(명령형 DOM —
  //   MagicPad 캔버스와 동일 예외), stripRef 측정 경로도 동일 콜백에서 갱신 유지.
  const stripElSeal = useRef<{ el: HTMLElement; off: () => void } | null>(null);
  const sealStripRef = useCallback((node: View | null) => {
    stripRef.current = node;
    if (stripElSeal.current) { stripElSeal.current.off(); stripElSeal.current = null; }
    if (Platform.OS !== 'web') return;
    const el = node as unknown as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    const block = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    const selBlock = (e: Event) => {
      // 스트립 밖에서 시작된 선택은 건드리지 않는다 — 앵커가 홀드 계층 subtree일 때만 차단
      const s = document.getSelection();
      const n = s && s.rangeCount > 0 ? s.getRangeAt(0).startContainer : null;
      if (n && (n === el || el.contains(n))) { e.preventDefault(); e.stopPropagation(); }
    };
    el.addEventListener('selectstart', selBlock, true);
    el.addEventListener('contextmenu', block, true);
    stripElSeal.current = { el, off: () => {
      el.removeEventListener('selectstart', selBlock, true);
      el.removeEventListener('contextmenu', block, true);
    } };
  }, []);


  // t_2eea055a (대표님 9/30 "녹음할때 텔레그램처럼 녹음 시간"): 홀드 시작 시각 기준 경과 ms —
  // 250ms tick(초 표시라 그보다 빠른 갱선은 불필요, 렌더 부하 최소). Date.now 기준:
  // rAF과 달리 탭 비활성(background)에도 실경과가 유지된다(interval은 throttle되지만 재계산은 정확).
  const [elapsedMs, setElapsedMs] = useState(0);

  // 제스처 상태 refs — PanResponder는 1회 생성 (JoystickMic/MagicPad 패턴)
  const startedRef = useRef(false);
  const boxRef = useRef<{ left: number; right: number; bottom: number } | null>(null);
  // 이탈/히트 기준 스냅샷용 — t_f8c40db0: 제스처 계약(이탈 경계)은 스트립 전체 유지, 히트만 패드로 축소
  const stripRef = useRef<View | null>(null);
  const gestureRef = useRef<JoystickGesture | null>(null);
  const escapedRef = useRef(false);
  // t_08d671a8: 마지막 드래그 벡터 — 릴리스 시 5방향 액션 결정용
  const lastDragRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartRef = useRef(0);

  // 리본 캔버스 — RNW에서 <canvas> JSX 미지원 → 실제 DOM canvas를 effect로 부착(#318 rAF 요구)
  const ribbonHostRef = useRef<View | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  // 최신 값을 ref로 유지 — 리본 루프/콜백이 렌더 없이도 현재 상태/props를 읽는다.
  // (렌더 중 ref 쓰기 금지 규칙 — 동기화는 effect에서, cbRef와 동일 패턴)
  const levelRef = useRef(level);
  const recordingRef = useRef(recording);
  const phaseRef = useRef<Phase>('idle');
  const cbRef = useRef({ onPressHoldStart, onHoldEnd, onHoldAbort, onSendAck, onOpenKeyboard, ackActive, t, pending, onEdit, onPhoto, onFile });
  useEffect(() => {
    levelRef.current = level;
    recordingRef.current = recording;
    phaseRef.current = phase;
    cbRef.current = { onPressHoldStart, onHoldEnd, onHoldAbort, onSendAck, onOpenKeyboard, ackActive, t, pending, onEdit, onPhoto, onFile };
  });

  useEffect(() => () => {
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    if (rafRef.current && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafRef.current);
  }, []);

  // 힌트 알약: 3초 후 페이드 → 영구 소거(잔류 0)
  useEffect(() => {
    if (hintSeen) return;
    const fade = setTimeout(() => Animated.timing(hintOpacity, {
      toValue: 0, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ }
      setHintSeen(true);
    }), 3000);
    return () => clearTimeout(fade);
  }, [hintSeen, hintOpacity]);

  // 녹음 글로우 호흡 — holding 동안만 루프, 종료 시 정지+리셋(잔상 금지)
  useEffect(() => {
    if (phase !== 'holding') { pulse.stopAnimation(); pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0.25, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  // t_2eea055a: 홀드 경과 라이브 카운터 — holding 동안만 250ms tick, 이탈 시 즉시 리셋(잔상 금지)
  useEffect(() => {
    if (phase !== 'holding') { setElapsedMs(0); return; }
    const tick = () => setElapsedMs(Date.now() - holdStartRef.current);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase]);

  // sine 리본 — rAF, 지수 감쇠(상승이 하강보다 빠름), 3겹(100/60/35%), 초록 단색, bg 투명(#318)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const host = ribbonHostRef.current as unknown as HTMLElement | null;
    if (!host) return;
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.style.display = 'block';
      canvas.setAttribute('aria-hidden', 'true');
      host.appendChild(canvas);
      canvasRef.current = canvas;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.round(RIBBON_W * dpr);
    canvas.height = Math.round(RIBBON_H * dpr);
    canvas.style.width = `${RIBBON_W}px`;
    canvas.style.height = `${RIBBON_H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return () => {
      if (canvasRef.current && canvasRef.current.parentNode) canvasRef.current.parentNode.removeChild(canvasRef.current);
      canvasRef.current = null;
    };
  }, [phase !== 'idle']); // eslint-disable-line react-hooks/exhaustive-deps -- 리본 마운트/언마운트는 phase 전환 시 1회

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof requestAnimationFrame === 'undefined') return;
    if (phase !== 'holding') return;
    const canvas = canvasRef.current;
    const ctx = canvas && canvas.getContext('2d');
    if (!canvas || !ctx) return;
    let smooth = 0;
    let t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let raf = 0;
    const draw = (now: number) => {
      const dt = Math.min(64, now - t0); t0 = now;
      const target = recordingRef.current && phaseRef.current === 'holding' ? levelRef.current : 0;
      const k = target > smooth ? 1 - Math.exp(-0.012 * dt) : 1 - Math.exp(-0.005 * dt); // 지수 감쇠 — 급등락 없음
      smooth += (target - smooth) * k;
      const time = now / 1000;
      const mid = RIBBON_H / 2;
      const base = 2.5; // 잔물결 floor — 무음에도 "받고는 있다"(#318)
      const amp = base + smooth * (mid - base - 2);
      ctx.clearRect(0, 0, RIBBON_W, RIBBON_H);
      if (phaseRef.current === 'holding') {
        for (let i = 0; i < 3; i++) {
          const opacity = [1, 0.6, 0.35][i]; // 리본 3개 겹침 깊이감 (#318)
          const freq = 0.035 - i * 0.006;
          ctx.beginPath();
          for (let x = 0; x <= RIBBON_W; x += 2) {
            const env = Math.sin((x / RIBBON_W) * Math.PI); // 양끝 0 → 중앙 최대
            const y = mid + Math.sin(x * freq + time * (3 + i * 0.7) + i * 0.9) * amp * env * (1 - i * 0.18);
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = colors.accent;
          ctx.globalAlpha = opacity * (0.35 + smooth * 0.65);
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);
    rafRef.current = raf;
    return () => {
      cancelAnimationFrame(raf);
      if (rafRef.current === raf) rafRef.current = 0;
      ctx.clearRect(0, 0, RIBBON_W, RIBBON_H); // 소멸 프레임 — 잔상 금지
    };
  }, [phase]);

  const finishDone = useCallback(() => {
    setPhase('done');
    doneOpacity.setValue(1);
    Animated.timing(doneOpacity, { toValue: 0, duration: DONE_MS, easing: Easing.linear, useNativeDriver: false }).start();
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    doneTimerRef.current = setTimeout(() => { setPhase('idle'); doneTimerRef.current = null; }, DONE_MS);
  }, [doneOpacity]);

  // ── t_2f296081 ③ (대표님 10/4): 키보드 PTT(pttKey) 합성 홀드 시각화 ──────────────
  // B 계층 입력창 포커스 중 V 타격 = capture가 press() 승격 + B→A 즉시 전환 — 이 스테이지는
  // 그랜트(touch) 없이 externalHolding(ptt.active)만으로 마운트된다. true→합성 holding(링+리본+
  // 타이머), false→제자리 릴리스와 동일 finishDone(체크 후 idle). 터치 홀드 진행 중(startedRef)엔
  // 무영 — 제스처 계약(#311/#316)과 발화 경로(onHoldEnd/onHoldAbort는 touch 전용) 불변, 이중 talk.end 없음.
  const syntheticRef = useRef(false);
  useEffect(() => {
    if (externalHolding && !startedRef.current && !syntheticRef.current && phase === 'idle' && !doneTimerRef.current) {
      syntheticRef.current = true;
      holdStartRef.current = Date.now(); // 타이머 기준 = 합성 그랜트 시각(±수 ms, 표시용)
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ }
      setPhase('holding');
    } else if (!externalHolding && syntheticRef.current) {
      syntheticRef.current = false;
      if (phase === 'holding') finishDone();
    }
  }, [externalHolding, phase, finishDone]);

  // panHandlers를 state로 관리 (렌더 중 ref 접근 방지 — JoystickMic 패턴)
  const [panHandlers, setPanHandlers] = useState<GestureResponderHandlers>({});
  useEffect(() => {
    const responder = PanResponder.create({
    // 수직 2분할: 상부 스크롤/탭 영역은 FlatList가 전량 소유 — 스트립 안에서만 발동, 링 미발동(#311).
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // 강화 캡처: ↑ 스티어링으로 리스트 영역에 손이 들어가도 FlatList의 TerminationRequest를
    // 거부 — 그랜트 후 이동은 스테이지 소유(제스처 계약), 릴리스/터미네이트로만 종료.
    // (PanResponder config 키 = onPanResponderTerminationRequest → raw onResponderTerminationRequest)
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      startedRef.current = true;
      holdStartRef.current = Date.now(); // t_2eea055a 카운터 기준 시각 (그랜트 = 녹음 시작)
      gestureRef.current = null;
      escapedRef.current = false;
      setUpTarget(false);
      setPhase('holding');
      // 스트립 경계(client px)를 그랜트 시점 1회 스냅샷 — 이탈 판정 기준
      const node = stripRef.current as unknown as { getBoundingClientRect?: () => DOMRect } | null;
      const rect = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      // moveX/moveY는 page 좌표 — body 스크롤이 있는 환경에서도 비교되도록 page 기준으로 환산
      const sx = typeof window !== 'undefined' ? window.scrollX || 0 : 0;
      const sy = typeof window !== 'undefined' ? window.scrollY || 0 : 0;
      boxRef.current = rect ? { left: rect.left + sx, right: rect.right + sx, bottom: rect.bottom + sy } : null;
      // 힌트 즉시 소거 — 링이 떠 있는 동안 알약 중복 노출 금지
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ }
      cbRef.current.onPressHoldStart(); // 권한 첫 누름 시점 (계약 불변)
    },
    onPanResponderMove: (_evt, gs) => {
      if (!startedRef.current) return;
      const { dx, dy } = gs;
      lastDragRef.current = { dx, dy }; // t_08d671a8: 릴리스 시 액션 결정용
      // 좌·우·하단 완전 이탈 = 폐기 후보. ↑ 이탈은 DIR_UP 스냅(30px) 후라 keyboard 경로가 우선.
      const box = boxRef.current;
      if (box && (gs.moveX < box.left - ESCAPE || gs.moveX > box.right + ESCAPE || gs.moveY > box.bottom + ESCAPE)) escapedRef.current = true;
      const g = getDirection(dx, dy);
      // t_08d671a8: 5방향 액션 계산 — 나침반 강조용 (패드 반경 = STAGE_RING/2)
      const action = selectActionFromVector(dx, dy, STAGE_RING / 2);
      setActiveAction(action === 'send' ? null : action);
      if (!g || g === gestureRef.current) return;
      gestureRef.current = g;
      setUpTarget(g === 'DIR_UP');
      // 예/아니요 힌트 (t_64e3edd6 ③): 재질문 활성 시 좌/우 방향 = 즉시 '예'/'아니요' 표시(arm 타이머 폐지).
      // 비활성 시 좌우 이동은 평범한 홀드(send) — 음성은 무확인 진행(#324).
      setAckHint(cbRef.current.ackActive ? ackPhraseForDirection(g) : null);
    },
    onPanResponderRelease: () => {
      if (!startedRef.current) return;
      startedRef.current = false;
      const g = gestureRef.current;
      const ack = g ? ackPhraseForDirection(g) : null;
      setAckHint(null);
      setUpTarget(false);
      setActiveAction(null); // t_08d671a8: 나침반 강조 리셋

      // t_08d671a8: 5방향 액션 결정 — 패드 밖 완전 이탈은 cancel (의도치 않은 photo 오픈 방지)
      const { dx, dy } = lastDragRef.current;
      const action = escapedRef.current ? 'cancel' : selectActionFromVector(dx, dy, STAGE_RING / 2);

      // t_5058e15f ②: 미시작(pending) 홀드의 릴리스 = holdStart 계약 — send는 cancel로 강등(전송 위장 금지).
      const notCapturedYet = cbRef.current.pending && !recordingRef.current;

      // ack 모드 (레거시 호환 — ackActive 시 좌/우)
      if (cbRef.current.ackActive && ack) {
        cbRef.current.onHoldAbort();
        cbRef.current.onSendAck(cbRef.current.t(ack === 'yes' ? 'chat.ackYes' : 'chat.ackNo'));
        finishDone();
      } else if (action === 'keyboard') {
        cbRef.current.onHoldAbort();
        cbRef.current.onOpenKeyboard();
        setPhase('idle');
      } else if (action === 'cancel') {
        cbRef.current.onHoldAbort();
        setPhase('idle');
      } else if (action === 'edit' && cbRef.current.onEdit) {
        // t_616e9abf →편집 실행 배선: 릴리스는 onEdit(ptt.endHoldDraft = audio.end{draft:true}) 단독 —
        // onHoldEnd(audio.end 무draft)를 병행 호출하면 전사 즉시 user 행 영속+턴 실행(위장전송,
        // t_55e92e7e 결정2 위반). 백엔드(t_8bac5645)는 draft 회신 transcript.draft만 보낸다.
        cbRef.current.onEdit();
        finishDone();
      } else if (action === 'photo' && cbRef.current.onPhoto) {
        // ↓ 사진첨부
        cbRef.current.onHoldAbort();
        cbRef.current.onPhoto();
        setPhase('idle');
      } else if (action === 'file' && cbRef.current.onFile) {
        // ↗ 파일첨부
        cbRef.current.onHoldAbort();
        cbRef.current.onFile();
        setPhase('idle');
      } else if (action === 'edit') {
        // t_55e92e7e: → 편집 = 의도 있는 섹터인데 실행 콜백 미장착(onEdit 온보드 갭)이면
        // 폐기(cancel). send 폴백 금지 — 편집 의도의 릴리스가 녹음을 전송하는 비가역 위장
        // 실행이 된다(arm 배너는 supported 게이트로 미표시 중 — 화면/실행 일치 유지).
        cbRef.current.onHoldAbort();
        setPhase('idle');
      } else if (notCapturedYet) {
        // pending 상태에서 send 의도 = cancel 강등
        cbRef.current.onHoldAbort();
        setPhase('idle');
      } else {
        // 센터 유지 릴리스 = 전송
        cbRef.current.onHoldEnd();
        finishDone();
      }
      gestureRef.current = null;
      escapedRef.current = false;
      lastDragRef.current = { dx: 0, dy: 0 };
    },
    onPanResponderTerminate: () => {
      if (!startedRef.current) return;
      startedRef.current = false;
      setAckHint(null);
      setUpTarget(false);
      setActiveAction(null);
      cbRef.current.onHoldAbort(); // 시스템 인터럽트 = 폐기(전송 없음)
      setPhase('idle');
    },
    });
    setPanHandlers(responder.panHandlers);
  }, [finishDone]);

  // t_08d671a8 인체공학: 그립 손에 따른 패드 수평 위치 (left 백분율)
  const gripLeftPercent = gripHand === 'left' ? '25%' : gripHand === 'right' ? '75%' : '50%';

  // t_55e92e7e ②: arm 재확인 배너 라벨 — 순수 판정(단위테스트: armedCompassLabelKey).
  // supported = 실행 콜백이 실제 장착된 액션만 ('놓으면 실행' 약속의 진실성 게이트 — 콜백 없으면
  // release는 send로 폴백하므로 배너가 거짓이 된다. onEdit 미배선(t_08d671a8 갭) 후속 카드까지 edit 억제).
  const armedActions: StageAction[] = ['keyboard', 'cancel',
    ...(onEdit ? (['edit'] as StageAction[]) : []),
    ...(onPhoto ? (['photo'] as StageAction[]) : []),
    ...(onFile ? (['file'] as StageAction[]) : [])];
  const armedLabelKey = armedCompassLabelKey({ ackActive: !!ackActive, ackPhrase: ackHint, activeAction, supported: armedActions });
  // t_55e92e7e ①: 진입된 나침반 항목의 인라인 라벨 — ackActive 좌/우 실행 우선순위 반영(순수 판정: inlineCompassLabelKey).
  const inlineLabelFor = (itemAction: StageAction): string | null =>
    inlineCompassLabelKey({ ackActive: !!ackActive, ackPhrase: ackHint, activeAction, itemAction });

  const holding = phase === 'holding';

  return (
    <View
      ref={sealStripRef}
      pointerEvents="box-none"
      style={[styles.strip, { height }]}
      testID="voice-stage"
    >
      {/* t_08d671a8 인체공학 상단 클러스터: 가이드·타이머·녹음상태를 스트립 상단 중앙에 배치 — 손가락에 가려지지 않는 위치.
          box-none 직계자식 pointer-events:auto 자동 주입(RNW) 우회: 이 클러스터에 명시 pointerEvents:'none'. */}
      <View testID="voice-stage-compass" style={styles.topCluster} pointerEvents="none">
        {/* 첫 진입 힌트 알약 — 상단 중앙, 3s 후 페이드 (대표님 10/4: "희미하게") */}
        {!hintSeen && phase === 'idle' && !error && (
          <Animated.View testID="voice-stage-hint" style={[styles.hintPillTop, { opacity: hintOpacity }]}>
            <Text style={styles.hintText}>{t('chat.voiceStageHint')}</Text>
          </Animated.View>
        )}
        {/* 권한 거부 폴백 안내 */}
        {!!error && phase === 'idle' && (
          <Text testID="chat-voice-fallback" style={styles.fallbackTextTop}>{t(error)}</Text>
        )}
        {/* t_08d671a8 5방향 나침반 가이드 — 홀드 중 표시, 현재 방향 강조.
            t_55e92e7e (대표님 10/10): 방향 진입 순간 그 섹터의 동작을 글자로 표시 — 진입된 화살표
            옆에 인라인 라벨(arm 상태 = 강조+글자, 비진입 = 화살표만 희미). 섹터 판정은
            onPanResponderMove의 selectActionFromVector(±30° 경계) 결과(activeAction) 단일 소스 reuse —
            신규 각도 계산 없음. 상단 클러스터(히트 앵커 voice-stage-pad 계약 불변) 내 render —
            손가락 도달대(뷰포트 ~80%) 밖이라 가림 없음, #mat-callout 서브트리(user-select none 상속). */}
        {holding && (
          <View testID="voice-compass-row" style={styles.compassRow}>
            {COMPASS_DIRECTIONS.map((d) => (
              <Text
                key={d.action}
                testID={`compass-${d.action}`}
                style={[styles.compassItem, activeAction === d.action && styles.compassActive]}
              >
                {d.arrow}
                {inlineLabelFor(d.action) ? ` ${t(inlineLabelFor(d.action)!)}` : ''}
              </Text>
            ))}
          </View>
        )}
        {/* t_55e92e7e ②: arm 상태(현재 선택 방향) = 실행 예정 동작 글자 재확인 — joystick-ack-armed
            패턴 계승(accent bold '놓으면 실행' 문구). 상단 클러스터 인-flow(링 하단 absolute와 달리
            자식 정렬 순 유지). 비-arm(센터/deadzone=send) 시 미표시 — 전송은 기본 동작이라 라벨 없음.
            ackActive(재질문 행) + 좌/우 끝에서는 release 실행 우선순위(stageReleaseOutcome)가 ack
            문장(예/아니요)이므로 armedCompassLabelKey가 그 판정을 그대로 반영 — 화면/실행 불일치 금지. */}
        {holding && !!armedLabelKey && (
          <Text testID={`compass-label-${activeAction}`} style={styles.compassArmConfirm}>
            {t(armedLabelKey)}
            {' — '}
            {t('chat.joystickArmRelease')}
          </Text>
        )}
        {/* 타이머 (대표님 10/4: 손가락이 덮어도 시간 보임 → 상단) */}
        {holding && (recording || !pending) && (
          <Text testID="voice-stage-timer" style={styles.topTimer}>{formatRecordingDuration(elapsedMs)}</Text>
        )}
        {/* 녹음 중 / 연결 중 안내 — 상단 클러스터 */}
        {pending && !recording && (
          <Text testID="voice-stage-connecting" style={styles.topRecStatus}>{t('chat.connecting')}</Text>
        )}
        {holding && (recording || !pending) && (
          <Text testID="voice-stage-recording" style={styles.topRecStatus}>{t('chat.pttRecording')}</Text>
        )}
      </View>
      {/* t_f8c40db0 (대표님 9/30): 스트립은 패스-쓰루 레이아웃 박스뿐 — 홀드 히트 = 서클 패드(96px) 한정.
          원 밖 터치/드래그는 배후 FlatList가 그대로 받아 전역 스크롤 가능(#311 레이아웃·제스처 계약 불변).
          RNW box-none 컴파일 = '.strip>*{pointer-events:auto!important}' — 직계자식 전역(atomic) 클래스와
          특선·순서 승부가 모듈 로딩 순에 좌우됨(불안정). 회피: 패드 내부 장식에 명시 pointer-events:none. */}
      <View
        {...panHandlers}
        testID="voice-stage-pad"
        accessibilityLabel={t('chat.voiceStageHint')}
        style={[styles.pad, { left: gripLeftPercent }]}
      >
        {phase !== 'idle' && (
          <View testID="voice-stage-ring" style={[styles.ring, { left: gripLeftPercent }]}>
            <Animated.View testID="voice-stage-pulse" style={[styles.pulse, {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] }) }],
            }]} />
            {/* 리본: 링 상부 손가락 위 — canvas는 effect가 DOM 부착 (#316 '링 내부 또는 상부') */}
            <View ref={ribbonHostRef} testID="voice-stage-ribbon" style={styles.ribbonWrap} />
            {ackHint && (
              <Text testID="joystick-ack-armed" style={styles.armedText}>
                {t(ackHint === 'yes' ? 'chat.ackHoldArmedYes' : 'chat.ackHoldArmedNo')}
              </Text>
            )}
            {phase === 'done' && (
              <Animated.View testID="voice-stage-done" style={[styles.doneBadge, { opacity: doneOpacity }]}>
                <Text style={styles.doneCheck}>✓</Text>
              </Animated.View>
            )}
          </View>
        )}
        <View testID="voice-stage-mic" style={[styles.micDisc, upTarget && styles.micDiscUp]}>
          <MicIcon size={Math.max(16, Math.round(MIC_BUTTON * 0.52))} color={colors.onPrimary} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute', left: 0, right: 0, bottom: 0, // 0-호스트 위 상방 성장 — 흐름 높이 0(#311 패딩 계약은 화면)
    backgroundColor: 'transparent',  // 투명 스트립 — 채팅 배후 비침. t_f8c40db0: box-none — 원 밖은 리스트로 통과
    alignItems: 'center',
    justifyContent: 'center',
  },
  // t_08d671a8 인체공학 상단 클러스터: 손가락에 가려지지 않는 상단 중앙 — 가이드·타이머·녹음상태 배치
  topCluster: {
    position: 'absolute', top: 8, left: 0, right: 0,
    alignItems: 'center',
  },
  hintPillTop: {
    paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2,
    borderRadius: radii.full, backgroundColor: colors.surfaceRaise,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    opacity: 0.5, // 대표님 10/4: "희미하게"
  },
  fallbackTextTop: { ...typography.caption, color: colors.statusWarn, textAlign: 'center', opacity: 0.7 },
  topTimer: { ...typography.bodyBold, color: colors.accent, textAlign: 'center', lineHeight: 20, fontVariant: ['tabular-nums'], marginBottom: 2 },
  topRecStatus: { ...typography.caption, color: colors.accent, fontWeight: '600', opacity: 0.8 },
  // t_08d671a8 5방향 나침반 스타일
  compassRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  compassItem: { ...typography.body, color: colors.text2, opacity: 0.5, marginHorizontal: 8 },
  compassActive: { opacity: 0.9, color: colors.accent, fontWeight: '600' },
  // t_55e92e7e ②: arm 재확인 문구 — 상단 클러스터 인-flow, accent bold (joystick-ack-armed 계승 톤)
  compassArmConfirm: { ...typography.caption, color: colors.accent, fontWeight: '600', textAlign: 'center', marginTop: 2 },
  pad: {
    // 지문인식형 홀드 패드 (t_f8c40db0) — 링과 동일 중심·직경(96px), 대기 상태에서도 보이는 유일한 인식 원.
    // t_08d671a8 인체공학: top: PAD_TOP_PERCENT% — t_8dbb1619 10/9 30→55 하향 (뷰포트 ~80%·데드존 ≤130px)
    position: 'absolute', width: STAGE_RING, height: STAGE_RING,
    left: '50%', top: `${PAD_TOP_PERCENT}%`, marginLeft: -STAGE_RING / 2, marginTop: -STAGE_RING / 2,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.surfaceRaise + '14',
    alignItems: 'center', justifyContent: 'center',
    // t_5131cb09 (대표님 10/10): 홀드 중 텍스트 선택/브라우저 카피 Callout 봉인 — RNW는 userSelect를
    //   -webkit-user-select+user-select까지 직렬화(실측 sheet 확인). touch-callout은 RN 스타일
    //   화이트리스트 밖(RNW가 드롭)이라 여기서 불가 → 전역 CSS(#mat-callout)가 담당.
    userSelect: 'none',
  },
  hintText: { ...typography.caption, color: colors.text2 },
  ring: {
    position: 'absolute', width: STAGE_RING, height: STAGE_RING,
    // 중심 = 패드와 동일 (t_08d671a8): 스트립 상단 PAD_TOP_PERCENT%
    left: '50%', top: `${PAD_TOP_PERCENT}%`, marginLeft: -STAGE_RING / 2, marginTop: -STAGE_RING / 2,
    borderRadius: radii.full,
    borderWidth: 2, borderColor: colors.accent,
    backgroundColor: 'rgba(0,168,107,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  pulse: {
    position: 'absolute', left: -10, top: -10, right: -10, bottom: -10, // ④: -14→-10 — 축소 링(96) 비례
    borderRadius: radii.full, borderWidth: 2, borderColor: colors.accent,
  },
  ribbonWrap: { position: 'absolute', top: -RIBBON_H - 6, width: RIBBON_W, height: RIBBON_H, alignItems: 'center' },
  micDisc: {
    width: MIC_BUTTON, height: MIC_BUTTON, borderRadius: radii.full,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  micDiscUp: { backgroundColor: colors.statusWarn }, // ↑ 구간 = '키보드 전환' 안내 틴트 (#316)
  armedText: { ...typography.caption, color: colors.accent, fontWeight: '600', position: 'absolute', bottom: -26, textAlign: 'center' },
  doneBadge: {
    position: 'absolute', width: MIC_BUTTON, height: MIC_BUTTON, borderRadius: radii.full,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  doneCheck: { color: colors.onPrimary, fontSize: 18, fontWeight: '700', lineHeight: 22 }, // ④: 26→18 — 34px 디스크에 맞춤
});
