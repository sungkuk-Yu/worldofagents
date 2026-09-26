/**
 * 칸반 보드 화면 — Wave 2 (t_174b66d2)
 * 보드 목록 → 보드 상세(컬럼 4개 todo/doing/review/done 가로 스크롤) → 카드 시트.
 *
 * 드래그 (#50 지시: 기성 라이브러리 우선, 웹 퍼스트):
 *   - 웹: @dnd-kit/core (DndContext + useDraggable/useDroppable) — 드롭 시乐观적 PATCH,
 *     실패 시 이전 스냅샷 롤백(kanbanLogic.dropPosition이 인접 중간점 position 계산).
 *   - 네이티브: @dnd-kit은 DOM 전용이라 보조 이동 버튼(◀/▶, 컬럼 경계 삽입)으로 동일 계약 PATCH.
 * 카드 상세 = BottomSheetModal (#52 애플 모션 — ThreadSheet와 동일 디텐트/곡선 패밀리).
 *
 * 레퍼런스 간격·색·타이포 (#50): popular-web-designs/linear.app.md —
 *   열 헤더 11px uppercase+letterSpacing 0.5, 보드 배경 surface #FFFFFF, 열 배경 #F6F7F9 계열
 *   (colors.surfaceRaise 차용), 카드 radius 8px · border 1px #E4E8EE · 섀도 없음(라인으로 구분),
 *   열 폭 272px(=sp10*6+여유)·열 사이 gap 12px, 헤더 액션=우측 text button.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { api, KanbanBoard } from '../lib/api';
import { BOARD_COLUMNS, groupCardsByColumn, isBoardColumn, moveCard, positionBetween, type BoardCardDto, type BoardColumn } from '../lib/kanbanLogic';
import { errorKey } from '../lib/errorKeys';
import { colors, radii, spacing, typography, webScreenMotion } from '../theme';

export interface BoardScreenProps {
  navigation: any;
  route?: { params?: { boardId?: string } };
}

const COLUMN_TINT: Record<BoardColumn, string> = {
  todo: colors.statusNeutral, doing: colors.segInfo, review: colors.segFile, done: colors.statusOk,
};

// ── 웹 드래거블 카드 (Linear: 카드=라인 구분, 드래그 중 = overlay + 원위치 placeholder) ──
function DraggableCard({ card, onPress }: { card: BoardCardDto; onPress: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id, data: { status: card.status } });
  // dnd-kit은 웹 DOM ref/transform을 반환 — RN-web View는 DOM 래퍼이므로 런타임 호환, 타입만 우회.
  const style = transform ? ({ transform: [{ x: transform.x }, { y: transform.y }] } as unknown as import('react-native').ViewStyle) : undefined;
  // attributes/listeners는 웹 DOM 속성 세트(tabIndex: number 등) — RN-web View는 DOM 래퍼라
  // 런타임 호환이지만 RN 타입과 어긋나므로 object로 좁혀 spread (노드 ref도 동일 사유로 캐스팅).
  const dragProps = { ...attributes, ...listeners } as object;
  return (
    <View ref={setNodeRef as unknown as React.Ref<View>} style={[styles.card, isDragging && styles.cardGhost]} {...dragProps}>
      <Pressable onPress={onPress} style={style} testID={`board-card-${card.id}`}>
        <CardFace card={card} />
      </Pressable>
    </View>
  );
}

function DroppableColumn({ column, children }: { column: BoardColumn; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column}`, data: { column } });
  return <View ref={setNodeRef as unknown as React.Ref<View>} style={[styles.columnBody, isOver && styles.columnOver]}>{children}</View>;
}

function CardFace({ card }: { card: BoardCardDto }) {
  return (
    <View>
      <Text style={styles.cardTitle} numberOfLines={2}>{card.title}</Text>
      {card.assignee ? <Text style={styles.cardMeta} numberOfLines={1}>◈ {card.assignee}</Text> : null}
      <View style={styles.cardLabels}>
        {(card.labels ?? []).slice(0, 3).map((l) => <Text key={l} style={styles.cardLabel}>{l}</Text>)}
      </View>
    </View>
  );
}

export default function BoardScreen({ navigation, route }: BoardScreenProps) {
  const { t } = useTranslation();
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [cards, setCards] = useState<BoardCardDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBoard, setNewBoard] = useState<string | null>(null); // 보드 생성 인라인 입력
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheetDraft, setSheetDraft] = useState<{ title: string; body: string; assignee: string } | null>(null);
  const sheetRef = useRef<BottomSheetModal>(null);
  const rollbackRef = useRef<BoardCardDto[] | null>(null);
  const columns = useMemo(() => groupCardsByColumn(cards), [cards]);
  const detail = detailId ? cards.find((c) => c.id === detailId) ?? null : null;
  const active = activeId ? cards.find((c) => c.id === activeId) ?? null : null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const loadBoards = useCallback(async () => {
    try { const env = await api.listBoards(); setBoards(env.data ?? []); }
    catch (e) { setError(errorKey(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void loadBoards(); }, 0); return () => clearTimeout(timer); }, [loadBoards]);

  const openBoard = useCallback(async (id: string) => {
    try {
      const env = await api.getBoard(id);
      setBoardId(id); setCards(env.data?.cards ?? []); setError(null);
    } catch (e) { setError(errorKey(e)); }
    finally { setLoading(false); }
  }, []);

  // 딥링크(boardId 파라미터) — 타이머 래퍼로 effect 동기 setState 회피 (FavoritesScreen 패턴)
  useEffect(() => {
    const id = route?.params?.boardId;
    if (!id) return;
    const timer = setTimeout(() => { void openBoard(id); }, 0);
    return () => clearTimeout(timer);
  }, [route?.params?.boardId, openBoard]);

  const createBoard = async () => {
    const name = (newBoard ?? '').trim();
    if (!name) return;
    try {
      const env = await api.createBoard({ name });
      setNewBoard(null);
      await loadBoards();
      if (env.data) void openBoard(env.data.id);
    } catch (e) { setError(errorKey(e)); }
  };

  /** 카드 PATCH 공통 — 낙관 반영(이전 스냅샷 보관) → 실패 시 롤백 + errors.board */
  const patchCard = useCallback(async (cardId: string, patch: Partial<BoardCardDto>, snapshot: BoardCardDto[]) => {
    rollbackRef.current = snapshot;
    setCards((cur) => cur.map((c) => (c.id === cardId ? { ...c, ...patch } as BoardCardDto : c)));
    try {
      const env = await api.patchCard(cardId, patch);
      if (!env.ok) throw new Error('patch');
      if (env.data) setCards((cur) => cur.map((c) => (c.id === cardId ? env.data as BoardCardDto : c)));
    } catch {
      setCards(rollbackRef.current ?? []);
      setError('errors.board');
    }
  }, []);

  // ── 웹 드래그 (DndContext) ──
  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const cardId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    const toColumn: BoardColumn | null = overId.startsWith('col:')
      ? (overId.slice(4) as BoardColumn)
      : (cards.find((c) => c.id === overId) ? (isBoardColumn(cards.find((c) => c.id === overId)!.status) ? cards.find((c) => c.id === overId)!.status as BoardColumn : 'todo') : null);
    if (!toColumn) return;
    const target = cards.filter((c) => c.id !== cardId && (c.status === toColumn));
    let index = target.length;
    if (!overId.startsWith('col:')) {
      const overIdx = target.findIndex((c) => c.id === overId);
      if (overIdx >= 0) index = overIdx; // 카드 위에 드롭 = 그 자리 삽입
    }
    const result = moveCard(cards, cardId, toColumn, index);
    if (result) void patchCard(cardId, result.patch, cards);
  };

  // ── 네이티브/보조: 좌우 컬럼 이동 (끝에서 삽입) ──
  const shiftCard = (card: BoardCardDto, delta: -1 | 1) => {
    const cur = isBoardColumn(card.status) ? card.status : 'todo';
    const idx = BOARD_COLUMNS.indexOf(cur) + delta;
    if (idx < 0 || idx >= BOARD_COLUMNS.length) return;
    const to = BOARD_COLUMNS[idx];
    const target = cards.filter((c) => c.id !== card.id && c.status === to);
    const position = positionBetween(target.length ? Math.max(...target.map((c) => c.position)) : null, null);
    void patchCard(card.id, { status: to, position }, cards);
  };

  const openDetail = (card: BoardCardDto) => {
    setDetailId(card.id);
    setSheetDraft({ title: card.title, body: card.body ?? '', assignee: card.assignee ?? '' });
    requestAnimationFrame(() => sheetRef.current?.present());
  };
  const saveDetail = async () => {
    if (!detail || !sheetDraft) return;
    const patch: Partial<BoardCardDto> = {
      title: sheetDraft.title.trim() || detail.title,
      body: sheetDraft.body,
      assignee: sheetDraft.assignee.trim() || null,
    };
    await patchCard(detail.id, patch, cards);
    sheetRef.current?.dismiss();
  };
  const deleteDetail = async () => {
    if (!detail) return;
    sheetRef.current?.dismiss();
    const snapshot = cards;
    setCards((cur) => cur.filter((c) => c.id !== detail.id));
    try { await api.deleteCard(detail.id); }
    catch { setCards(snapshot); setError('errors.board'); }
  };
  const addCardTo = async (column: BoardColumn) => {
    const snapshot = cards;
    const env = await api.createCard(boardId!, { title: t('board.newCardTitle'), status: column }).catch((e) => { setError(errorKey(e)); return null; });
    if (!env?.data) return;
    setCards((cur) => [...cur, env.data as BoardCardDto]);
    // 낙관 추가 후 서버 position 재확인(재정렬 포함) — 목록 갱신은 cheap
    try { const b = await api.getBoard(boardId!); setCards(b.data?.cards ?? snapshot); } catch { /* 낙관 유지 */ }
  };

  const headerRow = (title: string, right?: React.ReactNode) => (
    <View style={styles.header}>
      <Pressable
        // 보드 상세 → 목록, 목록 → 대화목록 (웹은 스택 헤더가 없어 목록에서도 뒤로 필요)
        onPress={() => { if (boardId) { setBoardId(null); void loadBoards(); } else navigation.goBack(); }}
        testID={boardId ? 'board-back' : 'board-home-back'}
        style={styles.backButton} accessibilityRole="button" accessibilityLabel={t('common.back')}>
        <Text style={styles.backIcon}>{t('common.backIcon')}</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );

  // ── 로딩/에러 ──
  const errorBar = error ? <Pressable style={styles.errorBar} onPress={() => setError(null)} testID="board-error"><Text style={styles.errorText}>{t(error)}</Text></Pressable> : null;

  if (!boardId) {
    return (
      <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
        {headerRow(t('board.title'), (
          <Pressable onPress={() => setNewBoard('')} testID="board-new" style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('board.new')}>
            <Text style={styles.headerAction}>{t('board.new')}</Text>
          </Pressable>
        ))}
        {errorBar}
        {newBoard !== null && (
          <View style={styles.inlineCreate} testID="board-create-row">
            <TextInput style={styles.inlineInput} value={newBoard} onChangeText={setNewBoard} placeholder={t('board.namePlaceholder')} placeholderTextColor={colors.text3} autoFocus testID="board-name-input" onSubmitEditing={() => void createBoard()} />
            <Pressable onPress={() => void createBoard()} disabled={!newBoard.trim()} testID="board-create-submit" style={styles.inlineSubmit}>
              <Text style={styles.inlineSubmitText}>{t('board.create')}</Text>
            </Pressable>
          </View>
        )}
        {loading ? <ActivityIndicator color={colors.accent} style={styles.center} /> : (
          <FlatList data={boards} keyExtractor={(b) => b.id} contentContainerStyle={styles.listContent} testID="board-list"
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t('board.empty')}</Text><Text style={styles.emptySub}>{t('board.emptyHint')}</Text></View>}
            renderItem={({ item }) => (
              <Pressable onPress={() => void openBoard(item.id)} testID={`board-open-${item.id}`} style={styles.boardCard}>
                <Text style={styles.boardName} numberOfLines={1}>{item.name}</Text>
                {!!item.description && <Text style={styles.cardMeta} numberOfLines={1}>{item.description}</Text>}
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── 보드 상세: 4컬럼 가로 스크롤 (Linear: 열 배경 미묘, 카드=화이트 라인) ──
  const board = boards.find((b) => b.id === boardId);
  const columnsView = (
    <ScrollView horizontal contentContainerStyle={styles.boardRow} testID="board-columns">
      {BOARD_COLUMNS.map((column) => {
        const list = columns[column];
        const body = (
          <View style={styles.column}>
            <View style={styles.columnHeader}>
              <View style={[styles.columnDot, { backgroundColor: COLUMN_TINT[column] }]} />
              <Text style={styles.columnName}>{t(`board.col.${column}`)}</Text>
              <Text style={styles.columnCount}>{list.length}</Text>
            </View>
            {Platform.OS === 'web' ? (
              <DroppableColumn column={column}>
                {list.map((card) => <DraggableCard key={card.id} card={card} onPress={() => openDetail(card)} />)}
              </DroppableColumn>
            ) : (
              <View style={styles.columnBody}>
                {list.map((card) => (
                  <View key={card.id}>
                    <Pressable onPress={() => openDetail(card)} testID={`board-card-${card.id}`} style={styles.card}>
                      <CardFace card={card} />
                    </Pressable>
                    <View style={styles.nativeShift}>
                      <Pressable onPress={() => shiftCard(card, -1)} disabled={BOARD_COLUMNS.indexOf((isBoardColumn(card.status) ? card.status : 'todo') as BoardColumn) === 0} testID={`card-left-${card.id}`} accessibilityRole="button" style={styles.shiftBtn}>
                        <Text style={styles.shiftText}>{'←'}</Text>
                      </Pressable>
                      <Pressable onPress={() => shiftCard(card, 1)} disabled={BOARD_COLUMNS.indexOf((isBoardColumn(card.status) ? card.status : 'todo') as BoardColumn) === BOARD_COLUMNS.length - 1} testID={`card-right-${card.id}`} accessibilityRole="button" style={styles.shiftBtn}>
                        <Text style={styles.shiftText}>{'→'}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
            <Pressable onPress={() => void addCardTo(column)} testID={`board-add-${column}`} style={styles.addCard}>
              <Text style={styles.addCardText}>{t('board.addCard')}</Text>
            </Pressable>
          </View>
        );
        return <View key={column} style={styles.columnWrap} testID={`board-column-${column}`}>{body}</View>;
      })}
    </ScrollView>
  );

  return (
    <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
      {headerRow(board?.name ?? t('board.title'))}
      {errorBar}
      {loading && !cards.length ? <ActivityIndicator color={colors.accent} style={styles.center} /> : Platform.OS === 'web' ? (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          {columnsView}
          <DragOverlay>{active ? <View style={[styles.card, styles.cardDragged]}><CardFace card={active} /></View> : null}</DragOverlay>
        </DndContext>
      ) : columnsView}
      <BottomSheetModal ref={sheetRef} index={1} snapPoints={['45%', '90%']} enablePanDownToClose enableDynamicSizing={false} backgroundStyle={styles.sheetBg} handleIndicatorStyle={styles.sheetHandle} onDismiss={() => { setDetailId(null); setSheetDraft(null); }}>
        <BottomSheetView style={styles.sheetContent} testID="card-sheet">
          {detail && sheetDraft && (
            <>
              <TextInput style={styles.sheetTitle} value={sheetDraft.title} onChangeText={(v) => setSheetDraft((d) => (d ? { ...d, title: v } : d))} testID="card-title-input" placeholder={t('board.cardTitle')} placeholderTextColor={colors.text3} />
              <Text style={styles.sheetMeta}>{t(`board.col.${isBoardColumn(detail.status) ? detail.status : 'todo'}`)} · P{detail.priority} · {isFromMessageLabel(detail) ? t('board.fromMessage') : t('board.manual')}</Text>
              <TextInput style={styles.sheetBody} multiline value={sheetDraft.body} onChangeText={(v) => setSheetDraft((d) => (d ? { ...d, body: v } : d))} testID="card-body-input" placeholder={t('board.cardBody')} placeholderTextColor={colors.text3} />
              <TextInput style={styles.sheetAssignee} value={sheetDraft.assignee} onChangeText={(v) => setSheetDraft((d) => (d ? { ...d, assignee: v } : d))} testID="card-assignee-input" placeholder={t('board.assignee')} placeholderTextColor={colors.text3} />
              {(detail.labels ?? []).length > 0 && (
                <View style={styles.cardLabels}>{detail.labels.map((l) => <Text key={l} style={styles.cardLabel}>{l}</Text>)}</View>
              )}
              <View style={styles.sheetActions}>
                <Pressable onPress={() => void deleteDetail()} testID="card-delete" style={styles.sheetDelete}><Text style={styles.dangerText}>{t('board.deleteCard')}</Text></Pressable>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => sheetRef.current?.dismiss()} testID="card-cancel" style={styles.sheetCancel}><Text style={styles.cancelText}>{t('common.cancel')}</Text></Pressable>
                <Pressable onPress={() => void saveDetail()} testID="card-save" style={styles.sheetSave}><Text style={styles.saveText}>{t('board.saveCard')}</Text></Pressable>
              </View>
            </>
          )}
        </BottomSheetView>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

function isFromMessageLabel(card: BoardCardDto): boolean {
  return Array.isArray(card.labels) && card.labels.includes('from-message');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  headerTitle: { ...typography.headline, color: colors.text1, flex: 1, minWidth: 0 },
  headerButton: { paddingHorizontal: spacing.sp2, paddingVertical: spacing.sp1 },
  headerAction: { ...typography.subhead, color: colors.accent },
  backButton: { paddingHorizontal: spacing.sp1, paddingVertical: spacing.sp1 },
  backIcon: { ...typography.headline, color: colors.text1 },
  errorBar: { backgroundColor: colors.surfaceRaise, padding: spacing.sp2 },
  errorText: { ...typography.caption, color: colors.statusErr, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 보드 목록 (Linear 레퍼런스: 리스트 행, 라인 구분)
  listContent: { padding: spacing.sp3, gap: spacing.sp2, flexGrow: 1 },
  boardCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.sp3, marginBottom: spacing.sp2 },
  boardName: { ...typography.headline, color: colors.text1 },
  empty: { alignItems: 'center', paddingTop: spacing.sp10, gap: spacing.sp2 },
  emptyText: { ...typography.body, color: colors.text2 },
  emptySub: { ...typography.caption, color: colors.text3 },
  inlineCreate: { flexDirection: 'row', gap: spacing.sp2, padding: spacing.sp3, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  inlineInput: { ...typography.body, color: colors.text1, flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, backgroundColor: colors.surface },
  inlineSubmit: { backgroundColor: colors.accent, borderRadius: radii.sm, paddingHorizontal: spacing.sp4, justifyContent: 'center' },
  inlineSubmitText: { ...typography.bodyBold, color: colors.onPrimary },
  // 보드 상세
  boardRow: { padding: spacing.sp3, gap: spacing.sp3, alignItems: 'flex-start' },
  columnWrap: { width: 272, marginRight: 0 },
  column: { backgroundColor: colors.surfaceRaise, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingHorizontal: spacing.sp3, paddingTop: spacing.sp3, paddingBottom: spacing.sp2 },
  columnDot: { width: 8, height: 8, borderRadius: radii.full },
  columnName: { ...typography.microSm, color: colors.text2, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  columnCount: { ...typography.micro, color: colors.text3 },
  columnBody: { paddingHorizontal: spacing.sp2, paddingBottom: spacing.sp1, minHeight: 40, gap: spacing.sp1 },
  columnOver: { backgroundColor: colors.accentTint },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.sp2, marginBottom: spacing.sp1 },
  cardGhost: { opacity: 0.35 },
  cardDragged: { shadowColor: 'rgba(16,24,40,0.18)', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 1, shadowRadius: 16, elevation: 8, transform: [{ rotate: '1.5deg' }] },
  cardTitle: { ...typography.subhead, color: colors.text1 },
  cardMeta: { ...typography.micro, color: colors.text3, marginTop: 2 },
  cardLabels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp1, marginTop: spacing.sp1 },
  cardLabel: { ...typography.microXs, color: colors.text2, backgroundColor: colors.surfaceRaise, borderRadius: radii.xs, paddingHorizontal: spacing.sp1, overflow: 'hidden' },
  addCard: { padding: spacing.sp2, borderTopWidth: 1, borderTopColor: colors.border },
  addCardText: { ...typography.caption, color: colors.accent, textAlign: 'center' },
  nativeShift: { flexDirection: 'row', gap: spacing.sp1, marginBottom: spacing.sp1 },
  shiftBtn: { paddingHorizontal: spacing.sp3, paddingVertical: 2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.xs, backgroundColor: colors.surface },
  shiftText: { ...typography.caption, color: colors.text2 },
  // 카드 시트 (ThreadSheet와 동일 계열)
  sheetBg: { backgroundColor: colors.surface, borderRadius: radii.lg },
  sheetHandle: { backgroundColor: colors.borderStrong },
  sheetContent: { flex: 1, padding: spacing.sp4, gap: spacing.sp2 },
  sheetTitle: { ...typography.title2, color: colors.text1, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sp1 },
  sheetMeta: { ...typography.micro, color: colors.text3 },
  sheetBody: { ...typography.body, color: colors.text1, minHeight: 120, textAlignVertical: 'top' },
  sheetAssignee: { ...typography.subhead, color: colors.text1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, backgroundColor: colors.surface },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, marginTop: spacing.sp2 },
  sheetDelete: { padding: spacing.sp2 },
  sheetCancel: { padding: spacing.sp2 },
  cancelText: { ...typography.subhead, color: colors.text2 },
  sheetSave: { backgroundColor: colors.accent, borderRadius: radii.md, paddingHorizontal: spacing.sp5, paddingVertical: spacing.sp2 },
  saveText: { ...typography.bodyBold, color: colors.onPrimary },
  dangerText: { ...typography.subhead, color: colors.statusErr },
});
