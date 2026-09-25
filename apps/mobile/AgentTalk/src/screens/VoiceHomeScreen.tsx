// Screen 7: 음성 우선 홈 (Voice-First Home)
// 설계: agenttalk-screen-spec.md 화면 7 · ui-interaction-spec.md §1
// 텍스트 입력창·메뉴 없음 — 중앙 조이스틱 마이크 + 상단 에이전트 스트립 + 실시간 트랜스크립트
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import JoystickMic from '../components/JoystickMic';
import RealtimeTranscript from '../components/RealtimeTranscript';
import { JoystickGesture, Transcript } from '../types';
import { colors, radii, spacing } from '../theme';

interface Props {
  navigation: any;
  route: any;
}

const MOCK_AGENTS = ['머스크', '르네즈미', '잡스'];
const AGENT_COLORS = [colors.accent, colors.segData, colors.segTask];

export default function VoiceHomeScreen({ navigation, route }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [lastGesture, setLastGesture] = useState<JoystickGesture | null>(null);
  const [agentIndex, setAgentIndex] = useState(0);

  const dialogueId = route?.params?.dialogueId ?? 'new';
  const agentName = MOCK_AGENTS[agentIndex];
  const agentColor = AGENT_COLORS[agentIndex % AGENT_COLORS.length];

  const handleGesture = (gesture: JoystickGesture) => {
    setLastGesture(gesture);

    switch (gesture) {
      case 'TAP_CENTER':
        setIsRecording((prev) => !prev);
        break;
      case 'LONG_CENTER':
        // 푸시투톡: 누르는 동안 녹음
        setIsRecording(true);
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
        setIsRecording(false);
        break;
      default:
        console.log('[VoiceHome] 커스텀 제스처:', gesture);
    }
  };

  const addTranscript = (speaker: 'user' | 'agent', text: string, isFinal: boolean) => {
    setTranscripts((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        speaker,
        text,
        isFinal,
        timestamp: new Date(),
      },
    ]);
  };

  const handleRelease = () => {
    if (lastGesture === 'LONG_CENTER') {
      setIsRecording(false);
      // 녹음 종료 후 결과 캔버스로 전환
      navigation.navigate('ResultCanvas', { dialogueId });
    }
  };

  const switchAgent = (dir: 1 | -1) => {
    setAgentIndex((prev) => (prev + dir + MOCK_AGENTS.length) % MOCK_AGENTS.length);
  };

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
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          style={styles.settingsButton}
          accessibilityLabel="설정"
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* 실시간 트랜스크립트 영역 */}
      <View style={styles.transcriptArea}>
        <RealtimeTranscript transcripts={transcripts} isRecording={isRecording} />
      </View>

      {/* 중앙 조이스틱 마이크 */}
      <View style={styles.joystickArea}>
        <JoystickMic
          onGesture={handleGesture}
          onRelease={handleRelease}
          isRecording={isRecording}
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