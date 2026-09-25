// 다이얼로그 컴포넌트: 멀티 에이전트 협업형 (MultiAgentView) — 세그먼트: 멀티에이전트
// 설계: agenttalk-modern-ux-plan.md §3.1-E · dialogue-functionality-spec.md §3.5
// 에이전트 노드 맵 + 역할 배지 + 협업 모드 + RPC 로그 + 개입/승인 게이트
import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Agent } from '../../types';
import { colors, radii, spacing } from '../../theme';

const SEG = colors.segMulti;
type Mode = 'unified' | 'independent' | 'delegated';

// 목업 에이전트 목록
const MOCK_AGENTS: Agent[] = [
  {
    id: 'agent-1',
    name: '킴',
    persona: '개인 비서 (메인)',
    active: true,
    neurons: [
      { type: 'empathy', active: true, confidence: 1.0, processing: false },
      { type: 'answer', active: true, confidence: 0.88, processing: true },
    ],
  },
  {
    id: 'agent-2',
    name: '애널리스트',
    persona: '데이터 분석가',
    active: true,
    neurons: [{ type: 'answer', active: true, confidence: 0.9, processing: false }],
  },
  {
    id: 'agent-3',
    name: '디자이너',
    persona: '시각 디자인',
    active: false,
    neurons: [],
  },
];

const MODES: { key: Mode; label: string; desc: string }[] = [
  { key: 'unified', label: '통합', desc: '하나의 페르소나로 동작' },
  { key: 'independent', label: '독립', desc: '각자 응답 표시' },
  { key: 'delegated', label: '위임', desc: '메인이 작업 분배' },
];

const RPC_LOG = [
  { t: '14:31:02', from: '킴', to: '애널리스트', msg: 'Q3 데이터 집계 부탁해' },
  { t: '14:31:05', from: '애널리스트', to: '킴', msg: '완료 — 매출/비용 3개월치 전송' },
];

