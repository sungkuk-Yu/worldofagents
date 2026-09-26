// Screen 10: 결과 캔버스 (ResultCanvasScreen)
// 설계: agenttalk-screen-spec.md 화면 10 · ui-interaction-spec.md §2 · SPEC.md §5
// 채팅버블 탈피 — "그 순간 필요한 결과"가 화면 전체를 채우는 풀스크린 카드
//  상단: 세그먼트 진행바 (다음 결과로 넘어갈 수 있음)
//  중앙: 풀스크린 결과 카드 (세그먼트별 기능 컴포넌트) — 좌우 스와이프 전환 (ui-interaction-spec.md §3.2 화면 10)
//  하단: "답변 N개 · 탭해서 스레드 열기" 칩 + 세그먼트 히스토리 바 + 후속 질문 마이크
import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Animated,
  PanResponder,
  Dimensions,
  type GestureResponderEvent,
  type GestureResponderHandlers,
  type PanResponderGestureState,
} from 'react-native';
import InfoCard from '../components/dialogs/InfoCard';
import SpreadsheetView from '../components/dialogs/SpreadsheetView';
import FileViewer from '../components/dialogs/FileViewer';
import TaskFlowView from '../components/dialogs/TaskFlow';
import MultiAgentView from '../components/dialogs/MultiAgentView';
import SegmentHistoryBar, { SegmentHistoryEntry } from '../components/SegmentHistoryBar';
import SegmentProgressBar from '../components/SegmentProgressBar';
import JoystickMic from '../components/JoystickMic';
import { colors, radii, spacing, typography, iconSize, SegmentType, segmentMeta, webScreenMotion } from '../theme';
import { useStore, getState } from '../store';
import { useTranslation } from 'react-i18next';

interface Props {
  navigation: any;
  route: any;
}

// 스와이프 감지 기준 (ui-interaction-spec.md §3.1)
const SWIPE_DISTANCE = 60; // px — 이 이상 드래그하면 다음/이전 카드로 확정
const SWIPE_DIRECTION_RATIO = 1.5; // 가로가 세로보다 1.5배 우세해야 카드 스와이프
const MOVE_DISTANCE = 12; // 스와이프 시작 최소 이동

// 목업 초기 히스토리: 정보 → 데이터 → 파일 (컴포넌트 전환 스택 예시)
// 스토어가 비어 있을 때만 시드 — VoiceHome이 만든 실제 세그먼트로 즉시 교체됨
// 라벨은 렌더 시점 t()로 생성 (모듈 상수 고정 시 언어 전환 반영 실패 방지)
const makeFallbackHistory = (t: (k: string) => string): SegmentHistoryEntry[] => [
  { id: 'seg-1', type: 'information', label: t('canvas.demoWeather'), isNew: false },
  { id: 'seg-2', type: 'data', label: t('canvas.demoSales'), isNew: false },
  { id: 'seg-3', type: 'file', label: t('canvas.demoReport'), isNew: true },
];

