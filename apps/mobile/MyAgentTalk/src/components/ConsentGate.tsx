// 가입 동의 게이트 — 대표님 지시 레이아웃 최종본 (코멘트 #83, #67·#82 통합):
//   ① 전체 동의 = 분리된 강조 블록 ② 6개 항목(약관/개인정보/마케팅/음성/국외이전/14세)을
//      하나의 자연스러운 목록으로 섞어 배치 — 마케팅 행의 "[선택]" 문구·저대비 스타일 제거,
//      글자크기·색·행간 필수 항목과 동일 (스크롤하면 그냥 지나가는 목록).
//   기능 불변: validateConsents = marketing 제외 4종+14세 필수, marketing 기본 false(opt-in),
//   서버 consents 기록 동일, testID 계약 동일 (기존 단위/e2e 테스트 통과 조건).
//   ※ 법적 유효성(구분 없는 표시가 개인정보보호법 제22조 선택동의를 훼손하는지) 내변호사 확인 중 —
//      문제 제기 시 "작게 구분" 폴백(의도 훼손 최소선)으로 되돌린다.
//   법률 카드 t_eb7f13e9: 약관/처리방침 링크는 example.com 임시 주소 폐기 — 앱 내 정책 문서 화면
//   (LegalDocScreen, 내변호사 초안 원문)으로 연결. DRAFT·[대표님 확정 필요] 고지는 문서 본문에 유지.
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import type { LegalDocKind } from '../lib/legalDocLogic';
import { ConsentState, toggleRequiredConsents, validateConsents } from '../lib/consents';

// 햅틱: 동의 토글 = selection (#52 지시의 3곳 중 하나). 웹은 expo-haptics가 no-op 폴백이라 try로 방어.
const selectionTick = () => {
  try { void Haptics.selectionAsync().catch(() => undefined); } catch { /* native unavailable */ }
};

const testIds = { terms: 'terms', privacy: 'privacy', voice_recording: 'voice', overseas_transfer: 'overseas', marketing: 'marketing', ageConfirmed: 'age14' } as const;
// #83 최종본: 마케팅(선택)을 필수 항목들 사이에 섞은 단일 목록 — 약관/개인정보/마케팅/음성/국외이전/14세.
// 구분(스타일·문구) 없음. 기능 검증은 marketing 제외(lib/consents.ts) — 표시와 로직은 독립.
const consentOrder = ['terms', 'privacy', 'marketing', 'voice_recording', 'overseas_transfer', 'ageConfirmed'] as const;

export default function ConsentGate({ value, onChange, disabled, onError, onOpenDoc }: {
  value: ConsentState; onChange: (value: ConsentState) => void; disabled: boolean; onError: (key: string) => void;
  /** 앱 내 정책 문서 화면 진입 (t_eb7f13e9 항목 4). 미주입 시 링크 행 숨김 — 컴포넌트 단독 재사용 안전. */
  onOpenDoc?: (kind: LegalDocKind) => void;
}) {
  const { t } = useTranslation();
  const toggle = (next: ConsentState) => { selectionTick(); onChange(next); };
  const checkbox = (key: string, checked: boolean, onPress: () => void, testID: string, styleOverride?: { row?: object; box?: object; label?: object }) => (
    <Pressable key={key} onPress={onPress} disabled={disabled} accessibilityRole="checkbox"
      accessibilityLabel={t(key)} accessibilityState={{ checked, disabled }} testID={testID}
      style={[styles.row, styleOverride?.row]}>
      <View style={[styles.box, styleOverride?.box, checked && styles.checked]}>
        {checked && <Text style={styles.check}>{t('consent.checkedIcon')}</Text>}
      </View>
      <Text style={[styles.label, styleOverride?.label]}>{t(key)}</Text>
    </Pressable>
  );
  return <View style={styles.container}>
    {/* ① 전체 동의 — 목록 행이 아닌 분리된 강조 블록 (카드 배경 + 큰 체크박스 + 굵은 라벨) */}
    {checkbox('consent.allRequired', validateConsents(value), () => toggle(toggleRequiredConsents(value)), 'consent-all-required',
      { row: styles.allRow, box: styles.allBox, label: styles.allLabel })}

    <View style={styles.divider} />

    {/* ② 단일 자연 목록 — 마케팅(선택)을 필수 사이에 섞음, 스타일 구분 없음 (#83) */}
    {consentOrder.map((type) => <View key={type}>
      {checkbox(`consent.${type}`, value[type], () => toggle({ ...value, [type]: !value[type] }), `consent-${testIds[type]}`)}
      {type === 'voice_recording' && <Text style={styles.notice}>{t('consent.voiceNotice')}</Text>}
      {type === 'overseas_transfer' && <Text style={styles.notice}>{t('consent.overseasNotice')}</Text>}
    </View>)}

    {onOpenDoc && <View style={styles.links}>
      {(['terms', 'privacy'] as const).map((kind) => <Pressable key={kind} accessibilityRole="link" style={styles.link}
        testID={`consent-link-${kind}`} onPress={() => onOpenDoc(kind)}>
        <Text style={styles.linkText}>{t(kind === 'terms' ? 'consent.viewTerms' : 'consent.viewPrivacy')}</Text>
      </Pressable>)}
    </View>}
    <Text style={styles.notice}>{t('consent.documentsPending')}</Text>
  </View>;
}
const styles = StyleSheet.create({
  container: { marginVertical: spacing.sp3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, minHeight: spacing.sp10 + spacing.sp2, paddingVertical: spacing.sp2 },
  box: { width: spacing.sp6, height: spacing.sp6, borderWidth: 1, borderColor: colors.accent, borderRadius: radii.xs, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.accent },
  check: { ...typography.bodyBold, color: colors.onPrimary },
  label: { ...typography.subhead, color: colors.text1, flex: 1, minWidth: 0 },
  // 전체 동의 — 분리 블록: 카드 배경 + 큰 체크박스 + 굵은 라벨
  allRow: {
    backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp3, minHeight: spacing.sp10,
    ...(Platform.OS === 'web' ? {} : { shadowColor: 'rgba(16,24,40,0.06)', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 2, elevation: 2 }),
  },
  allBox: { width: spacing.sp8, height: spacing.sp8, borderRadius: radii.sm, borderWidth: 2 },
  allLabel: { ...typography.bodyBold, fontWeight: '700', color: colors.text1 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sp2 },
  notice: { ...typography.caption, color: colors.text2, marginBottom: spacing.sp2, flexShrink: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp2 },
  link: { paddingVertical: spacing.sp3, flexShrink: 1 },
  linkText: { ...typography.caption, color: colors.accent },
});
