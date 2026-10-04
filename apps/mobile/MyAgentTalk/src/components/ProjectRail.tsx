// 좌측 프로젝트 레일 (t_00fe9b0f 요구2, 대표님 10/4 원문: "왼쪽 창 = 한 에이전트 안에서의
// 새프로젝트(갈라내기) 공간 리스트") — PC wide(≥1024) 채팅 라우트의 좌측 1차 내용.
// 기존 ThreadRail(슬랙식 스레드 목록)과는 대체 관계: 스레드는 우측 사이드체인 카드로 이관되었으므로
// 좌측은 하드포크 체인(같은 에이전트의 포크 세션) 리스트가 차지한다. 768~1023(2-팬)은 기존 레일 유지.
// 행 = 제목 + 계보 링크 2단계('원체인에서 #높이') + 최근 시각. 탭 = 그 세션 진입(스택 push — 뒤로=원본 복귀).
// 헤더 '새프로젝트' = 현재 방의 마지막 발화 지점에서 fork POST(백엔드 통째 복제=하드포크 계약),
// 실패 시 errors.fork 라벨 동기화 안내. 데이터 = GET /api/sessions(신규 API 없음, 백개발 완료 계약).
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { formatRelative } from '../i18n/format';
import { api, type SessionSummary } from '../lib/api';
import { buildProjectRows, type ProjectRow } from '../lib/chainLogic';
import { railStore } from '../lib/railStore';
import ForkDialog from './ForkDialog';
import { colors, radii, spacing, typography } from '../theme';

export default function ProjectRail({ navigation }: { navigation: any }) {
  const { t, i18n } = useTranslation();
  // ChatScreen이 railStore에 발행하는 현재 세션 메타 구독 (ThreadRail과 동일 버스, 이중 원천 금지)
  const state = useSyncExternalStore(railStore.subscribe, railStore.get, railStore.get);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [forkOpen, setForkOpen] = useState(false);

  const load = useCallback(() => {
    void api.listSessions().then((env) => { if (env.ok) setSessions(env.data ?? []); }).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load, state.sessionId]);

  const rows: ProjectRow[] = buildProjectRows(sessions, state.sessionId, state.meta?.agentId ?? null);
  const enter = (row: ProjectRow) => {
    if (row.isCurrent) return;
    // push 아님(정식 push = 스택 내부 컨텍스트 전용 — 이 레일은 Stack의 형제라 push 미노출, 런타임 실측).
    // 같은 'Chat' 라우트로 navigate = params 교체 → useChatSession의 requestedSession 효과가 세션을
    // 갈아탄다(스택 유지, 앱바 ← 은 현행대로 목록 복귀 — 뒤로가 원본 복귀였던 push 의도는 다음 카드에서).
    navigation.navigate('Chat', {
      sessionId: row.id, sessionTitle: row.title,
      forkedFrom: sessions.find((s) => s.id === row.id)?.forked_from,
    });
  };

  return (
    <View style={styles.rail} testID="project-rail">
      <View style={styles.header}>
        <Text style={styles.title}>{t('chain.projects')}</Text>
        {/* 생성 = 현재 방의 최신 확정 발화에서 하드포크. lastMessageId(래일 승계) 없으면 비활성(빈 방).
            실패 안내는 ForkDialog 내부 errors.fork('새프로젝트 만들기에 실패했어요' — t_7f86eefb 라벨 동기화). */}
        <Pressable
          accessibilityRole="button"
          testID="project-new"
          disabled={!state.sessionId || !state.lastMessageId}
          onPress={() => setForkOpen(true)}
          style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.7 },
            (!state.sessionId || !state.lastMessageId) && styles.newBtnDisabled]}
        >
          <Text style={styles.newBtnText}>＋ {t('chain.newProject')}</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {rows.map((row) => (
          <Pressable key={row.id} onPress={() => enter(row)} testID={`project-row-${row.id}`}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, row.isCurrent && styles.rowCurrent, pressed && { backgroundColor: colors.surfaceHover }]}>
            <View style={styles.rowTitleLine}>
              <Text numberOfLines={1} style={[styles.rowTitle, styles.rowTitleFlex, row.isCurrent && styles.rowTitleCurrent]}>{row.title || t('chain.unnamed')}</Text>
              {/* 최근 시각 — 대표님 좌측 스펙 '제목+최근 시각' (정렬 기준과 동일 원료: last_activity_at) */}
              <Text style={styles.rowTime} testID={`project-time-${row.id}`}>{row.lastActivity ? formatRelative(new Date(row.lastActivity), i18n.language) : ''}</Text>
            </View>
            {/* 계보 2단계: 갈라낸 체인만 — '원질문 #높이 · 부모 ← 조부모' (하드포크 나무 시각화) */}
            {row.parentTitle && (
              <Text numberOfLines={1} style={styles.lineage} testID={`project-lineage-${row.id}`}>
                {t('chain.lineage', { origin: row.parentTitle, height: row.height != null ? row.height : '—' })}
                {row.grandTitle ? ` ← ${row.grandTitle}` : ''}
              </Text>
            )}
          </Pressable>
        ))}
        {rows.length === 0 && <Text style={styles.empty} testID="project-rail-empty">{t('chain.projectsEmpty')}</Text>}
      </ScrollView>
      {/* 헤더 생성 = 포크 지점 승계(lastMessageId) + 현재 방 제목으로 ForkDialog 재사용(fork API 계약 동일).
          성공 시 ForkDialog가 새 방으로 reset(ForkOrigin 계보 승계) — 목록은 복귀 시점 reload로 갱신. */}
      {forkOpen && state.sessionId && state.lastMessageId && (
        <ForkDialog
          sessionId={state.sessionId}
          messageId={state.lastMessageId}
          title={state.meta?.sessionTitle || ''}
          navigation={navigation}
          onClose={() => { setForkOpen(false); load(); }}
        />
      )}
    </View>
  );
}

// 행 렌더 = '제목+최근 시각'(대표님 좌측 스펙 원문) + 갈라낸 체인은 계보 2단계 하단. 시각·정렬 모두
// last_activity_at 동일 원료 — 표시값과 리스트 순서가 어긋나지 않는다.
const styles = StyleSheet.create({
  rail: { flex: 1, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border, paddingHorizontal: spacing.sp3, paddingTop: spacing.sp4, gap: spacing.sp2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sp2, paddingHorizontal: spacing.sp1 },
  title: { ...typography.subhead, fontWeight: '700', color: colors.text1, letterSpacing: 0 },
  newBtn: { paddingHorizontal: spacing.sp2, paddingVertical: 3, borderRadius: radii.sm, backgroundColor: colors.accentTint },
  newBtnDisabled: { opacity: 0.4 },
  newBtnText: { ...typography.caption, fontWeight: '700', color: colors.accent },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.sp3, gap: 2 },
  row: { paddingVertical: spacing.sp2, paddingHorizontal: spacing.sp2, borderRadius: radii.md, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2 },
  rowTitleFlex: { flex: 1 },
  rowTime: { ...typography.micro, color: colors.text3 },
  rowCurrent: { backgroundColor: colors.surfaceRaise },
  rowTitle: { ...typography.body, color: colors.text1 },
  rowTitleCurrent: { ...typography.bodyBold, color: colors.accent },
  lineage: { ...typography.micro, color: colors.text3 },
  empty: { ...typography.caption, color: colors.text3, paddingHorizontal: spacing.sp1, paddingTop: spacing.sp2 },
});
