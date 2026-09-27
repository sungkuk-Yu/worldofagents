// 첨부 스테이지 칩 행 (t_4497cfce P1-2) — 입력창 위 전송 대기 칩: 썸네일 + 상태(업로드 중/오류 재시도) + 삭제.
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { ActivityIndicator } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { AttachmentDraft } from '../hooks/useAttachments';
import { colors, radii, spacing, typography } from '../theme';

export function AttachmentChipRow({ items, onRemove, onRetry }: {
  items: AttachmentDraft[];
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <ScrollView horizontal style={st.row} testID="attachment-stage" keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
      {items.map((it) => (
        <View key={it.localId} style={st.chip} testID={`stage-${it.localId}`}>
          <Image source={{ uri: it.localUri || it.uri }} style={st.thumb} contentFit="cover" transition={100} />
          {it.status === 'uploading' && <View style={st.busyBadge}><ActivityIndicator size="small" color={colors.onPrimary} testID={`stage-uploading-${it.localId}`} /></View>}
          {it.status === 'error' && (
            <TouchableOpacity style={st.badge} onPress={() => onRetry(it.localId)} testID={`stage-retry-${it.localId}`} accessibilityLabel={t('common.retry')}>
              <Text style={st.badgeText}>!</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={st.remove} onPress={() => onRemove(it.localId)} testID={`stage-remove-${it.localId}`} accessibilityLabel={t('attachments.remove')}>
            <Text style={st.removeText}>×</Text>
          </TouchableOpacity>
          {it.status === 'error' && !!it.errorKey && <Text style={st.errorText} numberOfLines={1}>{t(it.errorKey)}</Text>}
        </View>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  row: { flexGrow: 0 },
  chip: { width: 64, marginRight: spacing.sp2, position: 'relative' },
  thumb: { width: 64, height: 64, borderRadius: radii.sm, backgroundColor: colors.surfaceRaise },
  badge: { position: 'absolute', right: -4, top: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.statusErr, alignItems: 'center', justifyContent: 'center' },
  busyBadge: { position: 'absolute', right: -4, top: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.text1, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...typography.microSm, color: colors.onPrimary },
  remove: { position: 'absolute', left: -4, top: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.text1, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.onPrimary, fontSize: 13, lineHeight: 15 },
  errorText: { ...typography.microXs, color: colors.statusErr, marginTop: 2 },
});
