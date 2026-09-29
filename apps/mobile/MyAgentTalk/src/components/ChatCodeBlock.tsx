// 마크다운 코드블록 — 채팅 버블용 (t_e9480e0f 백로그①).
// Wave1 RichText의 CodeBlock과 동일 계약: 배경(surfaceRaise)·monospace·복사 버튼(testID code-copy).
// 복사 성공 시 '복사됨 ✓'(i18n cards.copied). 대표님 복사 우선 원칙(카드 지시 ③).
import React, { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { Text } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import * as Haptics from 'expo-haptics';

async function copyText(value: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard.writeText(value);
      return true;
    }
    await Clipboard.setStringAsync(value);
    try { void Haptics.selectionAsync().catch(() => undefined); } catch { /* native unavailable */ }
    return true;
  } catch { return false; }
}

export default function ChatCodeBlock({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    void copyText(text).then((ok) => {
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  // Wave1 RichText CodeBlock과 동일 구조: View 래퍼 + 본문 RNText(selectable) + 우하단 복사 Pressable.
  return <View style={styles.block} testID="markdown-code-block">
    <RNText selectable style={styles.code}>{text}</RNText>
    <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={t('cards.copyCode')} testID="code-copy" style={styles.copyButton}>
      <Text style={styles.copyText}>{copied ? t('cards.copied') : t('cards.copy')}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surfaceRaise, borderRadius: radii.sm, padding: spacing.sp3, marginVertical: spacing.sp2, gap: spacing.sp2 },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12.5, lineHeight: 19, color: colors.text1 },
  copyButton: { alignSelf: 'flex-end', paddingVertical: spacing.sp1 },
  copyText: { ...typography.caption, color: colors.accent },
});
