// 리치텍스트 렌더러 — Wave 1 #4. 세그먼트를 Text 조합으로 그림.
// 링크 탭 = Linking.openURL (in-app browser), 코드/코드블록 = 복제 버튼 + 성공 토스트(expo-clipboard).
// 본문 선택 복제: RN=selectable, 웹=네이티브 선택 (selectable은 웹에서 no-op이 아니므로 그대로 둔다).
import React, { useCallback, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { Text } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { RichSegment, parseRichText } from '../lib/richtext';
import { cardStyles } from '../cards/styles';
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

function CodeBlock({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    void copyText(text).then((ok) => {
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return <View style={styles.codeBlock}>
    <RNText selectable style={styles.codeText}>{text}</RNText>
    <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={t('cards.copyCode')} testID="code-copy" style={styles.copyButton}>
      <Text style={styles.copyText}>{copied ? t('cards.copied') : t('cards.copy')}</Text>
    </Pressable>
  </View>;
}

export default function RichText({ content, style }: { content: string; style?: object }) {
  const { t } = useTranslation();
  const [copiedInline, setCopiedInline] = useState<string | null>(null);
  const segments = parseRichText(content);
  if (!segments.length) return null;
  const openLink = (url: string) => { void Linking.openURL(url).catch(() => undefined); };
  const copyInline = (value: string) => {
    void copyText(value).then((ok) => {
      if (ok) { setCopiedInline(value); setTimeout(() => setCopiedInline(null), 2000); }
    });
  };
  return <View>
    {segments.map((seg: RichSegment, i) => {
      switch (seg.kind) {
        case 'link':
          return <Pressable key={i} onPress={() => openLink(seg.url)} accessibilityRole="link" testID="rich-link" style={styles.inline}>
            <Text style={[styles.link, style]}>{seg.text}</Text>
          </Pressable>;
        case 'code':
          return <Pressable key={i} onLongPress={() => copyInline(seg.text)} onPress={() => copyInline(seg.text)} accessibilityRole="button" style={styles.inline}>
            <Text style={[styles.code, style]}>{copiedInline === seg.text ? t('cards.copied') : seg.text}</Text>
          </Pressable>;
        case 'codeblock':
          return <CodeBlock key={i} text={seg.text} />;
        case 'quote':
          return <View key={i} style={styles.quote}><RNText selectable style={styles.quoteText}>{seg.text}</RNText></View>;
        default:
          return <RNText key={i} selectable style={[cardStyles.body, style]}>{seg.text}</RNText>;
      }
    })}
  </View>;
}

const styles = StyleSheet.create({
  inline: { alignSelf: 'flex-start' },
  link: { ...typography.body, color: colors.accent, textDecorationLine: 'underline', flexShrink: 1 },
  code: { ...typography.body, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, color: colors.text1, backgroundColor: colors.surfaceRaise, borderRadius: radii.xs, paddingHorizontal: spacing.sp1, overflow: 'hidden' },
  codeBlock: { backgroundColor: colors.surfaceRaise, borderRadius: radii.sm, padding: spacing.sp3, marginVertical: spacing.sp2, gap: spacing.sp2 },
  codeText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12.5, lineHeight: 19, color: colors.text1 },
  copyButton: { alignSelf: 'flex-end', paddingVertical: spacing.sp1 },
  copyText: { ...typography.caption, color: colors.accent },
  copied: { color: colors.statusOk },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.borderStrong, paddingLeft: spacing.sp3, marginVertical: spacing.sp1 },
  quoteText: { ...typography.body, color: colors.text2, fontStyle: 'italic' },
});
