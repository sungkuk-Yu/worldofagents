import React, { useRef, useState } from 'react';
import { Modal, View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { forkTitle, parseForkSession } from '../lib/cardLogic';
import { errorKey } from '../lib/errorKeys';
import { colors, radii, spacing } from '../theme';

export default function ForkDialog({ sessionId, messageId, title: sourceTitle, navigation, onClose }: {
  sessionId: string; messageId: string; title: string; navigation: any; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(() => forkTitle(t, sourceTitle));
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (submitting.current || !title.trim()) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const env = await api.forkSession(sessionId, { from_message_id: messageId, new_session_title: title.trim() });
      if (!env.ok) throw new Error('errors.fork');
      const session = parseForkSession(env.data, sessionId);
      // 새 방은 목록과 동등한 진입점이며 뒤로 가기는 원본 대신 목록으로 향한다.
      navigation.reset({ index: 1, routes: [
        { name: 'DialogueList' },
        { name: 'Chat', params: { sessionId: session.id, sessionTitle: session.title || title.trim(),
          forkedFrom: { ...(session.forked_from ?? { session_id: sessionId, message_id: messageId }), title: session.forked_from?.title || sourceTitle } } },
      ] });
      onClose();
    } catch (e) { setError(errorKey(e)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Modal transparent visible onRequestClose={() => !busy && onClose()}>
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.dialog}>
        <Text>{t('fork.confirm')}</Text>
        <TextInput testID="fork-title" label={t('fork.title')} value={title} onChangeText={setTitle} disabled={busy} maxLength={200} />
        {error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
        <Button disabled={busy} onPress={onClose}>{t('common.cancel')}</Button>
        <Button testID="fork-submit" loading={busy} disabled={busy || !title.trim()} onPress={() => void submit()}>{t('fork.action')}</Button>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.sp4 },
  dialog: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.sp4, gap: spacing.sp3, minWidth: 0 },
  error: { color: colors.statusErr },
});
