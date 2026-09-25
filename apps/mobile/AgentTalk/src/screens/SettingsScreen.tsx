// Screen 5: 설정 (SettingsScreen)
// 설계: agenttalk-screen-spec.md 화면 5 — 왼손잡이 모드, 햅틱, 자동 전환, 조이스틱 커스터마이징 진입
import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { colors, radii, spacing } from '../theme';

interface Props {
  navigation: any;
}

export default function SettingsScreen({ navigation }: Props) {
  const [leftHandMode, setLeftHandMode] = React.useState(false);
  const [hapticFeedback, setHapticFeedback] = React.useState(true);
  const [autoTransition, setAutoTransition] = React.useState(true);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>설정</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.sectionTitle}>인터페이스</Text>

        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>왼손잡이 모드</Text>
              <Text style={styles.settingDescription}>조이스틱 예/아니오 방향도 함께 반전됩니다</Text>
            </View>
            <Switch
              value={leftHandMode}
              onValueChange={setLeftHandMode}
              trackColor={{ false: colors.surfaceHover, true: colors.accent }}
              thumbColor={colors.text1}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>햅틱 피드백</Text>
              <Text style={styles.settingDescription}>방향 감지 및 확정 시 진동</Text>
            </View>
            <Switch
              value={hapticFeedback}
              onValueChange={setHapticFeedback}
              trackColor={{ false: colors.surfaceHover, true: colors.accent }}
              thumbColor={colors.text1}
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: spacing.sp6 }]}>대화</Text>

        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>자동 컴포넌트 전환</Text>
              <Text style={styles.settingDescription}>대화 유형 자동 판별 후 전환</Text>
            </View>
            <Switch
              value={autoTransition}
              onValueChange={setAutoTransition}
              trackColor={{ false: colors.surfaceHover, true: colors.accent }}
              thumbColor={colors.text1}
            />
          </View>

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('NeuronDashboard')}
          >
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>뉴런 대시보드</Text>
              <Text style={styles.settingDescription}>에이뉴런 연결 상태 모니터링</Text>
            </View>
            <Text style={styles.chevron}>→</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: spacing.sp6 }]}>조이스틱</Text>

        <View style={styles.settingCard}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => console.log('[Settings] 조이스틱 커스터마이징 (다음 라운드)')}
          >
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>조이스틱 커스터마이징</Text>
              <Text style={styles.settingDescription}>8방향 = 액션 슬롯 (프리셋: 기본/업무모드)</Text>
            </View>
            <Text style={styles.chevron}>→</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footerText}>에이전트톡 v0.1 · 월드오브에이전트</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
  },
  headerButton: {
    width: 44,
    alignItems: 'flex-start',
    padding: spacing.sp2,
  },
  headerButtonText: {
    fontSize: 20,
    color: colors.text1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text1,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacing.sp4,
    paddingBottom: spacing.sp8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sp2,
  },
  settingCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingBody: {
    flex: 1,
    paddingRight: spacing.sp3,
  },
  settingLabel: {
    fontSize: 15,
    color: colors.text1,
    fontWeight: '500',
  },
  settingDescription: {
    fontSize: 12,
    color: colors.text3,
    marginTop: 3,
    lineHeight: 17,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp4,
  },
  chevron: {
    fontSize: 18,
    color: colors.text3,
  },
  footerText: {
    marginTop: spacing.sp8,
    textAlign: 'center',
    fontSize: 11,
    color: colors.text3,
  },
});