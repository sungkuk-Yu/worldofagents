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
import JoystickMic from '../components/JoystickMic';
import RealtimeTranscript from '../components/RealtimeTranscript';
import { JoystickGesture } from '../types';
import { colors, radii, spacing } from '../theme';
import { useStore, setState, getState } from '../store';
import { useVoiceSession } from '../hooks/useVoiceSession';

interface Props {
  navigation: any;
  route: any;
}

const MOCK_AGENTS = ['머스크', '르네즈미', '잡스'];
const AGENT_COLORS = [colors.accent, colors.segData, colors.segTask];

export default function VoiceHomeScreen({ navigation, route }: Props) {
  const isRecording = useStore((s) => s.isRecording);
  const transcripts = useStore((s) => s.transcripts);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const isFocused = useIsFocused();
  const { sessionId, startSession, isDemo } = useVoiceSession();

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
    switch (gesture) {
      case 'TAP_CENTER':
        setRecording(!isRecording);
        break;
      case 'LONG_CENTER':
        // 푸시투톡: 누르는 동안 녹음 + API 세션 시작
        setRecording(true);
        void startSession();
        break;
      case 'DIR_LEFT':
        // 예(Yes) 응답
        addTranscript('user', '네, 먼저 처리해주세요.', false);
        break;
      case 'DIR_RIGHT':
        // 아니오(No) 응답
        addTranscript('user', '아니요, 괜찮습니다.', false);
        break;
      case 'DIR_DOWN':
        // 취소
        setRecording(false);
        break;
      default:
        console.log('[VoiceHome] 커스텀 제스처:', gesture);
    }
  };

  const handleRelease = () => {
    if (isRecording) {
      setRecording(false);
      // 녹음 종료 후 결과 캔버스로 전환 (세션 히스토리 생성 완료 시)
      navigation.navigate('ResultCanvas', { dialogueId });
    }
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
    <SafeAreaView style={styles.container}>
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

      {/* 중앙 조이스틱 마이크 */}
      <View style={styles.joystickArea}>
        <JoystickMic
          onGesture={handleGesture}
          onRelease={handleRelease}
          isRecording={isRecording}
          directionLabels={{
            DIR_LEFT: '예',
            DIR_RIGHT: '아니오',
            DIR_DOWN: '취소',
            DIR_UP: '위로',
          }}
        />
        <Text style={styles.hintText}>
          {isRecording ? '듣고 있습니다… 다시 탭하여 종료' : '탭하여 말하기 · 좌우로 예/아니오'}
        </Text>
        {/* 좌우 응답 힌트 (큐 에이뉴런 질문 대기용) */}
        {!isRecording && (
          <View style={styles.gestureHints}>
            <Text style={styles.gestureHintLeft}>← 예</Text>
            <Text style={styles.gestureHintRight}>아니오 →</Text>
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
    fontSize: 15,
    fontWeight: '700',
    color: colors.text1,
  },
  agentSwitch: {
    marginLeft: spacing.sp2,
    paddingHorizontal: spacing.sp1,
  },
  agentSwitchText: {
    fontSize: 16,
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
    fontSize: 11,
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
    fontSize: 18,
    color: colors.text2,
  },
  transcriptArea: {
    flex: 1,
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp3,
  },
  sessionMeta: {
    fontSize: 10,
    color: colors.text3,
    textAlign: 'center',
    marginBottom: 4,
  },
  joystickArea: {
    alignItems: 'center',
    paddingBottom: spacing.sp8,
    paddingTop: spacing.sp4,
  },
  hintText: {
    fontSize: 13,
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
    fontSize: 12,
    color: colors.segTask,
    fontWeight: '600',
  },
  gestureHintRight: {
    fontSize: 12,
    color: colors.statusErr,
    fontWeight: '600',
  },
});