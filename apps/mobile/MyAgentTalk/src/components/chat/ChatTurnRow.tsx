// 턴 그룹 행 (t_70cbbd6b: ChatScreen renderItem 본문 순수 추출 — 렌더/DOM/testID 1:1)
// 시간 라인 + 메시지별 카드 래퍼(포커스 하이라이트/선택 토글래퍼/user 메타/실패 재시도행)까지 화면행 전체를 소유.
// 상태 변경은 화면 소유 콜백(decorate/handlers/toggleSelect/retry/delete)을 그대로 호출 — 이 컴포넌트는 로직 무소유.
import React from 'react';
import { Pressable, TouchableOpacity, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import CardFrame from '../../cards/CardFrame';
import AckChipRow from '../AckChipRow';
import { QueueMessageMark } from '../QueueStrip';
import { ReplyQuoteLine } from '../ReplyQuoteBar';
import { TickFailedIcon, TickPendingIcon, TickSentIcon, MicIcon } from '../Icon';
import { renderFlags } from '../../lib/renderFlags';
import { formatRecordingDuration } from '../../lib/voiceStage';
import { colors, iconSize } from '../../theme';
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
  /** 버튼 탭 → '예'/'아니요'(또는 어미 바인딩 '맞아요'/'아니에오') 텍스트 발화 (백엔드 확인 발화 게이트 계약 텍스트) */
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
  group, timeLabel, highlightId, ackChipId, hiddenAckIds, onSendAck, decorate, handlers, presetCategory, canFork, agentName,
  senderFlags, sessionTitle, isDemo, queue, selectionActive, selectedIds, onToggleSelect, onResend, onDelete,
  onMessageLongPress, onQuoteJump,
}: Props) {
  const { t } = useTranslation();
  return <View>
    {timeLabel && <Text style={styles.pendingMark}>{timeLabel}</Text>}
    {group.items
      // t_64e3edd6 ② (대표님 9/29 "예 아 니오의 결과는 사실상 카드로 안 보여줘도 돼"):
      // 재질문 뒤 '예'/'아니요' 발화(user 행)는 렌더 제외 — 전송·게이트 판정은 정상 진행, 화면만 숨김.
      .filter((message) => !hiddenAckIds?.has(message.id))
      .map((message) => <View key={message.id} style={message.id === highlightId ? styles.focusHighlight : undefined} testID={message.id === highlightId ? 'focus-highlight' : undefined}>
      {/* 답글/인용 라인 (t_62897e88 백로그④) — structured_payload.reply_to 스냅샷이 있는 user 행 상단에
          원문 1줄 인용 (백엔드 권장: user 행이 1차 소스 — 발신 버블만 인용을 보여준다, 텔레그램 관습).
          탭 = 원문으로 스크롤+하이라이트. 원문 삭제 후에도 요약은 남는다(백엔드 SET NULL). */}
      {message.role === 'user' && message.replyTo && onQuoteJump && <ReplyQuoteLine quote={message.replyTo} onJump={onQuoteJump} testIdSuffix={message.id} />}
      {/* t_55b7e30c 백로그③ (텔레그램/Slack 관습) — 발신자 헤더(이름)는 발화 그룹 시작마다 재출력:
          role 전환 / agentId 변경 / 60초 초과 시에만 노출, 같은 그룹 연속 카드는 생략 + 좌 오프셋으로
          묶음 시각화. t_64af90b0 #3의 '첫 에이전트 메시지만 노출'을 대체 (다중 에이전트·릴레이 판별 불가 해결).
          다중 선택 모드: 행 전체가 선택 토글 래퍼 — 비모드에는 래퍼 없이 카드 그대로 (#51 인터랙션 보존)
          t_62897e88: 비모드 행은 롱프레스 래퍼(답글 메뉴)로 감싼다 — 내부 버튼 탭은 그대로 통과. */}
      {(() => {
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
      })()}
      {message.role === 'user' && <View style={styles.userMetaRow}>
        {/* ⑤ 전송 ticks (t_5c559e85, Telegram/Signal 규범): 시계(pending)→체크(sent=서버 ID 획득)→(!)+탭 재전송(failed).
            플래그 off = 기존 텍스트 라벨 경로로 복귀. failed는 아래 재시도/삭제 행과 무관하게 늘 탭 가능해야 한다(조용한 삭제 금지). */}
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
        {/* 질문 큐 체크포인트 (t_1797f432 ②): 매칭 큐 항목의 상태 마커 — 서버 이벤트 없으면 렌더 없음 */}
        <QueueMessageMark queue={queue} message={message} />
        {/* 음성 발화 길이 병기 (t_2eea055a, 대표님 9/30 텔레그램식): message_type='voice' user 카드에
            🎤 + 'M:SS'. stt_metadata.duration_ms 결측(구 행/DECISION 등)이면 길이 없이 아이콘만. */}
        {message.messageType === 'voice' && (
          <View style={styles.voiceMetaBadge} testID={`voice-duration-${message.id}`}>
            <MicIcon size={iconSize.tileSm} color={colors.text3} />
            {typeof message.voiceDurationMs === 'number' && (
              <Text style={styles.voiceMetaText}>{formatRecordingDuration(message.voiceDurationMs)}</Text>
            )}
          </View>
        )}
      </View>}
      {/* t_c62a2eb7: 공감 재질문 카드 하단 예/아니요 텔레그램식 50/50 대형 버튼 — 재질문 카드가
          보이는 동안 유지(발화 진행 시에만 소멸, 화면 useAckChip)·메인 피드행만 ·
          버튼 대상 행과 일치하는 카드 아래에만 렌더. 탭 = send(라벨) 1회 (t_1b123e59: 라벨 고정 '예/아니요',
          t_c62a2eb7 #4 template_id 어미 바인딩 폐기 — 원문② "맞아요가 아니고 예/아니오 로만"). */}
      {!selectionActive && message.id === ackChipId && onSendAck && <AckChipRow onPressAck={onSendAck} />}
      {message.status === 'failed' && <View style={styles.msgHeader}>
        <Button onPress={() => onResend(message)}>{t('chat.resend')}</Button>
        <Button onPress={() => onDelete(message.id)}>{t('chat.delete')}</Button>
      </View>}
    </View>)}
  </View>;
}
