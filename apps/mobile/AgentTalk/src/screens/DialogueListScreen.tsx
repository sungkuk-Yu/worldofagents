// Screen 6: 대화 목록 (Dialogue List)
// 설계: agenttalk-screen-spec.md 화면 2/6 패턴 — 사각 카드 + 세그먼트 식별색 뱃지
import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { Dialogue, DialogType } from '../types';
import { colors, radii, spacing, typography, segmentMeta } from '../theme';

// 임시 목업 데이터
const MOCK_DIALOGUES: Dialogue[] = [
  {
    id: '1',
    type: 'information',
    title: '오늘 서울 날씨 확인',
    createdAt: new Date('2026-09-25T09:00:00'),
    updatedAt: new Date('2026-09-25T09:30:00'),
    activeNeurons: [],
  },
  {
    id: '2',
    type: 'data',
    title: 'Q3 매출 분석 요청',
    createdAt: new Date('2026-09-25T10:00:00'),
    updatedAt: new Date('2026-09-25T10:15:00'),
    activeNeurons: [],
  },
  {
    id: '3',
    type: 'file',
    title: '계약서 검토',
    createdAt: new Date('2026-09-24T14:00:00'),
    updatedAt: new Date('2026-09-24T14:45:00'),
    activeNeurons: [],
  },
  {
    id: '4',
    type: 'task',
    title: '회식비 정산',
    createdAt: new Date('2026-09-24T11:00:00'),
    updatedAt: new Date('2026-09-24T11:30:00'),
    activeNeurons: [],
  },
];

interface Props {
  navigation: any;
}

export default function DialogueListScreen({ navigation }: Props) {
  const renderDialogue = ({ item }: { item: Dialogue }) => {
    const meta = segmentMeta(item.type as DialogType);
    return (
      <TouchableOpacity
        style={[styles.dialogueCard, { borderLeftColor: meta.color }]}
        onPress={() => navigation.navigate('VoiceHome', { dialogueId: item.id })}
        accessibilityLabel={`${meta.label} 대화: ${item.title}`}
      >
        <View style={[styles.segIcon, { backgroundColor: withAlpha(meta.color, 0.12) }]}>
          <Text style={[styles.segIconText, { color: meta.color }]}>{meta.icon}</Text>
        </View>
        <View style={styles.dialogueBody}>
          <View style={styles.dialogueHeader}>
            <Text style={[styles.dialogueType, { color: meta.color }]}>{meta.label}</Text>
            <Text style={styles.dialogueTime}>
              {item.updatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          <Text style={styles.dialogueTitle}>{item.title}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>에이전트톡</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          style={styles.settingsButton}
          accessibilityLabel="설정"
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={MOCK_DIALOGUES}
        renderItem={renderDialogue}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <Text style={styles.emptyIcon}>🎙️</Text>
            </View>
            <Text style={styles.emptyText}>대화가 없습니다</Text>
            <Text style={styles.emptySubtext}>조이스틱 마이크를 눌러 시작하세요</Text>
          </View>
        }
      />
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
    paddingTop: spacing.sp3,
    paddingHorizontal: spacing.sp4,
    paddingBottom: spacing.sp3,
  },
  headerTitle: {
    fontSize: typography.title1.fontSize,
    fontWeight: '700',
    color: colors.text1,
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
  listContent: {
    paddingHorizontal: spacing.sp4,
    paddingBottom: spacing.sp10,
    gap: spacing.sp3,
  },
  dialogueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sp4,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
  },
  segIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sp3,
  },
  segIconText: {
    fontSize: 16,
    fontWeight: '700',
  },
  dialogueBody: {
    flex: 1,
  },
  dialogueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dialogueType: {
    fontSize: 11,
    fontWeight: '700',
  },
  dialogueTime: {
    fontSize: 11,
    color: colors.text3,
  },
  dialogueTitle: {
    fontSize: 15,
    color: colors.text1,
    fontWeight: '500',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 120,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sp4,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyText: {
    fontSize: 17,
    color: colors.text2,
    fontWeight: '600',
    marginBottom: spacing.sp2,
  },
  emptySubtext: {
    fontSize: 13,
    color: colors.text3,
  },
});