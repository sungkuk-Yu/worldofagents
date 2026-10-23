import React, { useRef, useState } from 'react';
import { Modal, View, StyleSheet, KeyboardAvoidingView, Platform, Pressable, Keyboard } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { forkTitle, parseForkSession } from '../lib/cardLogic';
import { errorKey } from '../lib/errorKeys';
import { colors, radii, spacing } from '../theme';
import { useReduceMotion } from '../lib/motion';

export default function ForkDialog({ sessionId, messageId, title: sourceTitle, navigation, onClose, visible = true }: {
  sessionId: string; messageId: string; title: string; navigation: any; onClose: () => void; visible?: boolean;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const [title, setTitle] = useState(() => forkTitle(t, sourceTitle));
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { if (busy) return; Keyboard.dismiss(); onClose(); };
  const submit = async () => {
    if (submitting.current || !title.trim()) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const env = await api.forkSession(sessionId, { from_message_id: messageId, new_session_title: title.trim() });
      if (!env.ok) throw new Error('errors.fork');
      const session = parseForkSession(env.data, sessionId);
      // 햅틱 (#52 규칙 4): 포크 완료 = success notification — 이 3곳 외 남용 금지
      try { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); } catch { /* web no-op */ }
      // 새 방은 목록과 동등한 진입점이며 뒤로 가기는 원본 대신 목록으로 향한다.
      Keyboard.dismiss();
      navigation.reset({ index: 1, routes: [
        { name: 'DialogueList' },
        { name: 'Chat', params: { sessionId: session.id, sessionTitle: session.title || title.trim(),
          forkedFrom: { ...(session.forked_from ?? { session_id: sessionId, message_id: messageId }), title: session.forked_from?.title || sourceTitle } } },
      ] });
      onClose();
    } catch (e) { setError(errorKey(e)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Modal transparent visible={visible} animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={close}>
    <Pressable style={styles.backdrop} onPress={close} testID="fork-backdrop">
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.dialog} onPress={(event) => event.stopPropagation()} accessibilityViewIsModal testID="fork-dialog">
          <View style={styles.header}>
            <Text>{t('fork.confirm')}</Text>
            <Pressable onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel={t('common.close')} testID="fork-close" style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <TextInput testID="fork-title" label={t('fork.title')} value={title} onChangeText={setTitle} disabled={busy} maxLength={200} returnKeyType="done" onSubmitEditing={() => void submit()} />
          {error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
          <Button disabled={busy} onPress={close} testID="fork-cancel">{t('common.cancel')}</Button>
          <Button testID="fork-submit" loading={busy} disabled={busy || !title.trim()} onPress={() => void submit()}>{t('fork.action')}</Button>
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.sp4 },
  dialog: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.sp4, gap: spacing.sp3, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeBtn: { padding: spacing.sp1 },
  closeText: { color: colors.text3, fontSize: 18 },
  error: { color: colors.statusErr },
});
