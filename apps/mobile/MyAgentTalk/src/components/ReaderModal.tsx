// 전체 읽기 리더 모달 (t_3116c5bc) — 장문 표·보고서형 카드를 페이지 넘기지 않고 한눈에.
// 대표님 좌표: "전체화면 페이퍼 스타일, 상단 제목+닫기, 본문 재흐름, 모바일/PC 반응형,
// Esc/스와이프 닫기, 애플 HIG 시트" + 블로그 가독성(행 38~42자·행간 1.6·어절 유지·숫자+단위 비브레이크).
// 재흐름 = payload→ReaderBlock 스트림(전체 읽기 전용). 인터랙션(form 제출·media 라이트박스 등)은
// 인라인 카드에 남기고, 리더는 읽기 최우선으로 텍스트/표/목록만 다시 흐르게 렌더한다.
import React, { useEffect, useMemo } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CloseIcon, BookOpenIcon } from './Icon';
import { colors, radii, spacing, typography, iconSize } from '../theme';
import { READER_MAX_WIDTH, READER_LINE_HEIGHT, buildReaderBlocks, joinNumericUnits } from '../lib/readerLogic';
import type { ChatMessage } from '../types';

interface Props {
  message: ChatMessage | null;
  agentName: string;
  onClose: () => void;
}

/** 웹 Esc 닫기 — 모달이 떠 있는 동안만 리스너 (SettingsScreen capture 경로와 동일 패턴). */
function useEscapeClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, onClose]);
}

function ReaderTable({ head, rows }: { head: string[]; rows: string[][] }) {
  if (!rows.length) return null;
  const cols = head.length ? Math.max(head.length, ...rows.map((r) => r.length)) : (rows[0]?.length ?? 0);
  const cells = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? '');
  return <View style={styles.table}>
    {head.length > 0 && <View style={styles.tr}>
      {cells(head).map((h, i) => <RNText key={i} style={styles.th}>{joinNumericUnits(h)}</RNText>)}
    </View>}
    {rows.map((row, ri) => <View key={ri} style={[styles.tr, ri === rows.length - 1 && styles.trLast]}>
      {cells(row).map((v, ci) => <RNText key={ci} style={styles.td}>{joinNumericUnits(v)}</RNText>)}
    </View>)}
  </View>;
}

export default function ReaderModal({ message, agentName, onClose }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  useEscapeClose(!!message, onClose);
  const blocks = useMemo(() => (message ? buildReaderBlocks(message) : []), [message]);
  if (!message) return null;
  const title = (typeof message.payload?.title === 'string' && message.payload.title.trim())
    ? message.payload.title.trim()
    : (message.content ?? '').split('\n')[0].slice(0, 60) || t('reader.untitled');
  const pcShell = width >= 900;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose} testID="reader-modal">
    <View style={styles.root}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common.close')} />
      {/* 모바일 = 하단시트(HIG grabber), PC = 중앙 페이퍼. 페이퍼 폭은 본문 가독 폭+여백. */}
      <View style={[styles.sheet, pcShell ? styles.sheetPc : styles.sheetMobile]}>
        <View style={styles.head}>
          <View style={styles.headTitleWrap}>
            <View style={styles.kickerRow}>
              <BookOpenIcon size={iconSize.tileSm} color={colors.accent} />
              <Text style={styles.kicker} numberOfLines={1}>{t('reader.byAgent', { name: agentName })}</Text>
            </View>
            <RNText numberOfLines={2} style={styles.title} testID="reader-title">{title}</RNText>
          </View>
          <Pressable onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button" accessibilityLabel={t('common.close')} testID="reader-close" style={styles.closeButton}>
            <CloseIcon size={iconSize.glyphLg} color={colors.text2} />
          </Pressable>
        </View>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
          {blocks.length === 0 && <RNText style={styles.para}>{message.content || t('cards.noContent')}</RNText>}
          {blocks.map((block, i) => {
            if (block.kind === 'heading') return <RNText key={i} style={styles.blockTitle}>{joinNumericUnits(block.text)}</RNText>;
            if (block.kind === 'table') return <ReaderTable key={i} head={block.head} rows={block.rows} />;
            if (block.kind === 'list') return <View key={i} style={styles.listBlock}>
              {block.items.map((item, j) => <View key={j} style={styles.listRow}>
                <RNText style={[styles.listMark, item.done && styles.listDone]}>{item.done ? '☑' : '☐'}</RNText>
                <RNText selectable style={styles.listText}>{joinNumericUnits(item.text)}</RNText>
              </View>)}
            </View>;
            return <RNText key={i} selectable style={styles.para}>{joinNumericUnits(block.text)}</RNText>;
          })}
          {message.aiGenerated !== false && <RNText style={styles.aiMeta} testID="reader-ai-badge">{t('common.aiGenerated')}</RNText>}
        </ScrollView>
        {!pcShell && <Pressable style={styles.grabberZone} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('reader.swipeToClose')}>
          <View style={styles.grabber} />
        </Pressable>}
      </View>
    </View>
  </Modal>;
}

const keepAll = Platform.OS === 'web' ? ({ wordBreak: 'keep-all' } as never) : {};

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(16,24,40,0.45)' },
  sheet: { position: 'absolute', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', maxWidth: READER_MAX_WIDTH + 2 * spacing.sp5 },
  sheetMobile: { left: 0, right: 0, bottom: 0, maxHeight: '92%', borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  sheetPc: { left: spacing.sp8, right: spacing.sp8, top: spacing.sp8, bottom: spacing.sp8, borderRadius: radii.lg, width: 'auto' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sp3, paddingHorizontal: spacing.sp5, paddingTop: spacing.sp4, paddingBottom: spacing.sp3, borderBottomWidth: 1, borderColor: colors.border },
  headTitleWrap: { flex: 1, minWidth: 0, gap: 2 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp1 },
  kicker: { ...typography.micro, color: colors.text3 },
  title: { ...typography.title2, color: colors.text1 },
  closeButton: { padding: spacing.sp1 },
  body: { flex: 1 },
  // 블로그 가독성 — 행 길이 38~42자(≈640px) 중앙 정렬 + 문단 간 여백 + 행간 1.6.
  bodyInner: { paddingHorizontal: spacing.sp5, paddingVertical: spacing.sp4, gap: spacing.sp4, maxWidth: READER_MAX_WIDTH, width: '100%', alignSelf: 'center' },
  para: { ...typography.body, lineHeight: READER_LINE_HEIGHT, color: colors.text1, ...keepAll },
  blockTitle: { ...typography.headline, color: colors.text1 },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, overflow: 'hidden' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border },
  trLast: { borderBottomWidth: 0 },
  th: { flex: 1, padding: spacing.sp2, ...typography.caption, color: colors.text2, backgroundColor: colors.surfaceRaise },
  td: { flex: 1, padding: spacing.sp2, ...typography.caption, color: colors.text1, lineHeight: 20, ...keepAll },
  listBlock: { gap: spacing.sp2 },
  listRow: { flexDirection: 'row', gap: spacing.sp2 },
  listMark: { ...typography.body, color: colors.text3, width: 22 },
  listDone: { color: colors.statusOk },
  listText: { ...typography.body, lineHeight: READER_LINE_HEIGHT, color: colors.text1, flex: 1, ...keepAll },
  aiMeta: { ...typography.micro, color: colors.text3, marginTop: spacing.sp2 },
  grabberZone: { alignItems: 'center', paddingVertical: spacing.sp3 },
  grabber: { width: 40, height: 5, borderRadius: radii.full, backgroundColor: colors.borderStrong },
});
