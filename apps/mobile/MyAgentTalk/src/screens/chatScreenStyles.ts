// 채팅 화면 공용 스타일 (t_70cbbd6b: ChatScreen→컴포넌트 추출에 따라 공용 모듈로 이동)
// ※ 값은 기존 ChatScreen.styles와 1:1 동일 — 렌더/DOM 불변 리팩토링의 근거.
import { Platform, StyleSheet, ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '../theme';
import { CHAT_LIST_ANCHOR } from '../lib/voiceStage';
import { renderFlags } from '../lib/renderFlags';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sp2,
    paddingTop: spacing.sp3,
    paddingBottom: spacing.sp2,
  },
  backButton: {
    width: spacing.sp10,
    height: spacing.sp10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    ...typography.headline,
    color: colors.text1,
  },
  headerBody: {
    minWidth: 0,
    flexShrink: 1,
    flex: 1,
    marginLeft: spacing.sp1,
    marginRight: spacing.sp2,
  },
  appbarTitle: {
    ...typography.headline,
    letterSpacing: -0.2,
    color: colors.text1,
  },
  appbarSubtitle: {
    ...typography.micro,
    marginTop: spacing.sp1,
  },
  demoBadge: {
    backgroundColor: colors.surfaceRaise,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
    marginRight: spacing.sp3,
  },
  demoBadgeText: {
    ...typography.micro,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.statusWarn,
  },
  errorBar: {
    flexWrap: 'wrap',
    backgroundColor: colors.surfaceRaise,
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp2,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceRaise,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sp2,
  },
  errorText: {
    ...typography.caption,
    color: colors.statusErr,
    flex: 1,
  },
  retryButton: {
    borderWidth: 1,
    borderColor: colors.statusErr,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp1,
  },
  retryText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.statusErr,
  },
  // 즐겨찾기 딥링크 하이라이트 (Wave1) — 액센트 좌측 밴드 + 연그린 tint (말풍선 금지 #54 — 영역 강조)
  focusHighlight: { borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.accentTint, borderRadius: radii.md },
  // 다중 선택 (대표님 9/26) — 선택 행=연그린 밴드, 액션 바=입력창 위 플로팅
  selectedRow: { borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.accentTint, borderRadius: radii.md },
  selectionBar: { position: 'relative', zIndex: 100, flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, marginHorizontal: spacing.sp3, marginBottom: spacing.sp1, padding: spacing.sp2, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  selectionCount: { ...typography.caption, color: colors.text2, flex: 1, minWidth: 0 },
  // Wave 2 저장 결과 토스트 — 입력창 위 고정, 노트/보드 딥링크 버튼 포함
  resultToast: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, marginHorizontal: spacing.sp3, marginBottom: spacing.sp1, padding: spacing.sp2, backgroundColor: colors.accentTint, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  toastText: { ...typography.caption, color: colors.text1, flex: 1, minWidth: 0 },
  // t_dee9e982 (대표님 9/29): 짧은 히스토리 하단 앵커 — 콘텐츠가 뷰포트보다 짧으면
  // flexGrow:1만으로는 위부터 쌓여 아래가 통째로 빈다. justifyContent:flex-end로 마지막
  // 발화를 하단(입력 스테이지 위)에 붙인다. 콘텐츠가 초과하면 플렉스 규칙상 정렬이 무의미해
  // 정상 스크롤 유지(잘림 없음). A계층 하단 패딩=voiceStageHeight 계약(ChatScreen 인라인 오버라이드)
  // 과 직교 — 패딩이 strip 높이만큼 올리고 정렬이 남은 여백을 아래로 붙인다.
  listContent: {
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp3,
    gap: spacing.sp2,
    ...CHAT_LIST_ANCHOR,
  },
  // 전폭 사각형 카드 스택 — 메신저 말풍선 관습(좌우 배치) 배제
  msgCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp3,
  },
  // ② contain:layout (t_5c559e85) — 스트리밍 카드의 재레이아웃 상위 전파 차단(웹 전용 CSS, 롤백: streamContain=0)
  streamContainWeb: (Platform.OS === 'web' && renderFlags.streamContain ? { contain: 'layout' } : {}) as ViewStyle,
  msgCardAgent: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  msgHeader: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
    marginBottom: spacing.sp1,
  },
  msgRole: {
    ...typography.micro,
    fontWeight: '700',
    letterSpacing: 0.5,
    minWidth: 0,
    flexShrink: 1,
  },
  msgRoleUser: {
    color: colors.accent,
  },
  msgRoleAgent: {
    color: colors.text2,
  },
  neuronChip: {
    minWidth: 0,
    flexShrink: 1,
    backgroundColor: colors.border,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
  },
  neuronChipText: {
    ...typography.micro,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: colors.accent,
  },
  pendingMark: {
    ...typography.micro,
    minWidth: 0,
    flexShrink: 1,
    marginLeft: 'auto',
    color: colors.text3,
  },
  // 질문 큐 체크포인트 (t_1797f432 ②) — user 카드 하단 상태 행: 전송 표시 + 큐 마커 한 줄
  userMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, minWidth: 0 },
  // ── 날짜 구분선 (t_34f3e92c 백로그②, 텔레그램 컨벤션) ──
  // 인-플로우 행: 전폭 중앙 정렬. 고정 오버레이: 리스트 위 absolute(스크롤 박스 밖에서 붙음),
  // 배경 없는 floating 라벨 — 카드가 아래로 지나가면 자연히 가려짐(스택 가림 방지).
  dateSepRow: { alignItems: 'center', paddingVertical: spacing.sp1 },
  dateSepPill: { paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp1, borderRadius: radii.full, backgroundColor: colors.surfaceRaise },
  // 한글 어절 유지 — 라벨 '09.26 (금)' 등이 조사 없이 끊기지 않게 (웹: word-break keep-all, ReaderModal 관례)
  dateSepText: { ...typography.micro, fontWeight: '600', color: colors.text2, ...(Platform.OS === 'web' ? { wordBreak: 'keep-all' } as never : {}) },
  // FlatList 스크롤 박스 래퍼 — 고정 날짜 탭(absolute)의 기준. flex:1은 스크롤 박스 자체의
  // flexGrow:1(commonStyle)을 보존하며 키보드/레이아웃 측정 DOM 위치 불변 (t_dee9e982 앵커 orthogonality).
  listWrap: { flex: 1, position: 'relative', minHeight: 0 },
  pinnedDateOverlay: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 12, alignItems: 'center', pointerEvents: 'none' },
  // 후속 질문 칩 (t_1797f432 ③) — 타이핑/스트리밍 종료 후 최종 답변 아래 2~3개, 탭 시 즉시 전송
  suggestRow: { gap: spacing.sp2, paddingTop: spacing.sp1 },
  suggestTitle: { ...typography.micro, color: colors.text3 },
  suggestChip: { alignSelf: 'flex-start', maxWidth: '90%', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, backgroundColor: colors.surface },
  suggestChipText: { ...typography.caption, color: colors.text1 },
  // AI 상시 고지 바 — 저대비 micro 한 줄, 메시지가 쌓여도 유지 (t_eb7f13e9 항목 2)
  aiDisclosure: {
    ...typography.micro,
    color: colors.text3,
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp1,
    paddingBottom: spacing.sp1,
    minWidth: 0,
  },
  msgText: {
    ...typography.body,
    color: colors.text1,
  },
  // 스트리밍 꼬리 커서 (t_cc232982) — delta 성장 중에만 말미에 뜨는 초록 펄싱 도트, answer.done 정지
  streamCursor: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    alignSelf: 'flex-start',
    marginTop: spacing.sp1,
  },
  empathyText: {
    ...typography.body,
    lineHeight: typography.bodyBold.lineHeight,
    color: colors.text2,
    fontStyle: 'italic',
    marginBottom: spacing.sp1,
  },
  systemRow: {
    alignItems: 'center',
    marginVertical: spacing.sp1,
  },
  systemText: {
    ...typography.caption,
    color: colors.statusErr,
    backgroundColor: colors.surfaceRaise,
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
    borderRadius: radii.xs,
    overflow: 'hidden',
  },
  typingQuip: {
    ...typography.subhead,
    color: colors.text2,
    fontStyle: 'italic',
  },
  loadMoreWrap: {
    alignItems: 'center',
    paddingVertical: spacing.sp1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sp10,
    paddingHorizontal: spacing.sp8,
  },
  emptyTitle: {
    ...typography.title2,
    letterSpacing: -0.24,
    color: colors.text1,
    marginBottom: spacing.sp2,
    textAlign: 'center',
  },
  emptySub: {
    ...typography.subhead,
    color: colors.text3,
    textAlign: 'center',
  },
  // ── 반응형 2트랙 (t_eded715c) ──
  // shell: 채팅 본문 + (PC wide) 우측 컨텍스트 패널을 나란히. 모바일에서는 패널 미렌더라 단일 컬럼과 동일.
  // 입력바/스테이지/클립 스타일은 ChatInputConsole로 이동 (t_91cb659c)
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, marginTop: spacing.sp1 },
  // 답변 대기 앱바 버튼 (t_363c0faa) — 아이콘+우상단 숫자 배지 (pending-*=testID 접두, 2색 라인 관례)
  pendingButtonFace: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  pendingBadge: {
    position: 'absolute', top: -2, right: -6, minWidth: 16, textAlign: 'center',
    fontSize: 10, fontWeight: '700', color: colors.statusWarn,
  },
});
