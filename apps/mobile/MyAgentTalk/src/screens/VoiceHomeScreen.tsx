// Screen 7: 음성 우선 홈 (Voice-First Home)
// 설계: agenttalk-screen-spec.md 화면 7 · ui-interaction-spec.md §1
// 텍스트 입력창·메뉴 없음 — 중앙 조이스틱 마이크 + 상단 에이전트 스트립 + 실시간 트랜스크립트
// Phase 1: 전역 스토어 + API(REST/WS) 연동 — 실시간 트랜스크립트 · 연결 상태 뱃지
import React, { useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import JoystickMic from '../components/JoystickMic';
import MagicPad from '../components/MagicPad';
import RealtimeTranscript from '../components/RealtimeTranscript';
import { JoystickGesture } from '../types';
import { colors, radii, spacing, typography, iconSize, webScreenMotion } from '../theme';
import { useStore, setState, getState } from '../store';
import { useVoiceSession } from '../hooks/useVoiceSession';
import { useJoystickMap } from '../hooks/useJoystickMap';
import { SwipeAction } from '../lib/joystickEngine';

interface Props {
  navigation: any;
  route: any;
}

const MOCK_AGENTS = ['머스크', '르네즈미', '잡스'];
const AGENT_COLORS = [colors.accent, colors.segData, colors.segTask];

export default function VoiceHomeScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const isRecording = useStore((s) => s.isRecording);
  const transcripts = useStore((s) => s.transcripts);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const isFocused = useIsFocused();
  const { sessionId, startSession, isDemo } = useVoiceSession();
  // 사용자 매핑 — 전역 1개 맵(lib/userPrefs)에서 방향별 동작/라벨 공급 (요구 4: 전역 공통)
  // mode: 입력 장비 3모드 — joystick(기존 스틱)/pad(매직패드)/hybrid(스틱+패드 동시) (카드 t_5de18a91)
  const { map, mode, actionFor, directionLabels } = useJoystickMap();

  const [agentIndex, setAgentIndex] = React.useState(0);

  const dialogueId = route?.params?.dialogueId ?? 'new';
  const agentName = MOCK_AGENTS[agentIndex];
  const agentColor = AGENT_COLORS[agentIndex % AGENT_COLORS.length];

  // 녹음 상태를 스토어에 반영하는 동시에 — 세그먼트 히스토리 초기화
  const setRecording = (rec: boolean) => setState({ isRecording: rec });

  const addTranscript = (speaker: 'user' | 'agent', text: string, isFinal: boolean) => {
    getState().addTranscript({
      id: `${Date.now()}-${Math.random()}`,
      speaker,
      text,
      isFinal,
      timestamp: new Date(),
    });
  };

  const handleGesture = (gesture: JoystickGesture) => {
    // TAP/LONG = 녹음 고정(요구 5 — 자유매핑 대상 아님). 8방향 = 사용자 맵 실행 (요구 1/3).
    // 미할당(none)/미지원 동작은 조용히 no-op — 엔진은 기호만 emit하고 의미는 여기서 결정.
    if (gesture === 'TAP_CENTER') { setRecording(!isRecording); return; }
    if (gesture === 'LONG_CENTER') { setRecording(true); void startSession(); return; }
    switch (actionFor(gesture)) {
      case 'yes': addTranscript('user', '네, 먼저 처리해주세요.', false); break;
      case 'no': addTranscript('user', '아니요, 괜찮습니다.', false); break;
      case 'cancel': setRecording(false); break;
      case 'keyboard': navigation.navigate('Chat', {}); break; // 텍스트 전환 — 요구 6
      case 'record_stop': setRecording(false); break;
      case 'continuous_record': setRecording(true); void startSession(); break;
      case 'favorites': navigation.navigate('Favorites'); break;
      case 'open_thread': case 'send': case 'prev_segment': case 'next_segment': break; // 이 화면 컨텍스트 밖 — MVP no-op
      default: break; // none
    }
  };

  const swipeSettledRef = React.useRef(false); // 같은 릴리스 내 swipe가 이미 종결 플래그
  const handleRelease = () => {
    if (swipeSettledRef.current) { swipeSettledRef.current = false; return; }
    // 클로저 isRecording — 탭 토글 후에도 이번 렌더 기준값이라 '녹음 중 탭 종료 → 결과 전환' 유지
    if (isRecording) {
      setRecording(false);
      // 녹음 종료 후 결과 캔버스로 전환 (세션 히스토리 생성 완료 시)
      navigation.navigate('ResultCanvas', { dialogueId });
    }
  };

  // 매직패드 더블탭 = 선택 (요구 ② 어휘) — 결과 캔버스로 이동해 세그먼트 선택 모드 진입.
  // 첫 탭이 켠 녹음은 되돌리고, 같은 릴리스의 onRelease 중복 종결을 플래그로 소비한다.
  const handleDoubleTap = () => {
    swipeSettledRef.current = true;
    setRecording(false);
    navigation.navigate('ResultCanvas', { dialogueId });
  };

  // 매직패드 스와이프 계층 (t_5de18a91 요구 4) — 자유매핑과 독립된 물리 직관 동작
  const handleSwipe = (action: SwipeAction) => {
    // swipe 확정 후 같은 릴리스의 onRelease가 종결/전환을 중복 수행하지 않도록 플래그
    swipeSettledRef.current = true;
    switch (action) {
      case 'record_stop':
        setRecording(false);
        navigation.navigate('ResultCanvas', { dialogueId });
        break;
      case 'cancel': setRecording(false); break;
      case 'prev_segment': swipeSettledRef.current = false; getState().prevSegment(); break;
      case 'next_segment': swipeSettledRef.current = false; getState().nextSegment(); break;
    }
  };

  // 드래그 미세조정 (요구 5) — 스텝만큼 활성 세그먼트 이동
  const handleDragStep = (delta: number) => {
    const st = getState();
    for (let i = 0; i < Math.abs(delta); i++) {
      if (delta < 0) st.prevSegment(); else st.nextSegment();
    }
  };
  const handleDragEnd = (cancelled: boolean) => {
    if (cancelled) setRecording(false); // 그립 이탈 = 취소 의미
  };

  const switchAgent = (dir: 1 | -1) => {
    setAgentIndex((prev) => (prev + dir + MOCK_AGENTS.length) % MOCK_AGENTS.length);
  };

  // 세그먼트 히스토리 목업 — 결과 캔버스 연결 (Phase 1 오프라인 데모)
  // 포커스 중일 때만 시드 — 결과 캔버스가 열려 있으면(스택 위) 스트림이 히스토리를 덮어쓰지 않도록
  // isFocused 는 ref 로 보관하여 의존성 배열에 넣지 않음 (트랜스크립트 도착 타이밍 기준 동작 유지)
  const isFocusedRef = useRef(isFocused);
  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  useEffect(() => {
    if (!isFocusedRef.current) return;
    if (transcripts.length === 0) return;
    const last = transcripts[transcripts.length - 1];
    if (!last.isFinal || last.speaker !== 'user') return;
    const st = getState();
    if (!st.setSegmentHistory) return;
    // 데모: 최근 발화 → 결과 세그먼트 3종 생성
    st.setSegmentHistory([
      { id: 'seg-msg-1', type: 'information', label: '첫 답변', isNew: false, summary: last.text },
      { id: 'seg-msg-2', type: 'data', label: '정리', isNew: true, summary: `${last.text} (요약)` },
    ]);
  }, [transcripts]);

  return (
    <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
      {/* 상단: 에이전트 아바타 스트립 + 설정 */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.agentStrip}
          accessibilityLabel={`현재 에이전트: ${agentName}`}
        >
          <View style={[styles.agentDot, { backgroundColor: agentColor }]} />
          <Text style={styles.agentName}>{agentName}</Text>
          <TouchableOpacity onPress={() => switchAgent(1)} style={styles.agentSwitch}>
            <Text style={styles.agentSwitchText}>⇄</Text>
          </TouchableOpacity>
        </TouchableOpacity>

        <View style={styles.topRight}>
          {/* 연결 상태 뱃지 */}
          <View
            style={[
              styles.statusBadge,
              connectionStatus === 'connected'
                ? styles.statusOk
                : connectionStatus === 'connecting'
                ? styles.statusWarn
                : styles.statusIdle,
            ]}
          >
            {isDemo && <Text style={styles.statusText}>데모</Text>}
            {!isDemo && (
              <Text style={styles.statusText}>
                {connectionStatus === 'connected'
                  ? '연결됨'
                  : connectionStatus === 'connecting'
                  ? '연결 중…'
                  : '대기'}
              </Text>
            )}
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings')}
            style={styles.settingsButton}
            accessibilityLabel="설정"
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 실시간 트랜스크립트 영역 */}
      <View style={styles.transcriptArea}>
        <RealtimeTranscript transcripts={transcripts} isRecording={isRecording} />
        {sessionId && !isDemo && (
          <Text style={styles.sessionMeta}>세션 {sessionId.slice(0, 8)}</Text>
        )}
      </View>

      {/* 입력 장비 — 모드별 렌더 (joystick: 기존 스틱 / pad·hybrid: 매직패드 계층) */}
      <View style={styles.joystickArea}>
        {mode === 'joystick' ? (
          <JoystickMic
            onGesture={handleGesture}
            onRelease={handleRelease}
            isRecording={isRecording}
            directionLabels={directionLabels()}
          />
        ) : (
          <MagicPad
            variant={mode === 'hybrid' ? 'hybrid' : 'pad'}
            onGesture={handleGesture}
            onSwipe={handleSwipe}
            onDoubleTap={handleDoubleTap}
            onDragStep={handleDragStep}
            onDragEnd={handleDragEnd}
            onRelease={handleRelease}
            isRecording={isRecording}
            directionLabels={directionLabels()}
          />
        )}
        <Text style={styles.hintText}>
          {isRecording
            ? t('voice.recordingHint')
            : mode === 'joystick'
            ? t('voice.idleHint')
            : t('voice.padHint')}
        </Text>
        {/* 방향 힌트 — 사용자 맵의 좌/우 할당 동작명 표시 (비할당이면 히든) */}
        {!isRecording && (map.DIR_LEFT !== 'none' || map.DIR_RIGHT !== 'none') && (
          <View style={styles.gestureHints}>
            <Text style={styles.gestureHintLeft}>{map.DIR_LEFT === 'none' ? '' : `← ${t(`joystick.actions.${map.DIR_LEFT}`)}`}</Text>
            <Text style={styles.gestureHintRight}>{map.DIR_RIGHT === 'none' ? '' : `${t(`joystick.actions.${map.DIR_RIGHT}`)} →`}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp3,
    paddingBottom: spacing.sp2,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
  },
  agentStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp1 + 2,
  },
  agentDot: {
    width: 24,
    height: 24,
    borderRadius: radii.full,
    marginRight: spacing.sp2,
  },
  agentName: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text1,
  },
  agentSwitch: {
    marginLeft: spacing.sp2,
    paddingHorizontal: spacing.sp1,
  },
  agentSwitchText: {
    ...typography.body,
    color: colors.text2,
  },
  statusBadge: {
    paddingHorizontal: spacing.sp2,
    paddingVertical: 3,
    borderRadius: radii.full,
  },
  statusOk: {
    backgroundColor: 'rgba(22,163,74,0.12)',
  },
  statusWarn: {
    backgroundColor: 'rgba(217,119,6,0.12)',
  },
  statusIdle: {
    backgroundColor: colors.surfaceRaise,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusText: {
    ...typography.micro,
    fontWeight: '700',
    color: colors.text2,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    ...typography.headline,
    fontSize: iconSize.glyph,
    color: colors.text2,
  },
  transcriptArea: {
    flex: 1,
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp3,
  },
  sessionMeta: {
    ...typography.microSm,
    fontWeight: '400',
    color: colors.text3,
    textAlign: 'center',
    marginBottom: 4,
  },
  joystickArea: {
    alignItems: 'center',
    // 대표님 지시 9/26 — 엄지 자연 위치: 입력 클러스터를 하단 중앙에 두고 안전영역(SafeAreaView inset) 위
    // 16~24px(여기 20px) 간격. PC 웹(3패널)에서는 좌우가 넓어져도 클러스터는 중앙 정렬·패드는 380px 상한 유지.
    paddingBottom: spacing.sp5,
    paddingTop: spacing.sp4,
  },
  hintText: {
    ...typography.subhead,
    color: colors.text3,
    marginTop: spacing.sp4,
    textAlign: 'center',
  },
  gestureHints: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '72%',
    marginTop: spacing.sp2,
  },
  gestureHintLeft: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.segTask,
  },
  gestureHintRight: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.statusErr,
  },
});