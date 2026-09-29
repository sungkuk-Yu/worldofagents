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
//  - 마이크 링 축소 (#321 ~60%): STAGE_RING 160→96, 마이크 디스크 56→34. 아이콘 ≥16px,
//    탭 판독 최소 44px는 스트립 전체 홀드 영역이 담당(디스크 단독 탭 버튼 아님 — 계약 불변).
// 제스처: getDirection(8방향 스냅 — JoystickMic과 동일 lib, 제스처 매핑 호환) — 벡터는 그랜트 지점 기준.
// 권한 첫 요구 = 그랜트 시점(onPressHoldStart) — 로드 중 getUserMedia 없음(계약 불변).
// 웹 모바일(voiceFirstConsole 게이트) 전용 마운트 — PC/네이티브/데모는 기존 텍스트 입력바(t_e735d936 ⑧).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, View, type GestureResponderHandlers } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { getDirection } from '../lib/gesture';
import { ackPhraseForDirection } from '../lib/ackHold';
import { stageReleaseOutcome } from '../lib/voiceStage';
import { pendingReleaseAction } from '../lib/holdStart';
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
}

type Phase = 'idle' | 'holding' | 'done';

export default function VoiceStage({ height, onPressHoldStart, onHoldEnd, onHoldAbort, onSendAck, ackActive = false, onOpenKeyboard, recording, level, error, pending }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [ackHint, setAckHint] = useState<'yes' | 'no' | null>(null);
  const [upTarget, setUpTarget] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => {
    try { return Platform.OS === 'web' && typeof localStorage !== 'undefined' && localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
  });
  const [hintOpacity] = useState(() => new Animated.Value(1));
  const [pulse] = useState(() => new Animated.Value(0));
  const [doneOpacity] = useState(() => new Animated.Value(1));

  // 제스처 상태 refs — PanResponder는 1회 생성 (JoystickMic/MagicPad 패턴)
  const startedRef = useRef(false);
  const boxRef = useRef<{ left: number; right: number; bottom: number } | null>(null);
  const stripRef = useRef<View | null>(null);
  const gestureRef = useRef<JoystickGesture | null>(null);
  const escapedRef = useRef(false);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 리본 캔버스 — RNW에서 <canvas> JSX 미지원 → 실제 DOM canvas를 effect로 부착(#318 rAF 요구)
  const ribbonHostRef = useRef<View | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  // 최신 값을 ref로 유지 — 리본 루프/콜백이 렌더 없이도 현재 상태/props를 읽는다.
  // (렌더 중 ref 쓰기 금지 규칙 — 동기화는 effect에서, cbRef와 동일 패턴)
  const levelRef = useRef(level);
  const recordingRef = useRef(recording);
  const phaseRef = useRef<Phase>('idle');
  const cbRef = useRef({ onPressHoldStart, onHoldEnd, onHoldAbort, onSendAck, onOpenKeyboard, ackActive, t, pending });
  useEffect(() => {
    levelRef.current = level;
    recordingRef.current = recording;
    phaseRef.current = phase;
    cbRef.current = { onPressHoldStart, onHoldEnd, onHoldAbort, onSendAck, onOpenKeyboard, ackActive, t, pending };
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
      // 좌·우·하단 완전 이탈 = 폐기 후보. ↑ 이탈은 DIR_UP 스냅(30px) 후라 keyboard 경로가 우선.
      const box = boxRef.current;
      if (box && (gs.moveX < box.left - ESCAPE || gs.moveX > box.right + ESCAPE || gs.moveY > box.bottom + ESCAPE)) escapedRef.current = true;
      const g = getDirection(dx, dy);
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
      // t_5058e15f ②: 미시작(pending) 홀드의 릴리스 = holdStart 계약 — send는 cancel로 강등(전송 위장 금지).
      const notCapturedYet = cbRef.current.pending && !recordingRef.current;
      const outcome = notCapturedYet
        ? pendingReleaseAction({ escaped: escapedRef.current, ackActive: cbRef.current.ackActive, gesture: g })
        : stageReleaseOutcome({ escaped: escapedRef.current, ackActive: cbRef.current.ackActive, gesture: g });
      if (outcome === 'ack' && ack) {
        cbRef.current.onHoldAbort(); // 음성 폐기 + 텍스트 발화
        cbRef.current.onSendAck(cbRef.current.t(ack === 'yes' ? 'chat.ackYes' : 'chat.ackNo'));
        finishDone();
      } else if (outcome === 'keyboard') {
        cbRef.current.onHoldAbort(); // 발화 미전환 — 폐기 후 B 계층
        cbRef.current.onOpenKeyboard();
        setPhase('idle');
      } else if (outcome === 'cancel') {
        cbRef.current.onHoldAbort();
        setPhase('idle');
      } else {
        cbRef.current.onHoldEnd();   // 탭/제자리 홀드 = 말하기 확정 전송
        finishDone();
      }
      gestureRef.current = null;
      escapedRef.current = false;
    },
    onPanResponderTerminate: () => {
      if (!startedRef.current) return;
      startedRef.current = false;
      setAckHint(null);
      setUpTarget(false);
      cbRef.current.onHoldAbort(); // 시스템 인터럽트 = 폐기(전송 없음)
      setPhase('idle');
    },
    });
    setPanHandlers(responder.panHandlers);
  }, [finishDone]);

  const holding = phase === 'holding';

  return (
    <View
      ref={stripRef}
      style={[styles.strip, { height }]}
      testID="voice-stage"
      accessibilityLabel={t('chat.voiceStageHint')}
      {...panHandlers}
    >
      {/* 첫 진입 힌트 알약 (대기 상태에서 유일한 표시, 3s 후 페이드) */}
      {!hintSeen && phase === 'idle' && !error && (
        <Animated.View pointerEvents="none" testID="voice-stage-hint" style={[styles.hintPill, { opacity: hintOpacity }]}>
          <Text style={styles.hintText}>{t('chat.voiceStageHint')}</Text>
        </Animated.View>
      )}
      {/* 권한 거부 폴백 안내 (자동 키보드 개방은 부모 ChatInputConsole 유지) */}
      {!!error && phase === 'idle' && (
        <Text testID="chat-voice-fallback" style={styles.fallbackText}>{t(error)}</Text>
      )}
      {phase !== 'idle' && (
        <View testID="voice-stage-ring" pointerEvents="none" style={styles.ring}>
          <Animated.View testID="voice-stage-pulse" style={[styles.pulse, {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] }) }],
          }]} />
          {/* 리본: 링 상부 손가락 위 — canvas는 effect가 DOM 부착 (#316 '링 내부 또는 상부') */}
          <View ref={ribbonHostRef} testID="voice-stage-ribbon" pointerEvents="none" style={styles.ribbonWrap} />
          <View testID="voice-stage-mic" style={[styles.micDisc, upTarget && styles.micDiscUp]}>
            <MicIcon size={Math.max(16, Math.round(MIC_BUTTON * 0.52))} color={colors.onPrimary} />
          </View>
          {upTarget && <Text style={styles.upLabel}>{t('chat.voiceStageToKeyboard')}</Text>}
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
      {holding && pending && !recording && (
        // t_5058e15f ②: 연결 대기 중 홀드 = 캡처 지연 시작 — '연결 중' 안내로 조용한 스킵 폐지(토스트 아닌 상태 신호).
        <Text testID="voice-stage-connecting" style={styles.recordingText}>{t('chat.connecting')}</Text>
      )}
      {holding && (recording || !pending) && <Text testID="voice-stage-recording" style={styles.recordingText}>{t('chat.pttRecording')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute', left: 0, right: 0, bottom: 0, // 0-호스트 위 상방 성장 — 흐름 높이 0(#311 패딩 계약은 화면)
    backgroundColor: 'transparent',  // 투명 스트립 — 채팅이 배후로 비침, 대기 시 콘솔 DOM 0
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintPill: {
    paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2,
    borderRadius: radii.full, backgroundColor: colors.surfaceRaise,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  hintText: { ...typography.caption, color: colors.text2 },
  fallbackText: { ...typography.caption, color: colors.statusWarn, textAlign: 'center' },
  ring: {
    position: 'absolute', width: STAGE_RING, height: STAGE_RING,
    // 중심 = 스트립 중앙 고정 (#311) — 백분율+마진이라 실측 대기 없이도 정확
    left: '50%', top: '50%', marginLeft: -STAGE_RING / 2, marginTop: -STAGE_RING / 2,
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
  upLabel: { ...typography.caption, color: colors.text1, position: 'absolute', top: -RIBBON_H - 30, fontWeight: '600' },
  armedText: { ...typography.caption, color: colors.accent, fontWeight: '600', position: 'absolute', bottom: -26, textAlign: 'center' },
  doneBadge: {
    position: 'absolute', width: MIC_BUTTON, height: MIC_BUTTON, borderRadius: radii.full,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  doneCheck: { color: colors.onPrimary, fontSize: 18, fontWeight: '700', lineHeight: 22 }, // ④: 26→18 — 34px 디스크에 맞춤
  recordingText: { ...typography.caption, color: colors.accent, fontWeight: '600', position: 'absolute', bottom: spacing.sp2 },
});
