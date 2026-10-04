// 턴 그룹 행 (t_70cbbd6b: ChatScreen renderItem 본문 순수 추출 — 렌더/DOM/testID 1:1)
// 시간 라인 + 메시지별 카드 래퍼(포커스 하이라이트/선택 토글래퍼/user 메타/실패 재시도행)까지 화면행 전체를 소유.
// 상태 변경은 화면 소유 콜백(decorate/handlers/toggleSelect/retry/delete)을 그대로 호출 — 이 컴포넌트는 로직 무소유.
// t_0e03e405 FINAL SCOPE — 확인응답 스레드화(렌더 층위): 공감 재질문 카드는 메인 顶级 버블이 아니라
// '확인 스레드' 프레임(원문 인용 헤더 + 좌측 인덴트 + testID confirm-thread-*)으로 렌더하고, 병합된
// 확인응답(예/아니요) user 행은 메인 버블 대신 프레임 내부 reply 라인(confirm-reply-*)으로만 보여준다.
// 예/아니요 칩은 프레임 안에 그대로(2.5s 수명·라이브 게이트 불변 — lib/ackChips+useAckChip 소유).
// 원 질문 카드에는 confirm-entry-* 진입 배지(탭 = 해당 공감 카드로 점프). 판정/병합 로직은 전부 lib/ackChips.
import React from 'react';
import { Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import CardFrame from '../../cards/CardFrame';
import AckChipRow from '../AckChipRow';
import { QueueMessageMark } from '../QueueMessageMark';
import { ReplyQuoteLine } from '../ReplyQuoteBar';
import { TickFailedIcon, TickPendingIcon, TickSentIcon, MicIcon } from '../Icon';
import { renderFlags } from '../../lib/renderFlags';
import { formatRecordingDuration } from '../../lib/voiceStage';
import type { ConfirmView } from '../../lib/ackChips';
import { colors, iconSize, radii, spacing, typography } from '../../theme';
import { styles } from '../../screens/chatScreenStyles';
import type { ChatMessage, QueueItem, SenderGroupFlag, TurnGroup } from '../../lib/chatLogic';
import type { CardActionHandlers } from '../../cards/types';

interface Props {
  group: TurnGroup;
  timeLabel: string | null | undefined;
  highlightId: string | null;
  /** t_c62a2eb7: 예/아니요 대형 버튼 행이 붙은 공감 재질문 카드 id (없으면 null — 수명 판정은 화면/useAckChip 소유) */
  ackChipId?: string | null;
  /** t_64e3edd6 ②: ack 결과(탭/조이스틱 '예'·'아니요' 발화) user 카드 id 집합 — 렌더 제외(전송은 정상 진행) */
  hiddenAckIds?: Set<string>;
  /** t_0e03e405: 확인 스레드 프레임 (화면 useMemo = buildConfirmView, 로직 lib/ackChips 소유) */
  confirmView?: ConfirmView;
  /** t_0e03e405: 확인 스레드 진입 배지 탭 → 공감/답변 카드로 점프 (requestJump 재사용) */
  onJump?: (messageId: string) => void;
  /** 버튼 탭 → '예'/'아니요' 텍스트 발화 (백엔드 확인 발화 게이트 계약 텍스트) */
  onSendAck?: (text: string) => void;
  decorate: (m: ChatMessage) => ChatMessage;
  handlers: CardActionHandlers;
  presetCategory?: string;
  canFork: boolean;
  agentName: string;
  /** t_55b7e30c 연속 발화 그룹핑: 메시지 id별 헤더(이름 재출력)/continuation(좌 오프셋) 플래그 */
  senderFlags: Map<string, SenderGroupFlag>;
  sessionTitle: string;
  isDemo: boolean;
  queue: QueueItem[];
  selectionActive: boolean;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onResend: (message: ChatMessage) => void;
  onDelete: (id: string) => void;
  /** 답글 롱프레스 메뉴 (t_62897e88) — 대상 행을 화면에 알린다. 선택 모드에서는 래퍼 미사용 */
  onMessageLongPress?: (message: ChatMessage) => void;
  /** 인용 라인 탭 → 원문 카드 점프 (화면의 strip.requestJump nonce 패턴 재활용) */
  onQuoteJump?: (messageId: string) => void;
}

export default function ChatTurnRow({
  group, timeLabel, highlightId, ackChipId, hiddenAckIds, confirmView, onJump, onSendAck, decorate, handlers, presetCategory, canFork, agentName,
  senderFlags, sessionTitle, isDemo, queue, selectionActive, selectedIds, onToggleSelect, onResend, onDelete,
  onMessageLongPress, onQuoteJump,
}: Props) {
  const { t } = useTranslation();
  // t_0e03e405: 확인응답으로 병합된 user 행 — 메인 顶级 버블에서 제외, 프레임 내부 reply 라인으로 이사.
  // (hiddenAckIds = 구 라벨 정확-일치 숨김 경로와 합집합 — 전송·백엔드 게이트는 그대로, 화면 층위만.)
  const isMergedAck = (id: string) => (hiddenAckIds?.has(id) ?? false) || (confirmView?.ackIds.has(id) ?? false);

  const renderCard = (message: ChatMessage) => {
    const flag = senderFlags.get(message.id);
    const showHeader = message.role !== 'agent' ? true : flag?.header ?? true;
    const card = <CardFrame presetCategory={presetCategory} canFork={canFork} message={decorate(message)} handlers={handlers} agentName={agentName} showHeader={showHeader} senderName={message.senderName} continuation={flag?.continuation === true} sessionTitle={sessionTitle} exportDisabled={isDemo} />;
    if (selectionActive) return <TouchableOpacity
      onPress={() => onToggleSelect(message.id)}
      style={selectedIds.includes(message.id) ? styles.selectedRow : undefined}
      testID={`select-${message.id}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selectedIds.includes(message.id) }}
    >
      {card}
    </TouchableOpacity>;
    return onMessageLongPress
      ? <Pressable testID={`message-row-${message.id}`} onLongPress={() => onMessageLongPress(message)}>{card}</Pressable>
      : card;
  };

  const renderMessage = (message: ChatMessage) => <View key={message.id} style={message.id === highlightId ? styles.focusHighlight : undefined} testID={message.id === highlightId ? 'focus-highlight' : undefined}>
    {/* 답글/인용 라인 (t_62897e88 백로그④) — structured_payload.reply_to 스냅샷이 있는 user 행 상단에
        원문 1줄 인용. 병합 확인응답(확인 스레드 내부로 이사간 행)은 메인 인용 라인이 아니라 프레임에서 렌더. */}
    {message.role === 'user' && message.replyTo && onQuoteJump && !isMergedAck(message.id) && <ReplyQuoteLine quote={message.replyTo} onJump={onQuoteJump} testIdSuffix={message.id} />}
    {/* t_0e03e405 FINAL SCOPE — 공감 재질문 카드 = 메인 顶级 버블이 아니라 '확인 스레드' 프레임 내부
        (원문 인용 헤더 + 카드 + 병합 ack reply 라인 + 예/아니요 칩). 칩 수명/라이브 게이트(lib/ackChips)
        무변경 — ackChipId가 이 empathy면 프레임 안에서 렌더(Positions 불변: 카드 아래). */}
    {(() => {
      const frame = !selectionActive ? confirmView?.byEmpathy.get(message.id) : undefined;
      const replies = frame ? confirmView!.acksByEmpathy.get(message.id) ?? [] : [];
      const card = renderCard(message);
      if (!frame) {
        return <>
          {card}
          {!selectionActive && message.role === 'agent' && message.id === ackChipId && onSendAck && <AckChipRow onPressAck={onSendAck} />}
        </>;
      }
      return (
        <View testID={`confirm-thread-${message.id}`}>
          <View style={threadStyles.frame}>
            <View style={threadStyles.header}>
              <Text style={threadStyles.headerLabel} numberOfLines={1}>{t('chat.confirmThread')}</Text>
              <Text style={threadStyles.headerQuote} numberOfLines={1}>“{frame.rootText || t('queue.photoQuestion')}”</Text>
            </View>
            {card}
            {replies.map((r) => (
              <View key={r.id} style={threadStyles.replyRow} testID={`confirm-reply-${r.id}`}>
                <Text style={threadStyles.replyText} numberOfLines={2}>{r.content || t('queue.photoQuestion')}</Text>
                {r.pending ? <TickPendingIcon size={12} color={colors.text3} /> : null}
                {r.status === 'failed' && <Pressable accessibilityRole="button" onPress={() => onResend(r)} testID={`confirm-retry-${r.id}`}>
                  <Text style={threadStyles.retryText}>{t('tracker.failedShort')}</Text>
                </Pressable>}
              </View>
            ))}
            {!selectionActive && message.id === ackChipId && onSendAck && <AckChipRow onPressAck={onSendAck} />}
          </View>
        </View>
      );
    })()}
    {message.role === 'user' && <View style={styles.userMetaRow}>
      {/* ⑤ 전송 ticks (t_5c559e85): 시계(pending)→체크(sent)→(!)+탭 재전송(failed). */}
      {renderFlags.sendTicks
        ? <Pressable testID={`message-tick-${message.id}`} accessibilityRole="button"
            accessibilityLabel={t(message.status === 'failed' ? 'chat.failed' : message.pending ? 'chat.sending' : 'chat.sent')}
            onPress={message.status === 'failed' ? () => onResend(message) : undefined}>
          {message.status === 'failed'
            ? <TickFailedIcon size={iconSize.tileSm} color={colors.statusErr} />
            : message.pending
              ? <TickPendingIcon size={iconSize.tileSm} color={colors.text3} />
              : <TickSentIcon size={iconSize.tileSm} color={colors.accent} />}
        </Pressable>
        : <Text style={styles.pendingMark}>{t(message.status === 'failed' ? 'chat.failed' : message.pending ? 'chat.sending' : 'chat.sent')}</Text>}
      {/* 질문 큐 체크포인트 (t_1797f432 ②) */}
      <QueueMessageMark queue={queue} message={message} />
      {/* t_0e03e405 — '확인 스레드' 진입 배지: 이 질문 아래 공감 재질문(확인 스레드)이 열린 원 질문 카드.
          탭 = 해당 공감 카드로 점프(하이라이트). FINAL SCOPE 3 '질문 카드에 확인 스레드 진입점 노출'. */}
      {confirmView?.byRoot.get(message.id)?.length ? (
        <Pressable accessibilityRole="button" testID={`confirm-entry-${message.id}`} hitSlop={6}
          onPress={() => {
            // 진입점 = 원 질문 아래 최신 '확인 스레드'(empathy 카드)로 점프 — ack 행은 顶级 렌더가
            // 없어 하이라이트 대상이 될 수 없다(프레임 내부 reply 라인). requestJump = group 인덱스 탐색.
            const empIds = confirmView.byRoot.get(message.id) ?? [];
            const last = empIds[empIds.length - 1];
            if (last && onJump) onJump(last);
          }}>
          <Text style={threadStyles.entryBadge}>{t('chat.confirmThreadBadge', { countText: String(confirmView.byRoot.get(message.id)!.length) })}</Text>
        </Pressable>
      ) : null}
      {/* 음성 발화 길이 병기 (t_2eea055a) */}
      {message.messageType === 'voice' && (
        <View style={styles.voiceMetaBadge} testID={`voice-duration-${message.id}`}>
          <MicIcon size={iconSize.tileSm} color={colors.text3} />
          {typeof message.voiceDurationMs === 'number' && (
            <Text style={styles.voiceMetaText}>{formatRecordingDuration(message.voiceDurationMs)}</Text>
          )}
        </View>
      )}
    </View>}
    {/* t_c62a2eb7: 예/아니요 칩 — 확인 스레드 프레임 밖(프레임 없는 empathy 강등 시) 기존 위치 유지 */}
    {!selectionActive && message.role === 'agent' && message.id === ackChipId && onSendAck && !confirmView?.byEmpathy.get(message.id) && <AckChipRow onPressAck={onSendAck} />}
    {message.status === 'failed' && <View style={styles.msgHeader}>
      <Button onPress={() => onResend(message)}>{t('chat.resend')}</Button>
      <Button onPress={() => onDelete(message.id)}>{t('chat.delete')}</Button>
    </View>}
  </View>;

  return <View>
    {timeLabel && <Text style={styles.pendingMark}>{timeLabel}</Text>}
    {group.items
      // t_64e3edd6 ② + t_0e03e405: ack 결과/확인응답 병합 user 행은 메인 顶级 렌더 제외 —
      // 확인응답은 해당 empathy의 '확인 스레드' 프레임 안에서 reply 라인으로 표시된다.
      .filter((message) => !(message.role === 'user' && isMergedAck(message.id)))
      .map(renderMessage)}
  </View>;
}

const threadStyles = StyleSheet.create({
  // '확인 스레드' 프레임 — 원문 인용 헤더 + 좌측 인덴트 + 미약 구분선 (슬랙 스레드 사이드카 계열,
  // 메인 顶级 버블과 시각 구분: 顶级 스트림은 [질문]→[답변]만 흐른다 — FINAL SCOPE 3)
  frame: {
    marginLeft: spacing.sp3,
    marginTop: spacing.sp1,
    paddingLeft: spacing.sp3,
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
    gap: spacing.sp1,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, flexWrap: 'wrap' },
  headerLabel: { ...typography.micro, fontWeight: '700', color: colors.text2 },
  headerQuote: { ...typography.micro, color: colors.text3, flexShrink: 1 },
  replyRow: {
    alignSelf: 'flex-end',
    maxWidth: '100%',
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp1,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceHover,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
  },
  replyText: { ...typography.caption, color: colors.text1, flexShrink: 1 },
  retryText: { ...typography.micro, color: colors.statusErr, fontWeight: '600' },
  entryBadge: { ...typography.micro, color: colors.accent, fontWeight: '600' },
});
