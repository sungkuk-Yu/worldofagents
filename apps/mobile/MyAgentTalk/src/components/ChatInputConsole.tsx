// 채팅 하단 입력 계층 컨테이너 (t_91cb659c 응집 → t_4758f25d 투명 보이스 스테이지 재스펙).
// 대표님 9/28 밤 확정 (#303/#304/#307/#311/#316/#318): 수직 2계층, 전이 2개뿐.
//  A. 음성 계층 (기본): 하단 ~30% 투명 스트립(VoiceStage). 대기 = 빈 영역만 — 히스토리 잘림/가림 소멸.
//     홀드 → 링+초록 마이크+펄스+실측 게인 sine 리본. 놓기=전송 / ↑ 슬라이드=B / 좌·우 끝 0.8s=예·아니요.
//     키보드 전환 버튼 없음 — ↑ 제스처가 유일한 A→B 진입로.
//  B. 키보드 계층 (↑로 열었을 때만): 입력바. 배치 확정 — 좌=전송(초록), 우=마이크 탭(B→A 복귀 1개뿐).
//     (타이핑 중 엄지 스와이프는 오타 → 복귀는 버튼). 첨부 로직 불변.
// PC/네이티브/데모(voiceMode=false): 기존 입력바 상시(좌첨부-우전송) — DOM 불변 (t_e735d936 스모크 ⑧).
// 권한 최초 요구는 A의 첫 홀드 시점(usePushToTalk.startHold) — 로드 중 getUserMedia 없음.
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput as RNTextInput, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import VoiceStage from './VoiceStage';
import { AttachmentChipRow } from './AttachmentChips';
import { MicIcon, PaperclipIcon } from './Icon';
import type { AttachmentDraft } from '../hooks/useAttachments';
import { colors, radii, spacing, typography, iconSize } from '../theme';
import { validateMessageInput } from '../lib/chatLogic';
import { voiceStageHeight } from '../lib/voiceStage';
import { formatNumber } from '../i18n/format';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  isDemo: boolean;
  // 첨부 (t_4497cfce P1-2) — 클릭 게이트·스테이지는 화면(useAttachments) 소유, 여기서는 조립만.
  attachmentItems: AttachmentDraft[];
  attachmentCount: number;
  onAttach: () => void;
  onAttachmentRemove: (localId: string) => void;
  onAttachmentRetry: (localId: string) => void;
  // 음성 계층 (t_4758f25d)
  voiceMode: boolean;
  /** route params keyboard=1 → 키보드 계층으로 진입 */
  initialKeyboardOpen: boolean;
  recording: boolean;
  /** 0..1 마이크 실측 게인 — sine 리본 진폭 원천 */
  level: number;
  /** errors.* 키 — 권한 거부/캡처 실패 폴백 안내 */
  pttError: string | null;
  onPressHoldStart: () => void;
  onHoldEnd: () => void;
  onHoldAbort: () => void;
  /** t_043539ff→t_64e3edd6 ③: 재질문 활성 시 좌/우 끝 릴리스 → '예'/'아니요' 텍스트 발화 */
  onSendAck: (text: string) => void;
  /** t_64e3edd6 #324/#325: 공감 재질문 예/아니요 버튼 행 활성 — false면 좌/우도 음성 send(무확인 진행) */
  ackActive?: boolean;
  /** 답변 대기 freeform 점프 (t_363c0faa) — 값이 바뀌면 음성 모드에서도 키보드 입력바를 개방(focus).
   *  0 = 요청 없음. nonce 패턴: 같은 행 재탭에도 재발동 (queue strip jump nonce와 동일 관례). */
  forceOpenKeyboard?: number;
  /** 세로 뷰포트(px) — 스트립 높이 = 30% (voiceStageHeight) */
  viewportHeight: number;
  /** A 계층(스트립) 마운트 상태 통지 — 화면의 리스트 하단 패딩(=strip 실높이) 계약용 (#311).
   *  B 계층(입력바)이 열리면 false → 패딩 0(빈 공간 금지). */
  onStageActiveChange?: (active: boolean) => void;
}

