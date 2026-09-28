// 채팅 음성 콘솔 (t_e735d936 요구 1/2) — 웹 모바일 채팅 진입의 1차 입력 UI.
// 대표님 9/28 새벽 슛: "일단 음성기능이 먼저 떠주고, 조이스틱으로 누른상태에서 위로 올리면 키보드 나오게".
// - 조이스틱 홀드-투-톡: touchstart(그랜트)에서 녹음 시작 — 마이크 권한(getUserMedia)은 이 제스처
//   시점에 처음으로 요구된다. 페이지 로드 중에는 어떤 권한 다이얼로그도 발생하지 않는다(코드 확인:
//   src 전체에서 getUserMedia 호출부는 usePushToTalk.startCapture 하나, press/touch 경로에서만 실행).
// - 놓으면 전송(endHold→audio.end). 누른 채 위로 올려 DIR_UP(기본 'keyboard')로 빠져오면
//   음성 폐기(audio.cancel) + 텍스트 입력(키보드) 열기. '취소' 방향도 폐기. 나머지 방향/탭 = 발화 전송.
// - 음성 상태 표시: JoystickMic 내장 초록 링 + 웨이브폼, 하단 PttBanner(화면 유지) 재사용.
// - 권한 거부/실패(error) 시 폴백 안내 한 줄 — 화면이 입력창을 자동 열어 텍스트만으로 완전 작동.
// - 키보드 진입 버튼: 제스처 미숙련자/디스커버리용 동일 기능 버튼(우측).
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import JoystickMic from './JoystickMic';
import { KeyboardIcon } from './Icon';
import { JoystickGesture } from '../types';
import { colors, radii, spacing, typography, iconSize } from '../theme';
import { ACK_HOLD_MS, ackPhraseForDirection, resolveArmedAck } from '../lib/ackHold';

interface Props {
  /** 홀드 시작 (touchstart — 권한 요청 지점) */
  onPressHoldStart: () => void;
  /** 릴리스 전송 (audio.end) */
  onHoldEnd: () => void;
  /** 릴리스 폐기 (audio.cancel) */
  onHoldAbort: () => void;
  /** 방향 → 사용자 맵 동작 id (useJoystickMap.actionFor) */
  actionFor: (gesture: JoystickGesture) => string | null;
  directionLabels?: Partial<Record<JoystickGesture, string>>;
  recording: boolean;
  /** errors.* 키 — 폴백 안내 한 줄 */
  error?: string | null;
  onOpenKeyboard: () => void;
  /** t_043539ff: 끝방향 0.8s 홀드 arm 후 릴리스 → '예'/'아니요' 텍스트 발화 */
  onSendAck: (text: string) => void;
}

