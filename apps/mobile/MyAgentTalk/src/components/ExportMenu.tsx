// 카드 내보내기 메뉴 (t_3116c5bc) — 즐겨찾기 옆 다운로드 아이콘 → PDF/Word/Excel/HWP.
// 노출 규칙: 카드마다 무조건 노출(대표님 "구두 요청 안 해도 되도록"). xlsx는 표 카드만 활성(회색 처리).
// RN=시스템 공유시트, web=브라우저 저장. 오류/미지원 errors.* i18n으로 토스트(정직 보고).
import React, { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, CloseIcon } from './Icon';
import { colors, radii, spacing, typography, iconSize, shadows } from '../theme';
import { EXPORT_FORMATS, ExportFormat, downloadExport, formatDisabled } from '../lib/exportLogic';
import type { ChatMessage } from '../types';

interface Props {
  message: ChatMessage;
  /** 파일명 앞부분 {세션제목} — 서버 Content-Disposition이 우선, 결측 시 클라 폴백. */
  sessionTitle: string;
  disabled?: boolean; // 데모/미전송 카드 — 서버 행 없음 → 안내만
  onPressUnavailable?: () => void;
}

const FORMAT_LABEL_KEY: Record<ExportFormat, string> = {
  pdf: 'exporter.pdf',
  docx: 'exporter.word',
  xlsx: 'exporter.excel',
  hwp: 'exporter.hwp',
};

export function ExportMenu({ message, sessionTitle, disabled, onPressUnavailable }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const close = useCallback(() => { setOpen(false); setNote(null); }, []);
  const run = useCallback(async (fmt: ExportFormat) => {
    if (disabled) { close(); onPressUnavailable?.(); return; }
    if (formatDisabled(fmt, message.dialogueType)) { setNote(t('exporter.tableOnly')); return; }
    setBusy(fmt);
    const res = await downloadExport(message.id, sessionTitle, fmt);
    setBusy(null);
    if (res.ok) {
      setNote(fmt === 'hwp' ? t('exporter.hwpFallback') : t('exporter.saved', { name: res.filename ?? '' }));
      setOpen(false);
      setTimeout(() => setNote(null), 4000);
    } else {
      setNote(t(res.errorKey ?? 'exporter.failed'));
    }
  }, [message.dialogueType, message.id, sessionTitle, disabled, t, close, onPressUnavailable]);

  return <View style={styles.wrap}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('exporter.open')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={() => (open ? close() : setOpen(true))} testID={`card-export-${message.id}`}>
      <DownloadIcon size={iconSize.glyph} color={open ? colors.accent : colors.text3} />
    </Pressable>
    {open && <View style={styles.menu} testID="export-menu">
      {/* 웹: 메뉴 바깥 클릭으로 닫기 위한 fixed 오버레이 (absolute 패널과 달리 화면 전체 커버) */}
      {Platform.OS === 'web' && <Pressable style={styles.backdrop} onPress={close} />}
      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <Text style={styles.panelTitle}>{t('exporter.title')}</Text>
          <Pressable onPress={close} hitSlop={8} accessibilityLabel={t('common.close')} testID="export-menu-close"><CloseIcon size={iconSize.tile} color={colors.text2} /></Pressable>
        </View>
        {EXPORT_FORMATS.map((fmt) => {
          const off = disabled || formatDisabled(fmt, message.dialogueType);
          return <Pressable key={fmt} onPress={() => void run(fmt)} testID={`export-${fmt}`}
            accessibilityRole="button" style={styles.item} disabled={!!busy}>
            <Text style={[styles.itemText, off && styles.itemOff, busy === fmt && styles.itemBusy]}>{t(FORMAT_LABEL_KEY[fmt])}</Text>
            {busy === fmt && <Text style={styles.itemMeta}>{t('exporter.working')}</Text>}
          </Pressable>;
        })}
        {!!note && <Text style={styles.note} testID="export-note">{note}</Text>}
      </View>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  menu: { position: 'absolute', top: '100%', right: 0, zIndex: 30 },
  backdrop: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: -1 } as never,
  panel: { minWidth: 168, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sp2, ...shadows.sh3 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sp3, paddingBottom: spacing.sp1 },
  panelTitle: { ...typography.micro, color: colors.text3, letterSpacing: 0.4, textTransform: 'uppercase' as never },
  item: { paddingVertical: spacing.sp2, paddingHorizontal: spacing.sp3 },
  itemText: { ...typography.body, color: colors.text1 },
  itemOff: { color: colors.text3 },
  itemBusy: { color: colors.accent },
  itemMeta: { ...typography.micro, color: colors.accent },
  note: { ...typography.micro, color: colors.text2, paddingHorizontal: spacing.sp3, paddingTop: spacing.sp1, maxWidth: 260 },
});
