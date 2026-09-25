// Screen 11: 카드 스레드 (CardThreadScreen)
// 설계: agenttalk-screen-spec.md 화면 11 · ui-interaction-spec.md §2.3
// 결과 카드에 종속된 후속 대화 — 원본 카드가 축소 고정 참조 바로 상단에 남고, 아래에 슬랙식 Q&A가 쌓임
// 시각 언어: 좌우 말풍선 없음, 아바타+이름+시간 한 줄, 화자 구분은 이름 색상만
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { colors, radii, spacing, typography, SegmentType, segmentMeta } from '../theme';

interface ThreadMessage {
  id: string;
  speaker: string;
  isUser: boolean;
  time: string;
  content: string;
}

interface Props {
  navigation: any;
  route: any;
}

// 목업: 원본 카드 요약 (실제 구현 시 ResultCanvas에서 전달)
const MOCK_REF = {
  type: 'information' as SegmentType,
  title: '오늘 서울 날씨: 맑음, 24°C',
  detail: '결과 카드 답변 1개 · 방금',
};

const MOCK_MESSAGES: ThreadMessage[] = [
  {
    id: 'm1',
    speaker: '나',
    isUser: true,
    time: '14:32',
    content: '내일도 맑을까?',
  },
  {
    id: 'm2',
    speaker: '머스크',
    isUser: false,
    time: '14:32',
    content: '내일은 오전에 구름 많고 오후부터 맑겠습니다. 22°C 예상됩니다.',
  },
  {
    id: 'm3',
    speaker: '나',
    isUser: true,
    time: '14:33',
    content: '비 올 확률은?',
  },
  {
    id: 'm4',
    speaker: '머스크',
    isUser: false,
    time: '14:33',
    content: '강수 확률 10% 미만이에요. 우산 없이 다녀도 좋겠습니다.',
  },
];

export default function CardThreadScreen({ navigation, route }: Props) {
  const refType: SegmentType = route?.params?.refType ?? MOCK_REF.type;
  const refTitle: string = route?.params?.refTitle ?? MOCK_REF.title;
  const meta = segmentMeta(refType);

  const [messages, setMessages] = useState<ThreadMessage[]>(MOCK_MESSAGES);
  const [draft, setDraft] = useState('');

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    const now = new Date();
    const time = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    setMessages((prev) => [
      ...prev,
      {
        id: `m-${now.getTime()}`,
        speaker: '나',
        isUser: true,
        time,
        content: text,
      },
    ]);
    setDraft('');
  };

  // 화자 이름 색상: 사용자는 text-1, 에이전트는 세그먼트 식별색
  const speakerColor = (isUser: boolean) => (isUser ? colors.text1 : meta.color);

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>스레드</Text>
        <TouchableOpacity style={styles.headerButton}>
          <Text style={styles.headerButtonText}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* 원본 카드 축소 고정 참조 바 */}
      <TouchableOpacity
        style={[styles.refBar, { borderLeftColor: meta.color }]}
        onPress={() => navigation.goBack()}
        accessibilityLabel={`원본 카드: ${refTitle}`}
      >
        <View style={[styles.refIcon, { backgroundColor: meta.color }]}>
          <Text style={styles.refIconText}>{meta.icon}</Text>
        </View>
        <View style={styles.refInfo}>
          <Text style={styles.refType}>{meta.label} · 결과 카드</Text>
          <Text style={styles.refTitle} numberOfLines={1}>
            {refTitle}
          </Text>
        </View>
        <Text style={styles.refAction}>본 카드 보기 ›</Text>
      </TouchableOpacity>

      {/* 스레드 메시지 (슬랙식) */}
      <ScrollView style={styles.messageList} contentContainerStyle={styles.messageListContent}>
        {messages.map((msg) => (
          <View key={msg.id} style={styles.messageRow}>
            <View style={[styles.avatar, { backgroundColor: msg.isUser ? colors.surfaceHover : withAlpha(meta.color, 0.22) }]}>
              <Text style={[styles.avatarText, { color: msg.isUser ? colors.text2 : meta.color }]}>
                {msg.speaker[0]}
              </Text>
            </View>
            <View style={styles.messageBody}>
              <View style={styles.messageMetaRow}>
                <Text style={[styles.speakerName, { color: speakerColor(msg.isUser) }]}>
                  {msg.speaker}
                </Text>
                <Text style={styles.messageTime}>{msg.time}</Text>
              </View>
              <Text style={styles.messageContent}>{msg.content}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* 하단 입력: 후속 질문 (음성 우선, 텍스트 보조) */}
      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.micButton}>
          <Text style={styles.micIcon}>🎤</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="후속 질문 입력…"
          placeholderTextColor={colors.text3}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={!draft.trim()}
        >
          <Text style={styles.sendButtonText}>전송</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
  },
  headerButton: {
    padding: spacing.sp2,
    minWidth: 40,
  },
  headerButtonText: {
    fontSize: 20,
    color: colors.text1,
  },
  headerTitle: {
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
    color: colors.text1,
  },
  refBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaise,
    borderLeftWidth: 3,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp3,
  },
  refIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sp3,
  },
  refIconText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  refInfo: {
    flex: 1,
  },
  refType: {
    fontSize: 10,
    color: colors.text3,
    fontWeight: '600',
    marginBottom: 2,
  },
  refTitle: {
    fontSize: 14,
    color: colors.text1,
    fontWeight: '600',
  },
  refAction: {
    fontSize: 11,
    color: colors.accent,
    fontWeight: '500',
    marginLeft: spacing.sp2,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp4,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: spacing.sp4,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sp3,
    marginTop: 2,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
  },
  messageBody: {
    flex: 1,
  },
  messageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  speakerName: {
    fontSize: 13,
    fontWeight: '700',
    marginRight: spacing.sp2,
  },
  messageTime: {
    fontSize: 11,
    color: colors.text3,
  },
  messageContent: {
    fontSize: 15,
    color: colors.text1,
    lineHeight: 22,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaise,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sp2,
  },
  micIcon: {
    fontSize: 18,
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaise,
    paddingHorizontal: spacing.sp3,
    color: colors.text1,
    fontSize: 14,
  },
  sendButton: {
    marginLeft: spacing.sp2,
    paddingHorizontal: spacing.sp3,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceHover,
  },
  sendButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
});