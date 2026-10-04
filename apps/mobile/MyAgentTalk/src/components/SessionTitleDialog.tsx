// 대화 제목 수정 다이얼로그 (t_8917ca0d ③, 대표님 10/4 "에이전트와의 대화 제목도 수정할 수 있도록")
// 진입: ① 세션 목록 행 롱프레스 ② 채팅방 헤더 탭 — 두 지점 동일 컴포넌트 공유.
// 저장: PATCH /api/sessions/:id/title { title } (컨트랙트: 백카드 t_8917ca0d-be 구현, 006 sessions.title
// 캐논 컬럼 재사용·마이그레이션 불요). 실패 시 서버 문구를 노출하지 않고 errors 키로 안내 (errorKey 규율).
// 성공 시 onSuccess(새 제목) → 호출측이 로컬 상태 즉시 반영(목록 행 / 앱바), 목록은 focus 시 재fetch.
import React, { useRef, useState } from 'react';
import { Modal, View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorKey } from '../lib/errorKeys';
import { colors, radii, spacing } from '../theme';

export default function SessionTitleDialog({ sessionId, title, onClose, onRenamed }: {
  sessionId: string; title: string; onClose: () => void; onRenamed: (newTitle: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();
  const submit = async () => {
    if (submitting.current || !trimmed) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const env = await api.renameSession(sessionId, trimmed);
      if (!env.ok) throw new Error('errors.renameSession');
      onRenamed(trimmed);
      onClose();
    } catch (e) { setError(errorKey(e)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Modal transparent visible onRequestClose={() => !busy && onClose()}>
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.dialog} testID="rename-dialog">
        <Text>{t('rename.prompt')}</Text>
        <TextInput testID="rename-title" label={t('rename.title')} value={value} onChangeText={setValue} disabled={busy} maxLength={200} />
        {error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
        <Button disabled={busy} onPress={onClose}>{t('common.cancel')}</Button>
        <Button testID="rename-save" loading={busy} disabled={busy || !trimmed} onPress={() => void submit()}>{t('rename.save')}</Button>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.sp4 },
  dialog: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.sp4, gap: spacing.sp3, minWidth: 0 },
  error: { color: colors.statusErr },
});