export default function ChatInputConsole({
  value, onChangeText, onSubmit, isDemo,
  attachmentItems, attachmentCount, onAttach, onAttachmentRemove, onAttachmentRetry,
  voiceMode, initialKeyboardOpen, recording, level, pttError,
  onPressHoldStart, onHoldEnd, onHoldAbort, onSendAck, ackActive, forceOpenKeyboard, viewportHeight,
  onStageActiveChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const [keyboardOpen, setKeyboardOpen] = useState(initialKeyboardOpen);
  const inputRef = useRef<RNTextInput>(null);
  // 답변 대기 freeform 점프 (t_363c0faa): nonce 변화 시점에 키보드 계층 개방.
  // 0(미요청)은 무시 — 기존 DOM/포커스 동작 불변.
  const openNonce = useRef(0);
  useEffect(() => {
    if (!forceOpenKeyboard) return;
    if (forceOpenKeyboard !== openNonce.current) {
      openNonce.current = forceOpenKeyboard;
      setKeyboardOpen(true);
    }
  }, [forceOpenKeyboard]);
  // 폴백(error): 스테이지는 유지(거부 해제 후 재홀드 가능)하되 안내 한 줄이 뜨고,
  // 입력창이 자동 개방되어 텍스트만으로 완전 작동(t_e735d936 요구 1 계승).
  // t_cb8e978a ①: '연결 중'(micNotReady)은 토스트성 안내 — 권한 박탈이 아니므로 키보드 강제
  // 개방으로 A 계층을 떠밀지 않는다(스테이지 안내 줄만).
  const hardError = !!pttError && pttError !== 'errors.micNotReady';
  const inputOpen = !voiceMode || keyboardOpen || hardError;
  useEffect(() => { if (voiceMode && inputOpen) inputRef.current?.focus(); }, [voiceMode, inputOpen]);
  // A 계층 활성 = 패딩 계약의 단일 판정 (화면은 strip 높이지만 소유, 마운트 여부는 여기가 안다).
  // t_e735d936 parity: error가 나도 A는 유지(재홀드 재시도), 안내 줄이 뜨고 입력창이 병행 개방된다.
  const stageActive = voiceMode && !keyboardOpen;
  useEffect(() => { onStageActiveChange?.(stageActive); }, [stageActive, onStageActiveChange]);
  return (
    <>
      {value.trim().length > 4000 && <Text style={styles.errorText}>{t('errors.tooLong', { limit: formatNumber(4000, i18n.language) })}</Text>}
      {/* 첨부 스테이지 — 전송 대기 칩 행 (t_4497cfce P1-2) */}
      <View style={styles.stageRow}>
        <AttachmentChipRow items={attachmentItems} onRemove={onAttachmentRemove} onRetry={onAttachmentRetry} />
      </View>
      {/* A 계층: 투명 보이스 스테이지 — 웹 모바일 기본(B 폐쇄 시에만). #311/#318: 0-호스트 위에
          하방 성장 absolute strip으로 얹음 — 리스트가 배후로 비치고(bg 투명), 채팅은 리스트
          하단 패딩(=strip 높이, 화면 소유)으로 최하단 줄이 strip에 가려지지 않는다. */}
      {voiceMode && stageActive && (
        <View pointerEvents="box-none" style={styles.stageHost}>
          <VoiceStage
            height={voiceStageHeight(viewportHeight)}
            onPressHoldStart={onPressHoldStart}
            onHoldEnd={onHoldEnd}
            onHoldAbort={onHoldAbort}
            onSendAck={onSendAck}
            ackActive={ackActive}
            onOpenKeyboard={() => setKeyboardOpen(true)}
            recording={recording}
            level={level}
            error={pttError}
          />
        </View>
      )}
      {/* 권한 거부 폴백 안내는 VoiceStage 내부(chat-voice-fallback) — 자동 입력창 병행 개방은 inputOpen */}
      {inputOpen && (
        <View style={styles.inputBar} testID="chat-input-bar">
          {/* B 계층 배치 확정 (#304 보강): 음성 모드 입력바는 좌=전송(초록) / 우=마이크(A 복귀).
              PC·데모(voiceMode=false)는 기존 좌=첨부 … 우=전송 배치 DOM 불변. */}
          {voiceMode && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.sendLabel')}
              onPress={onSubmit}
              disabled={!validateMessageInput(value).ok}
              testID="send-button"
              style={({ pressed }) => [
                styles.sendButton,
                { backgroundColor: validateMessageInput(value).ok ? colors.accent : colors.accent + '55' },
                pressed && validateMessageInput(value).ok && { backgroundColor: colors.accent + 'CC' },
              ]}
            >
              <Text style={styles.sendLabel}>{t('chat.send')}</Text>
            </Pressable>
          )}
          <View style={styles.inputRow}>
            {/* 클립 버튼 (t_4497cfce P1-2): 사진 선택 → 업로드 + 편집기. */}
            <Pressable accessibilityRole="button" accessibilityLabel={t('attachments.attach')} onPress={onAttach} disabled={isDemo || attachmentCount >= 10} testID="attach-button" style={({ pressed }) => [styles.clipButton, pressed && { backgroundColor: colors.surfaceHover }]}>
              <PaperclipIcon size={iconSize.glyph} color={colors.text2} />
            </Pressable>
            <TextInput
              ref={inputRef}
              mode="outlined"
              value={value}
              onChangeText={onChangeText}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={colors.text3}
              style={styles.textInput}
              outlineColor={colors.border}
              activeOutlineColor={colors.accent}
              textColor={colors.text1}
              dense
              multiline={false}
              testID="chat-input"
              onSubmitEditing={onSubmit}
              returnKeyType="send"
              accessibilityLabel={t('chat.input')}
            />
          </View>
          {/* 마이크 탭 = 키보드 닫히고 A 복귀 — B→A 유일한 전이 (#304). 음성 모드에서만 렌더. */}
          {voiceMode && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.voiceBack')}
              onPress={() => { inputRef.current?.blur(); setKeyboardOpen(false); }}
              testID="chat-voice-back"
              style={({ pressed }) => [styles.micButton, pressed && { backgroundColor: colors.surfaceHover }]}
            >
              <MicIcon size={iconSize.glyph} color={colors.accent} />
            </Pressable>
          )}
          {/* PC/네이티브/데모: 기존 우측 전송 버튼 (t_64af90b0 #4 — paper Button disabled 색상 문제 → 커스텀 Pressable) */}
          {!voiceMode && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.sendLabel')}
              onPress={onSubmit}
              disabled={!validateMessageInput(value).ok}
              testID="send-button"
              style={({ pressed }) => [
                styles.sendButton,
                { backgroundColor: validateMessageInput(value).ok ? colors.accent : colors.accent + '55' },
                pressed && validateMessageInput(value).ok && { backgroundColor: colors.accent + 'CC' },
              ]}
            >
              <Text style={styles.sendLabel}>{t('chat.send')}</Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );
}

// 화면 스타일과 값 동일 (t_91cb659c — 이동만, 리터럴 보존)
const styles = StyleSheet.create({
  errorText: {
    ...typography.caption,
    color: colors.statusErr,
    flex: 1,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
    paddingHorizontal: spacing.sp3,
    paddingTop: spacing.sp2,
    paddingBottom: Platform.OS === 'ios' ? spacing.sp4 : spacing.sp3,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  textInput: {
    ...typography.body,
    minWidth: 0,
    flexShrink: 1,
    flex: 1,
    backgroundColor: colors.surface,
    maxHeight: spacing.sp6 * 2,
    borderRadius: radii.md,
  },
  sendButton: {
    minWidth: 0,
    flexShrink: 1,
    borderRadius: radii.md,
    minHeight: spacing.sp10 + spacing.sp1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sp3,
  },
  sendLabel: {
    ...typography.bodyBold,
    letterSpacing: 0,
    color: colors.onPrimary,
    minWidth: 0,
    flexShrink: 1,
  },
  inputRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, minWidth: 0 },
  stageRow: { position: 'relative', zIndex: 100, paddingHorizontal: spacing.sp4, paddingTop: spacing.sp2, minHeight: 0 },
  // 스테이지 호스트 — 흐름 높이 0, strip은 bottom:0 기준으로 상방 성장(transparent 오버레이)
  stageHost: { position: 'relative', height: 0, width: '100%' },
  clipButton: { width: spacing.sp10, height: spacing.sp10, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaise },
  // 마이크 토글 — B→A 유일한 버튼 (초록 tint 원형, 녹음 계열 색 유지)
  micButton: { width: spacing.sp10, height: spacing.sp10, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentTint },
});
