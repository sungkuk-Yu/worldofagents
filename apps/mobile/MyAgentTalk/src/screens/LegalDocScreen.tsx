// 정책 문서 뷰어 — 법률 카드 t_eb7f13e9 항목 4 (이용약관·개인정보처리방침 ko/en)
// 원본은 내변호사 문서(docs/legal)의 assets 복사본 — DRAFT 경고·[대표님 확정 필요] 플레이스홀더를
// 그대로 렌더한다(삭제·수정 금지 — 코멘트 #38/#39). 렌더 sanitize는 MarkdownView(html:false) 소유.
// 진입: ConsentGate 링크 + 설정 > 약관. 헤더 언어 칩으로 ko/en 즉시 전환(앱 언어 설정과 무관하게
// 열람 가능하되, 초기값은 현재 로케일).
import React, { useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MarkdownView from '../components/MarkdownView';
import { colors, radii, spacing, typography, webScreenMotion } from '../theme';
import { legalDocContent, isDraftDoc, type LegalDocKind } from '../lib/legalDocs';

interface Props {
  navigation: any;
  route?: { params?: { kind?: LegalDocKind } };
}

export default function LegalDocScreen({ navigation, route }: Props) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<LegalDocKind>(route?.params?.kind === 'privacy' ? 'privacy' : 'terms');
  // 초기 로케일 = 앱 언어(ko 아니면 en), 이후 헤더 칩으로 덮어쓰기
  const [locale, setLocale] = useState<'ko' | 'en'>(() => (i18n.language && i18n.language.startsWith('ko') ? 'ko' : 'en'));

  const content = useMemo(() => legalDocContent(kind, locale), [kind, locale]);
  const draft = isDraftDoc(content);

  return (
    <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <Text testID="legal-back" style={styles.headerIcon} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={t('common.back')}>{t('common.backIcon')}</Text>
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>{t(kind === 'terms' ? 'legalDoc.terms' : 'legalDoc.privacy')}</Text>
        <View style={styles.langChips}>
          {(['ko', 'en'] as const).map((code) => (
            <Text
              key={code}
              testID={`legal-lang-${code}`}
              accessibilityRole="button"
              style={[styles.langChip, locale === code && styles.langChipActive]}
              onPress={() => setLocale(code)}
            >
              {t(`settings.${code === 'ko' ? 'ko' : 'en'}`)}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.kindRow}>
        {(['terms', 'privacy'] as const).map((k) => (
          <Button
            key={k}
            testID={`legal-kind-${k}`}
            mode={kind === k ? 'contained' : 'text'}
            buttonColor={colors.accent}
            textColor={kind === k ? colors.onPrimary : colors.text2}
            compact
            onPress={() => setKind(k)}
          >
            {t(k === 'terms' ? 'legalDoc.terms' : 'legalDoc.privacy')}
          </Button>
        ))}
      </View>

      {!content ? (
        <View style={styles.missing}><Text style={styles.missingText}>{t('legalDoc.missing')}</Text></View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} testID="legal-doc-scroll">
          {draft && (
            <View style={styles.draftBanner} testID="legal-draft-banner">
              <Text style={styles.draftText}>{t('legalDoc.draftWarning')}</Text>
            </View>
          )}
          <MarkdownView content={content} style={styles.markdown} />
          <Text style={styles.sourceNote}>{t('legalDoc.sourceNote')}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2,
  },
  headerSide: { width: 44, alignItems: 'flex-start', padding: spacing.sp2 },
  headerIcon: { ...typography.title2, color: colors.text1 },
  headerTitle: { ...typography.headline, color: colors.text1, flexShrink: 1, minWidth: 0 },
  langChips: { flexDirection: 'row', gap: spacing.sp1, alignItems: 'center' },
  langChip: {
    ...typography.caption, color: colors.text2, paddingHorizontal: spacing.sp2, paddingVertical: spacing.sp1,
    borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  langChipActive: { color: colors.accent, borderColor: colors.accent, fontWeight: '700' },
  kindRow: { flexDirection: 'row', gap: spacing.sp2, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp1 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing.sp4, paddingBottom: spacing.sp8 },
  draftBanner: {
    backgroundColor: colors.surfaceRaise, borderWidth: 1, borderColor: colors.statusWarn,
    borderRadius: radii.md, padding: spacing.sp3, marginTop: spacing.sp2, marginBottom: spacing.sp2,
  },
  draftText: { ...typography.caption, color: colors.text1 },
  markdown: { ...typography.body, color: colors.text1 },
  missing: { padding: spacing.sp6, alignItems: 'center' },
  missingText: { ...typography.subhead, color: colors.text2 },
  sourceNote: { ...typography.micro, color: colors.text3, marginTop: spacing.sp4 },
});
