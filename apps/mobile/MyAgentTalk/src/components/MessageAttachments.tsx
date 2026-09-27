// 첨부 렌더 (t_4497cfce P1-2) — 전송된 user 메시지의 첨부 표시 소스:
// messages.attachments JSONB 요약 {id,url,mime,size,name} (백엔드 lib/attachments.ts 주석: frontdev Wave2 독해)
// + 낙관/수신 중엔 로컬 AttachmentDraft(서버 확정 전). 이미지=썸네일 행, 그 외=파일 칩.
import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { AttachmentRef } from '../lib/photoLogic';
import { normalizeAttachments } from '../lib/photoLogic';
import { colors, radii, spacing, typography } from '../theme';

const openUrl = (url: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
};

export function MessageAttachments({ value, drafts, onRetryDraft }: {
  value?: unknown;               // messages.attachments (서버 행)
  drafts?: { localId: string; name: string; uri: string; localUri?: string; type: string; status: 'uploading' | 'done' | 'error'; errorKey?: string; result?: { id: string } }[];
  onRetryDraft?: (localId: string) => void;
}) {
  const { t } = useTranslation();
  const server: AttachmentRef[] = normalizeAttachments(value);
  if (!server.length && !drafts?.length) return null;
  const local = (drafts ?? []).filter((d) => d.status !== 'done');
  const doneDrafts = (drafts ?? []).filter((d) => d.status === 'done' && !server.some((a) => a.id === d.result?.id));
  return (
    <View style={st.wrap} testID="message-attachments">
      {server.map((a) => a.mime.startsWith('image/') ? (
        <TouchableOpacity key={a.id} onPress={() => openUrl(a.url)} accessibilityLabel={a.name ?? t('attachments.open')}>
          <Image source={{ uri: a.url }} style={st.thumb} contentFit="cover" transition={150} accessibilityLabel={a.name ?? t('attachments.image')} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity key={a.id} style={st.fileChip} onPress={() => openUrl(a.url)} accessibilityLabel={a.name ?? t('attachments.file')}>
          <Text style={st.fileName} numberOfLines={1}>{a.name ?? t('attachments.file')}</Text>
        </TouchableOpacity>
      ))}
      {(doneDrafts).map((d) => (
        <Image key={d.localId} source={{ uri: d.localUri || d.uri }} style={st.thumb} contentFit="cover" transition={150} accessibilityLabel={d.name} />
      ))}
      {local.map((d) => (
        <View key={d.localId} style={st.thumbWrap}>
          {d.status === 'uploading' && <View style={st.overlay}><Text style={st.overlayText}>{t('attachments.uploading')}</Text></View>}
          {d.status === 'error' && (
            <View style={st.overlay}>
              <Text style={st.overlayText} numberOfLines={2}>{t(d.errorKey ?? 'errors.uploadFailed')}</Text>
              <TouchableOpacity onPress={() => onRetryDraft?.(d.localId)} testID={`attach-retry-${d.localId}`}><Text style={st.retry}>{t('common.retry')}</Text></TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp2, marginTop: spacing.sp2 },
  thumb: { width: 96, height: 96, borderRadius: radii.sm, backgroundColor: colors.surfaceRaise },
  thumbWrap: { width: 96, height: 96, borderRadius: radii.sm, overflow: 'hidden', position: 'relative' },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(26,29,38,0.62)', alignItems: 'center', justifyContent: 'center', padding: spacing.sp1 },
  overlayText: { ...typography.microSm, color: colors.onPrimary, textAlign: 'center' },
  retry: { ...typography.microSm, color: colors.accent, textDecorationLine: 'underline', marginTop: 2 },
  fileChip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.sm, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, maxWidth: 220 },
  fileName: { ...typography.caption, color: colors.text1 },
});