export default function MultiAgentView() {
  const [mode, setMode] = useState<Mode>('unified');

  return (
    <View style={styles.container}>
      <View style={styles.cardHeader}>
        <View style={[styles.segIcon, { backgroundColor: withAlpha(SEG, 0.16) }]}>
          <Text style={[styles.segIconText, { color: SEG }]}>◈</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardType}>멀티에이전트 · 협업</Text>
          <Text style={styles.cardTitle}>분기 리포트 준비</Text>
        </View>
      </View>

      {/* 협업 모드 탭 */}
      <View style={styles.modeTabs}>
        {MODES.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[styles.modeTab, mode === m.key && { backgroundColor: withAlpha(SEG, 0.14), borderColor: SEG }]}
            onPress={() => setMode(m.key)}
          >
            <Text style={[styles.modeTabLabel, mode === m.key && { color: SEG }]}>{m.label}</Text>
            <Text style={styles.modeTabDesc} numberOfLines={1}>{m.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 에이전트 노드 맵 */}
      <View style={styles.agentsList}>
        {MOCK_AGENTS.map((agent, i) => (
          <View
            key={agent.id}
            style={[
              styles.agentCard,
              agent.active && { borderColor: withAlpha(SEG, 0.5) },
              !agent.active && styles.agentCardInactive,
            ]}
          >
            <View style={styles.agentHeader}>
              <View
                style={[
                  styles.agentAvatar,
                  agent.active ? { backgroundColor: withAlpha(SEG, 0.2) } : styles.avatarInactive,
                ]}
              >
                <Text
                  style={[
                    styles.agentAvatarText,
                    { color: agent.active ? SEG : colors.text3 },
                  ]}
                >
                  {agent.name[0]}
                </Text>
              </View>
              <View style={styles.agentInfo}>
                <View style={styles.agentNameRow}>
                  <Text style={[styles.agentName, !agent.active && { color: colors.text3 }]}>
                    {agent.name}
                  </Text>
                  {agent.active && (
                    <View style={[styles.roleBadge, { backgroundColor: withAlpha(SEG, 0.12) }]}>
                      <Text style={[styles.roleBadgeText, { color: SEG }]}>참여 중</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.agentPersona}>{agent.persona}</Text>
              </View>
              <View
                style={[
                  styles.statusDot,
                  agent.active ? { backgroundColor: SEG } : styles.statusDotInactive,
                ]}
              />
            </View>

            {agent.active && agent.neurons.length > 0 && (
              <View style={styles.neuronsRow}>
                {agent.neurons.map((n) => (
                  <View
                    key={n.type}
                    style={[styles.neuronBadge, n.processing && { borderColor: SEG }]}
                  >
                    <Text
                      style={[
                        styles.neuronBadgeText,
                        n.processing && { color: SEG },
                      ]}
                    >
                      {n.type === 'empathy' ? '공감' : '답변생성'}
                      {n.processing ? ' ⏳' : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
      </View>

      {/* RPC 로그 (에이전트 간 대화 열람) */}
      <Text style={styles.sectionLabel}>에이전트 간 통신 (RPC)</Text>
      <View style={styles.rpcLog}>
        {RPC_LOG.map((entry, i) => (
          <View key={i} style={styles.rpcRow}>
            <Text style={styles.rpcTime}>{entry.t}</Text>
            <Text style={[styles.rpcFrom, { color: SEG }]}>{entry.from}</Text>
            <Text style={styles.rpcArrow}>→</Text>
            <Text style={styles.rpcTo}>{entry.to}</Text>
          </View>
        ))}
        <View style={styles.rpcMessage}>
          <Text style={styles.rpcMessageText}>“{RPC_LOG[1]?.msg}”</Text>
        </View>
      </View>

      {/* 개입/승인 게이트 */}
      <View style={styles.gateRow}>
        <Text style={styles.gateText}>승인 대기: 데이터 공유</Text>
        <View style={styles.gateButtons}>
          <TouchableOpacity style={[styles.gateButton, { backgroundColor: SEG }]}>
            <Text style={[styles.gateButtonText, styles.primaryGateText]}>승인</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gateButton}>
            <Text style={styles.gateButtonText}>개입</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.gateButton, styles.stopButton]}>
            <Text style={[styles.gateButtonText, { color: colors.statusErr }]}>중단</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
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
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sp3,
  },
  segIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sp3,
  },
  segIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardType: {
    fontSize: 11,
    color: colors.text3,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text1,
  },
  modeTabs: {
    flexDirection: 'row',
    gap: spacing.sp2,
    marginBottom: spacing.sp4,
  },
  modeTab: {
    flex: 1,
    paddingVertical: spacing.sp2,
    paddingHorizontal: spacing.sp2,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceRaise,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeTabLabel: {
    fontSize: 12,
    color: colors.text2,
    fontWeight: '700',
  },
  modeTabDesc: {
    fontSize: 9,
    color: colors.text3,
    marginTop: 2,
  },
  agentsList: {
    gap: spacing.sp3,
    marginBottom: spacing.sp4,
  },
  agentCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sp4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  agentCardInactive: {
    opacity: 0.55,
  },
  agentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  agentAvatar: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sp3,
  },
  avatarInactive: {
    backgroundColor: colors.surfaceHover,
  },
  agentAvatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  agentInfo: {
    flex: 1,
  },
  agentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
  },
  agentName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text1,
  },
  roleBadge: {
    borderRadius: radii.full,
    paddingHorizontal: spacing.sp2,
    paddingVertical: 1,
  },
  roleBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  agentPersona: {
    fontSize: 12,
    color: colors.text3,
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotInactive: {
    backgroundColor: colors.borderStrong,
  },
  neuronsRow: {
    flexDirection: 'row',
    gap: spacing.sp2,
    marginTop: spacing.sp3,
    paddingTop: spacing.sp3,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  neuronBadge: {
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
    borderRadius: radii.xs,
    backgroundColor: colors.surfaceRaise,
    borderWidth: 1,
    borderColor: colors.border,
  },
  neuronBadgeText: {
    fontSize: 10,
    color: colors.text2,
    fontWeight: '500',
  },
  sectionLabel: {
    fontSize: 11,
    color: colors.text3,
    fontWeight: '700',
    marginBottom: spacing.sp2,
  },
  rpcLog: {
    backgroundColor: colors.surfaceRaise,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sp3,
    marginBottom: spacing.sp4,
  },
  rpcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp1,
  },
  rpcTime: {
    fontSize: 10,
    color: colors.text3,
    fontVariant: ['tabular-nums'],
  },
  rpcFrom: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: spacing.sp2,
  },
  rpcArrow: {
    fontSize: 10,
    color: colors.text3,
  },
  rpcTo: {
    fontSize: 12,
    color: colors.text2,
  },
  rpcMessage: {
    marginTop: spacing.sp2,
    paddingTop: spacing.sp2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rpcMessageText: {
    fontSize: 12,
    color: colors.text2,
    fontStyle: 'italic',
  },
  gateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: withAlpha(colors.statusWarn, 0.07),
    borderWidth: 1,
    borderColor: withAlpha(colors.statusWarn, 0.3),
    borderRadius: radii.md,
    padding: spacing.sp3,
    gap: spacing.sp2,
  },
  gateText: {
    fontSize: 12,
    color: colors.text2,
    fontWeight: '600',
    flexShrink: 1,
  },
  gateButtons: {
    flexDirection: 'row',
    gap: spacing.sp1,
  },
  gateButton: {
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
    borderRadius: radii.xs,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gateButtonText: {
    fontSize: 12,
    color: colors.text1,
    fontWeight: '600',
  },
  primaryGateText: {
    color: colors.onPrimary,
  },
  stopButton: {
    backgroundColor: withAlpha(colors.statusErr, 0.08),
    borderColor: withAlpha(colors.statusErr, 0.35),
  },
});