export default function ResultCanvasScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const history = useStore((s) => s.segmentHistory);
  const activeIndex = useStore((s) => s.activeSegmentIndex);

  // 스토어가 비어 있으면 데모 히스토리로 시드 (Phase 1 오프라인 데모)
  // 렌더 중 ref 접근을 피하는useState 지연 초기화 패턴 (react-hooks/refs 대응)
  useState(() => {
    if (getState().segmentHistory.length === 0) {
      getState().setSegmentHistory(makeFallbackHistory(t));
    }
    return true;
  });

  const activeEntry = history[activeIndex];
  const activeType: SegmentType = activeEntry?.type ?? 'information';
  const meta = segmentMeta(activeType);
  const isFirst = activeIndex <= 0;
  const isLast = activeIndex >= history.length - 1;
  // PanResponder 클로저용 경계 (렌더마다 최신화 — useMemo 재생성 회피)
  const boundsRef = useRef({ isFirst, isLast });
  useEffect(() => {
    boundsRef.current = { isFirst, isLast };
  }, [isFirst, isLast]);

  // ── 카드 스와이프 전환 애니메이션 ────────────────
  const screenWidth = Dimensions.get('window').width;
  // Animated.Value 는 렌더 간 안정적인 identity 가 필요 → useState 초기화 패턴
  const [slideX] = React.useState(() => new Animated.Value(0));
  const [slideOpacity] = React.useState(() => new Animated.Value(1));
  const [slideScale] = React.useState(() => new Animated.Value(1));

  // ── 스토어 액션 (하단 히스토리 바 + 상단 진행바와 공유) ──
  // getState() 래퍼는 매 렌더 새 함수 생성 → useCallback 으로 안정화 (exhaustive-deps)
  const prevSegment = useCallback(() => getState().prevSegment(), []);
  const nextSegment = useCallback(() => getState().nextSegment(), []);
  // 탭/세그먼트 전환 = 크로스페이드만, 슬라이드 금지 (#52 — iOS 세그먼트 컨트롤).
  // swipe(commitSwipe)와 달리 translateX 없이 opacity만 페이드아웃→인덱스 변경→페이드인.
  const selectSegment = useCallback((index: number) => {
    if (getState().segmentHistory.length && index === getState().activeSegmentIndex) return;
    Animated.timing(slideOpacity, { toValue: 0, duration: 90, useNativeDriver: true }).start(() => {
      getState().selectSegment(index);
      Animated.timing(slideOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    });
  }, [slideOpacity]);
  const removeSegment = useCallback((index: number) => getState().removeSegment(index), []);

  // 최신 네비게이션/핸들러를 ref 에 유지 (PanResponder 재생성 방지)
  const navRef = useRef(navigation);
  useEffect(() => {
    navRef.current = navigation;
  }, [navigation]);

  const commitRef = useRef({ nextSegment, prevSegment });
  useEffect(() => {
    commitRef.current = { nextSegment, prevSegment };
  }, [nextSegment, prevSegment]);

  // 카드 전환 (방향 확정 후 실행) — 밀어내기 → 인덱스 변경 → 새 카드 밀어넣기
  const commitSwipe = useMemo(
    () => (direction: 'next' | 'prev') => {
      const w = screenWidth;
      const out = direction === 'next' ? -w * 0.22 : w * 0.22;
      const from = direction === 'next' ? w * 0.3 : -w * 0.3;
      Animated.parallel([
        Animated.timing(slideX, { toValue: out, duration: 130, useNativeDriver: true }),
        Animated.timing(slideOpacity, { toValue: 0.35, duration: 130, useNativeDriver: true }),
        Animated.timing(slideScale, { toValue: 0.96, duration: 130, useNativeDriver: true }),
      ]).start(() => {
        if (direction === 'next') commitRef.current.nextSegment();
        else commitRef.current.prevSegment();
        // 새 카드를 반대편에서 밀어넣기 (스프링)
        slideX.setValue(from);
        slideOpacity.setValue(0.6);
        slideScale.setValue(0.95);
        Animated.parallel([
          Animated.spring(slideX, { toValue: 0, friction: 9, tension: 70, useNativeDriver: true }),
          Animated.timing(slideOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.spring(slideScale, { toValue: 1, friction: 9, tension: 70, useNativeDriver: true }),
        ]).start();
      });
    },
    [screenWidth, slideX, slideOpacity, slideScale]
  );

  const springBack = useMemo(
    () => () => {
      Animated.parallel([
        Animated.spring(slideX, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
        Animated.spring(slideScale, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
        Animated.timing(slideOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
    },
    [slideX, slideScale, slideOpacity]
  );

  // 카드 영역 패닝 (가로 우세일 때만 카드 스와이프 — 세로는 ScrollView 스크롤 유지)
  // PanResponder 생성은 useEffect 로 이동 — 렌더 중 핸들러 생성으로 인한 react-hooks/refs 경고 회피
  const [cardPanHandlers, setCardPanHandlers] = useState<GestureResponderHandlers>({});
  useEffect(() => {
    const responder = PanResponder.create({
      onMoveShouldSetPanResponder: (_e: GestureResponderEvent, gs: PanResponderGestureState) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) * SWIPE_DIRECTION_RATIO &&
        Math.abs(gs.dx) > MOVE_DISTANCE,
      onPanResponderMove: (_e, gs) => {
        // 드래그 진행률에 따라 카드 이동 + 미세 축소/흐림 (spec §3.2 화면10 전환)
        slideX.setValue(gs.dx);
        const progress = Math.min(Math.abs(gs.dx) / (screenWidth * 0.4), 1);
        slideScale.setValue(1 - progress * 0.05);
        slideOpacity.setValue(1 - progress * 0.5);
      },
      onPanResponderRelease: (_e, gs) => {
        const { isFirst: f, isLast: l } = boundsRef.current;
        const canPrev = !f && gs.dx >= SWIPE_DISTANCE;
        const canNext = !l && gs.dx <= -SWIPE_DISTANCE;
        if (canNext) commitSwipe('next');
        else if (canPrev) commitSwipe('prev');
        else springBack();
      },
      onPanResponderTerminate: springBack,
    });
    setCardPanHandlers(responder.panHandlers);
  }, [commitSwipe, springBack, screenWidth, slideX, slideScale, slideOpacity]);

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
    navRef.current.navigate('CardThread', {
      refType: activeType,
      refTitle: t('canvas.refTitle', { label: t(`segment.type.${activeType}`) }),
    });
  };

  const handleGesture = (gesture: string) => {
    if (gesture === 'TAP_CENTER') getState().setRecording(!getState().isRecording);
    if (gesture === 'DIR_LEFT') prevSegment();
    if (gesture === 'DIR_RIGHT') nextSegment();
    if (gesture === 'DIR_DOWN') navRef.current.goBack();
  };

  const isRecording = useStore((s) => s.isRecording);

  return (
    <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-bottom')]}>
      {/* 상단 세그먼트 진행바 */}
      <SegmentProgressBar
        items={history.map((h) => ({ id: h.id, type: h.type }))}
        currentIndex={activeIndex}
      />

      {/* 헤더 (닫기 + 세그먼트 타이틀) */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navRef.current.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerMarker, { color: meta.color }]}>{meta.icon} {t(`segment.type.${activeType}`)}</Text>
        </View>
        <TouchableOpacity onPress={openThread} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* 풀스크린 결과 카드 — 좌우 스와이프 전환 */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        scrollEnabled
      >
        <View style={styles.swipeZone} {...cardPanHandlers}>
          <Animated.View
            style={[
              styles.resultCard,
              { borderTopColor: meta.color, opacity: slideOpacity, transform: [{ translateX: slideX }, { scale: slideScale }] },
            ]}
          >
            {renderDialogComponent()}
          </Animated.View>
        </View>

        {/* 스레드 진입 칩 */}
        <TouchableOpacity style={styles.threadChip} onPress={openThread}>
          <Text style={styles.threadChipText}>
            {t('canvas.threadCount', { count: threadCount })}
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
          accessibilityLabel={t('canvas.openThread')}
        >
          <Text style={styles.fabIcon}>💬</Text>
        </TouchableOpacity>
        <View style={styles.micWrap}>
          <JoystickMic
            onGesture={handleGesture}
            onRelease={() => {}}
            isRecording={isRecording}
            directionLabels={{
              DIR_LEFT: t('cards.formYes'),
              DIR_RIGHT: t('cards.formNo'),
              DIR_DOWN: t('common.cancel'),
              DIR_UP: t('voice.dirUp'),
            }}
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
    ...typography.headline,
    fontSize: iconSize.glyph,
    color: colors.text2,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerMarker: {
    ...typography.subhead,
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
  swipeZone: {
    borderRadius: radii.lg,
    overflow: 'hidden',
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
    ...typography.caption,
    color: colors.text2,
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
    ...typography.headline,
    fontSize: iconSize.glyph,
  },
  micWrap: {
    alignItems: 'center',
  },
  fabPlaceholder: {
    width: 44,
    height: 44,
  },
});