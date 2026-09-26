// 실시간 트랜스크립트 (RealtimeTranscript)
// 설계: agenttalk-screen-spec.md 화면 7 (2026-08-18 추가)
// 듣는 중/응답 중 마이크 아래에 사용자 발화 + 에이전트 응답 텍스트를 실시간 노출
// 대화 종료 후 사라짐 (채팅 로그로 쌓이지 않음) — 화자 구분은 말풍선이 아니라 색상·굵기 차이
import React, { useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Transcript } from '../types';
import { colors, radii, spacing, typography } from '../theme';

interface Props {
  transcripts: Transcript[];
  isRecording: boolean;
}

export default function RealtimeTranscript({ transcripts, isRecording }: Props) {
  const { t } = useTranslation();
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    // 새 트랜스크립트 추가 시 자동 스크롤
    if (transcripts.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [transcripts]);

  if (transcripts.length === 0 && !isRecording) {
    return (
      <View style={styles.placeholder}>
        <View style={styles.placeholderIconWrap}>
          <Text style={styles.placeholderIcon}>🎙️</Text>
        </View>
        <Text style={styles.placeholderText}>{t('voice.transcriptPlaceholder')}</Text>
        <Text style={styles.placeholderSubtext}>{t('voice.transcriptSubtext')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {transcripts.map((item) => (
        <View
          key={item.id}
          style={[
            styles.transcriptCard,
            item.speaker === 'agent' ? styles.agentCard : styles.userCard,
          ]}
        >
          <Text
            style={[
              styles.speakerLabel,
              item.speaker === 'agent' ? styles.agentLabel : styles.userLabel,
            ]}
          >
            {item.speaker === 'agent' ? t('common.agent') : t('chat.me')}
          </Text>
          <Text
            style={[
              styles.transcriptText,
              item.speaker === 'agent' ? styles.agentText : styles.userText,
              !item.isFinal && styles.interimText,
            ]}
          >
            {item.text}
            {!item.isFinal && <Text style={styles.cursor}>|</Text>}
          </Text>
        </View>
      ))}

      {isRecording && (
        <View style={styles.recordingIndicator}>
          <ActivityIndicator size="small" color={colors.statusErr} />
          <Text style={styles.recordingText}>{t('voice.listening')}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  placeholderIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sp4,
  },
  placeholderIcon: {
    ...typography.title1,
  },
  placeholderText: {
    ...typography.headline,
    color: colors.text1,
    marginBottom: spacing.sp2,
  },
  placeholderSubtext: {
    ...typography.subhead,
    color: colors.text3,
  },
  transcriptCard: {
    marginBottom: spacing.sp3,
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp3,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  userCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  agentCard: {
    backgroundColor: colors.surfaceRaise,
    borderColor: colors.borderStrong,
    borderLeftWidth: 3,
    borderLeftColor: colors.segInfo,
  },
  speakerLabel: {
    ...typography.micro,
    fontWeight: '700',
    marginBottom: 4,
  },
  userLabel: {
    color: colors.accent,
  },
  agentLabel: {
    color: colors.segInfo,
  },
  transcriptText: {
    ...typography.body,
  },
  userText: {
    color: colors.text1,
    fontWeight: '500',
  },
  agentText: {
    color: colors.text1,
  },
  interimText: {
    color: colors.text2,
    fontStyle: 'italic',
  },
  cursor: {
    color: colors.accent,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sp3,
    gap: spacing.sp2,
  },
  recordingText: {
    ...typography.subhead,
    color: colors.statusErr,
  },
});