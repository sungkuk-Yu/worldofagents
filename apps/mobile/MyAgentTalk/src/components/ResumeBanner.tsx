// 이어볼 세션 배너 — GET /api/sessions/resume 기반 크로스 디바이스 연속성 UX (t_eded715c 요구 2).
// 다른 기기에서 읽지 않은 메시지가 있는 추천 세션을 상시 노출 → 탭이면 그 세션으로 진입.
// 라벨은 백엔드 presence 화이트리스트(pc-web/mobile-web/...)를 device.* i18n 키로 번역한다.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { ResumeItem, normalizeResumeItems } from '../lib/resumeLogic';
import { deviceLabelKey } from '../lib/deviceLabel';
import { formatNumber } from '../i18n/format';
import { colors, radii, spacing, typography, cardBase, shadows } from '../theme';

interface Props {
  /** 탭 시 세션 진입 (모바일: Stack push / PC: 3패널 채팅 전환) */
  onOpen: (item: ResumeItem) => void;
  testID?: string;
}

export default function ResumeBanner({ onOpen, testID = 'resume-banner' }: Props) {
  const { t, i18n } = useTranslation();
  const [item, setItem] = useState<ResumeItem | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getResume(5).then((env) => {
      if (!alive || !env.ok) return;
      const parsed = normalizeResumeItems(env);
      const rec = parsed.items.find((i) => i.recommended) ?? parsed.items[0];
      // 이어볼 가치 = 미읽음이 있는 추천 세션만 (모두 읽은 상태면 배너 없음이 정상)
      setItem(rec && rec.unread > 0 ? rec : null);
    }).catch(() => { /* 오프라인/미로그인 — 배너 없이 정상 */ });
    return () => { alive = false; };
  }, []);
  if (!item) return null;
  const devices = item.liveDevices.map((d) => t(deviceLabelKey(d))).join(' + ');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('resume.open')} testID={testID} onPress={() => onOpen(item)}>
      <View style={styles.wrap}>
        <View style={styles.dot} />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>{t('resume.title')}</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {item.title || item.agent_name || t('common.agent')}
            {' · '}
            {t('resume.unread', { count: formatNumber(item.unread, i18n.language) })}
            {devices ? ` · ${t('resume.liveOn', { devices })}` : ''}
          </Text>
        </View>
        <Text style={styles.go}>→</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...cardBase,
    ...shadows.sh1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
    marginHorizontal: spacing.sp4,
    marginTop: spacing.sp2,
    padding: spacing.sp3,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  dot: { width: 8, height: 8, borderRadius: radii.full, backgroundColor: colors.accent },
  copy: { flex: 1, minWidth: 0 },
  title: { ...typography.caption, fontWeight: '700', color: colors.accent },
  sub: { ...typography.subhead, color: colors.text1, marginTop: 2 },
  go: { ...typography.title2, color: colors.text3 },
});
