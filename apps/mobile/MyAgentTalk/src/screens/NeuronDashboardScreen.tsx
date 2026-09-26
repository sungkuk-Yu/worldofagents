// Screen: 뉴런 대시보드 (Neuron Dashboard)
// 뉴런 연결 상태 모니터링 — 디버그 및 고급 사용자용 (설정 진입)
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { NeuronState, NeuronType } from '../types';
import { colors, radii, spacing, typography, iconSize, webScreenMotion } from '../theme';

interface Props {
  navigation: any;
}

const NEURON_COLORS: Record<NeuronType, string> = {
  empathy: colors.segInfo,
  answer: colors.accent,
  visual: colors.segFile,
  custom: colors.segData,
};

// 목업 뉴런 상태
const MOCK_NEURONS: NeuronState[] = [
  { type: 'empathy', active: true, confidence: 1.0, processing: false },
  { type: 'answer', active: true, confidence: 0.92, processing: true },
  { type: 'visual', active: false, confidence: 0, processing: false },
  { type: 'custom', active: false, confidence: 0, processing: false },
];

export default function NeuronDashboardScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [neurons, setNeurons] = useState<NeuronState[]>(MOCK_NEURONS);

  const toggleNeuron = (type: NeuronType) => {
    setNeurons((prev) =>
      prev.map((n) =>
        n.type === type ? { ...n, active: !n.active } : n
      )
    );
  };

  return (
    <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('neuron.title')}</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.sectionTitle}>{t('neuron.sectionActive')}</Text>
        {neurons.map((neuron) => {
          const nc = NEURON_COLORS[neuron.type];
          const label = t(`neuron.${neuron.type}`);
          return (
            <TouchableOpacity
              key={neuron.type}
              style={[styles.neuronCard, { borderLeftColor: neuron.active ? nc : colors.borderStrong }]}
              onPress={() => toggleNeuron(neuron.type)}
              accessibilityLabel={`${label} ${t(neuron.active ? 'neuron.active' : 'neuron.inactive')}`}
            >
              <View style={styles.neuronHeader}>
                <View style={[styles.neuronIcon, { backgroundColor: withAlpha(nc, 0.12) }]}>
                  <Text style={[styles.neuronIconText, { color: nc }]}>
                    {neuron.type === 'empathy' ? '♡' : neuron.type === 'answer' ? '✎' : neuron.type === 'visual' ? '◫' : '+'}
                  </Text>
                </View>
                <View style={styles.neuronNameWrap}>
                  <Text style={styles.neuronName}>{label}</Text>
                  <Text style={styles.neuronDescription}>
                    {t(`neuron.${neuron.type}Desc`)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    neuron.active ? { backgroundColor: withAlpha(colors.statusOk, 0.12) } : styles.statusInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: neuron.active ? colors.statusOk : colors.text3 },
                    ]}
                  >
                    {t(neuron.active ? 'neuron.active' : 'neuron.inactive')}
                  </Text>
                </View>
              </View>

              {neuron.active && (
                <View style={styles.metricsRow}>
                  <Text style={[styles.metric, { color: nc }]}>
                    {t('neuron.confidence', { pct: (neuron.confidence * 100).toFixed(0) })}
                  </Text>
                  {neuron.processing && (
                    <Text style={styles.processingIndicator}>{t('neuron.processing')}</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        <Text style={[styles.sectionTitle, { marginTop: spacing.sp6 }]}>{t('neuron.events')}</Text>
        <View style={styles.emptyEvents}>
          <Text style={styles.emptyEventsText}>{t('neuron.noEvents')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
    padding: spacing.sp2,
  },
  headerButtonText: {
    ...typography.title2,
    fontSize: iconSize.glyphLg,
    color: colors.text1,
  },
  headerTitle: {
    ...typography.headline,
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
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.text3,
    textTransform: 'uppercase',
    marginBottom: spacing.sp3,
  },
  neuronCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    padding: spacing.sp4,
    marginBottom: spacing.sp3,
  },
  neuronHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  neuronIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sp3,
  },
  neuronIconText: {
    ...typography.body,
    fontSize: iconSize.tile,
    fontWeight: '700',
  },
  neuronNameWrap: {
    flex: 1,
  },
  neuronName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text1,
  },
  neuronDescription: {
    ...typography.caption,
    color: colors.text3,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
    borderRadius: radii.full,
  },
  statusInactive: {
    backgroundColor: colors.surfaceHover,
  },
  statusText: {
    ...typography.micro,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sp3,
    paddingTop: spacing.sp3,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  metric: {
    ...typography.caption,
    fontWeight: '600',
  },
  processingIndicator: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.statusWarn,
  },
  emptyEvents: {
    padding: spacing.sp6,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyEventsText: {
    ...typography.subhead,
    color: colors.text3,
  },
});