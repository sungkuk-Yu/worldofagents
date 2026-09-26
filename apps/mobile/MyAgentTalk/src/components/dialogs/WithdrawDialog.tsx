// 회원탈퇴 확인 다이얼로그 — 법률 카드 t_eb7f13e9 항목 5
// 파기 대상(백엔드 routes/me.ts 실측: auth.users 삭제 → FK ON DELETE CASCADE): 계정·프로필·
// 대화 세션·메시지·원본 음성 녹음(raw_transcripts)·압축 메모리·볼트 노트·보드/카드·태스크·동의 기록.
// 복원 불가 경고 + 확인 토글을 통과해야만 DELETE /api/me 가 나간다 (기본 안전장치).
import React, { useRef, useState } from 'react';
import { Modal, ScrollView, View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { api, setToken } from '../../lib/api';
import { errorKey } from '../../lib/errorKeys';
import { colors, radii, spacing, typography } from '../../theme';

export default function WithdrawDialog({ navigation, onClose }: {
  navigation: any; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current || !ack || busy) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const env = await api.deleteMe();
      if (!env.ok || env.data?.deleted !== true) throw new Error('errors.withdraw');
      // 서버가 계정을 파기했으므로 로컬 세션/토큰도 즉시 정리 → 로그인 화면으로.
      await setToken(null);
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      onClose();
    } catch (e) {
      setError(errorKey(e));
      setBusy(false); submitting.current = false;
    }
  };
  return <Modal transparent visible onRequestClose={() => !busy && onClose()}>
    <View style={styles.overlay}>
      <View style={styles.dialog} testID="withdraw-dialog">
        <Text style={styles.title}>{t('withdraw.title')}</Text>
        <ScrollView style={styles.scopeScroll}>
          <Text style={styles.scope}>{t('withdraw.scope')}</Text>
        </ScrollView>
        <Button
          mode="text" compact testID="withdraw-ack"
          onPress={() => { if (!busy) setAck(!ack); }}
          textColor={ack ? colors.accent : colors.text2}
        >
          {t('withdraw.ack')}{ack ? ' ✓' : ''}
        </Button>
        {error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
        <View style={styles.actions}>
          <Button testID="withdraw-cancel" disabled={busy} onPress={onClose}>{t('common.cancel')}</Button>
          <Button
            testID="withdraw-confirm" mode="contained" loading={busy} disabled={busy || !ack}
            onPress={() => void submit()} buttonColor={colors.statusErr} textColor={colors.onPrimary}
          >
            {t(busy ? 'withdraw.busy' : 'withdraw.confirm')}
          </Button>
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.sp4 },
  dialog: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.sp4, gap: spacing.sp3, minWidth: 0 },
  title: { ...typography.headline, color: colors.statusErr },
  scopeScroll: { maxHeight: spacing.sp10 * 4 },
  scope: { ...typography.caption, color: colors.text2, lineHeight: 18 },
  error: { color: colors.statusErr, ...typography.caption },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sp2 },
});