export default function ChatVoiceConsole({
  onPressHoldStart, onHoldEnd, onHoldAbort, actionFor, directionLabels,
  recording, error, onOpenKeyboard, onSendAck,
}: Props) {
  const { t } = useTranslation();
  // 그랜트~릴리스 사이 최종 방향 추적 — onGesture(확정)/onRelease(판정) 계약 안에서만 소비.
  const gestureRef = useRef<JoystickGesture | null>(null);
  const startedRef = useRef(false);
  // ── 예/아니요 홀드-arm (t_043539ff, 대표님 9/28 차선안 병행) ──
  // 좌/우 끝방향 스냅 확정 시점부터 ACK_HOLD_MS 유지 → armed(배너 표시) → 릴리스 시 음성 폐기+텍스트 발화.
  // 얕은 스와이프(<0.8s)는 arm 전 해제 → 기존 커스텀 매핑 경로 보존(↑ 매핑 충돌 없음, 카드 #2).
  const candidateRef = useRef<JoystickGesture | null>(null);
  const armedRef = useRef<JoystickGesture | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [armedAck, setArmedAck] = useState<'yes' | 'no' | null>(null);
  const clearArm = () => {
    if (armTimerRef.current) { clearTimeout(armTimerRef.current); armTimerRef.current = null; }
    candidateRef.current = null;
    armedRef.current = null;
    setArmedAck(null);
  };
  useEffect(() => () => { if (armTimerRef.current) clearTimeout(armTimerRef.current); }, []);

  const handlePressStart = () => {
    gestureRef.current = null;
    startedRef.current = true;
    clearArm();
    onPressHoldStart();
  };
  const handleGesture = (g: JoystickGesture) => {
    gestureRef.current = g;
  };
  const handleDirectionChange = (d: JoystickGesture | null) => {
    // d === null은 릴리스 직전 engine 리셋 통지 — arm 판정 소비(handleRelease)를 위해 그대로 둔다.
    if (d === null) return;
    const phrase = ackPhraseForDirection(d);
    if (!phrase) {
      // 홀드 중 다른 방향(↑ 등)으로 이동 = arm 무효 — 기존 경로에 완전 복귀
      if (armTimerRef.current) { clearTimeout(armTimerRef.current); armTimerRef.current = null; }
      candidateRef.current = null;
      armedRef.current = null;
      setArmedAck(null);
      return;
    }
    if (candidateRef.current === d) return;
    candidateRef.current = d;
    armedRef.current = null;
    setArmedAck(null);
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => {
      armTimerRef.current = null;
      armedRef.current = d;
      setArmedAck(ackPhraseForDirection(d));
    }, ACK_HOLD_MS);
  };
  const handleRelease = () => {
    if (!startedRef.current) return; // 그랜트 미달 릴리스(이론상 없음) — 상태 없는 전송 금지
    startedRef.current = false;
    const g = gestureRef.current;
    gestureRef.current = null;
    // arm된 끝방향에서 그대로 릴리스 → 발화 폐기(audio.cancel) + '예'/'아니요' 텍스트 전송.
    const ack = resolveArmedAck(armedRef.current, g);
    clearArm();
    if (ack) {
      onHoldAbort();
      onSendAck(t(ack === 'yes' ? 'chat.ackYes' : 'chat.ackNo'));
      return;
    }
    const action = g ? actionFor(g) : null;
    if (action === 'keyboard' || action === 'cancel') {
      onHoldAbort();   // 발화 미전환 — 이번 소리는 서버에 보내지 않고 폐기
      if (action === 'keyboard') onOpenKeyboard(); // 요구 2: 누른 채 위로 = 키보드
    } else {
      onHoldEnd();     // 탭/롱홀드/미할당/기타 방향 = 말하기 확정 전송
    }
  };

  return (
    <View style={styles.container} testID="chat-voice-console">
      <View style={styles.consoleRow}>
        <JoystickMic
          onGesture={handleGesture}
          onRelease={handleRelease}
          onPressStart={handlePressStart}
          onDirectionChange={handleDirectionChange}
          isRecording={recording}
          directionLabels={directionLabels}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.keyboardOpen')}
          onPress={onOpenKeyboard}
          testID="chat-keyboard-button"
          style={({ pressed }) => [styles.keyboardButton, pressed && { backgroundColor: colors.surfaceHover }]}
        >
          <KeyboardIcon size={iconSize.glyph} color={colors.text2} />
        </Pressable>
      </View>
      {armedAck ? (
        <Text testID="joystick-ack-armed" style={styles.armedText}>
          {t(armedAck === 'yes' ? 'chat.ackHoldArmedYes' : 'chat.ackHoldArmedNo')}
        </Text>
      ) : error ? (
        <Text testID="chat-voice-fallback" style={styles.fallbackText}>{t(error)}</Text>
      ) : (
        <Text style={styles.hintText}>{t('chat.voiceConsoleHint')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp3,
    paddingBottom: spacing.sp4,
    alignItems: 'center',
    gap: spacing.sp2,
  },
  consoleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sp5,
    width: '100%',
  },
  keyboardButton: {
    width: spacing.sp10,
    height: spacing.sp10,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  hintText: {
    ...typography.caption,
    color: colors.text3,
    textAlign: 'center',
  },
  armedText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
    textAlign: 'center',
  },
  fallbackText: {
    ...typography.caption,
    color: colors.statusWarn,
    textAlign: 'center',
  },
});
