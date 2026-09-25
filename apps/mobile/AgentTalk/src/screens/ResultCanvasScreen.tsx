// Screen 10: 결과 캔버스 (ResultCanvasScreen)
// 설계: agenttalk-screen-spec.md 화면 10 · ui-interaction-spec.md §2 · SPEC.md §5
// 채팅버블 탈피 — "그 순간 필요한 결과"가 화면 전체를 채우는 풀스크린 카드
//  상단: 세그먼트 진행바 (다음 결과로 넘어갈 수 있음)
//  중앙: 풀스크린 결과 카드 (세그먼트별 기능 컴포넌트)
//  하단: "답변 N개 · 탭해서 스레드 열기" 칩 + 세그먼트 히스토리 바 + 후속 질문 마이크
import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import InfoCard from '../components/dialogs/InfoCard';
import SpreadsheetView from '../components/dialogs/SpreadsheetView';
import FileViewer from '../components/dialogs/FileViewer';
import TaskFlowView from '../components/dialogs/TaskFlow';
import MultiAgentView from '../components/dialogs/MultiAgentView';
import SegmentHistoryBar, { SegmentHistoryEntry } from '../components/SegmentHistoryBar';
import SegmentProgressBar from '../components/SegmentProgressBar';
import JoystickMic from '../components/JoystickMic';
import { colors, radii, spacing, SegmentType, segmentMeta } from '../theme';

interface Props {
  navigation: any;
  route: any;
}

// 목업 초기 히스토리: 정보 → 데이터 → 파일 (컴포넌트 전환 스택 예시)
const INITIAL_HISTORY: SegmentHistoryEntry[] = [
  { id: 'seg-1', type: 'information', label: '날씨', isNew: false },
  { id: 'seg-2', type: 'data', label: '매출표', isNew: false },
  { id: 'seg-3', type: 'file', label: '보고서', isNew: true },
];

export default function ResultCanvasScreen({ navigation, route }: Props) {
  const [history, setHistory] = useState<SegmentHistoryEntry[]>(INITIAL_HISTORY);
  const [activeIndex, setActiveIndex] = useState(history.length - 1);
  const [isRecording, setIsRecording] = useState(false);

  const activeEntry = history[activeIndex];
  const activeType: SegmentType = activeEntry?.type ?? 'information';
  const meta = segmentMeta(activeType);

  // 좌/우 스와이프 = 이전/다음 세그먼트 (히스토리 바 연동)
  const prevSegment = () => setActiveIndex((i) => Math.max(0, i - 1));
  const nextSegment = () => setActiveIndex((i) => Math.min(history.length - 1, i + 1));

  const selectSegment = (index: number) => setActiveIndex(index);

  const removeSegment = (index: number) => {
    setHistory((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) return prev; // 마지막 세그먼트 삭제 방지
      setActiveIndex((cur) => {
        if (index < cur) return cur - 1;
        if (index === cur) return Math.min(cur, next.length - 1);
        return cur;
      });
      return next;
    });
  };

  const handleGesture = (gesture: any) => {
    if (gesture === 'TAP_CENTER') setIsRecording((prev) => !prev);
    if (gesture === 'DIR_LEFT') prevSegment();
    if (gesture === 'DIR_RIGHT') nextSegment();
    if (gesture === 'DIR_DOWN') navigation.goBack();
  };

  const renderDialogComponent = () => {
    switch (activeType) {
      case 'information':
        return <InfoCard />;
      case 'data':
        return <SpreadsheetView />;
      case 'file':
        return <FileViewer />;
      case 'task':
        return <TaskFlowView />;
      case 'multi-agent':
        return <MultiAgentView />;
      default:
        return <InfoCard />;
    }
  };

  // 스레드 칩 텍스트 (초기: 답변 1개)
  const threadCount = useMemo(() => 1 + (activeType === 'information' ? 3 : 0), [activeType]);

  const openThread = () => {
    const metaEntry = segmentMeta(activeType);
    navigation.navigate('CardThread', {
      refType: activeType,
      refTitle: `${metaEntry.label} 결과 카드`,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 상단 세그먼트 진행바 */}
      <SegmentProgressBar
        items={history.map((h) => ({ id: h.id, type: h.type }))}
        currentIndex={activeIndex}
      />

      {/* 헤더 (닫기 + 세그먼트 타이틀) */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerMarker, { color: meta.color }]}>{meta.icon} {meta.label}</Text>
        </View>
        <TouchableOpacity onPress={openThread} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* 풀스크린 결과 카드 */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.resultCard, { borderTopColor: meta.color }]}>
          {renderDialogComponent()}
        </View>

        {/* 스레드 진입 칩 */}
        <TouchableOpacity style={styles.threadChip} onPress={openThread}>
          <Text style={styles.threadChipText}>
            답변 {threadCount}개 · 탭해서 스레드 열기 ›
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 하단: 세그먼트 히스토리 바 + 후속 질문 마이크 */}
      <SegmentHistoryBar
        history={history}
        currentIndex={activeIndex}
        onSelect={selectSegment}
        onRemove={removeSegment}
        onSwipe={(dir) => (dir === 'prev' ? prevSegment() : nextSegment())}
      />

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.fab}
          onPress={openThread}
          accessibilityLabel="카드 스레드 열기"
        >
          <Text style={styles.fabIcon}>💬</Text>
        </TouchableOpacity>
        <View style={styles.micWrap}>
          <JoystickMic
            onGesture={handleGesture}
            onRelease={() => {}}
            isRecording={isRecording}
          />
        </View>
        <View style={styles.fabPlaceholder} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
  },
  headerButton: {
    padding: spacing.sp2,
    minWidth: 44,
  },
  headerButtonText: {
    fontSize: 18,
    color: colors.text2,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerMarker: {
    fontSize: 13,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp3,
    paddingBottom: spacing.sp3,
  },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 3,
    padding: spacing.sp4,
    minHeight: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 6,
  },
  threadChip: {
    alignSelf: 'center',
    marginTop: spacing.sp4,
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp2,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceRaise,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  threadChipText: {
    fontSize: 12,
    color: colors.text2,
    fontWeight: '500',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sp5,
    paddingVertical: spacing.sp2,
    backgroundColor: colors.bg,
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaise,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabIcon: {
    fontSize: 18,
  },
  micWrap: {
    alignItems: 'center',
  },
  fabPlaceholder: {
    width: 44,
    height: 44,
  },
});