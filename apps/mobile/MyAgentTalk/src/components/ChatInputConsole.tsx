// 채팅 하단 입력 콘솔 컨테이너 (t_91cb659c 심야 리팩터링 ①) — ChatScreen에서 조립만 하던 입력 영역을 응집.
// 포함: 초장문 안내 → 첨부 스테이지 칩 행 → (음성 우선 시) ChatVoiceConsole → 키보드 입력바.
// 렌더 순서·DOM 구조·testID·스타일 값은 ChatScreen 인라인 시절과 1:1 (리팩터링 전용, 비주얼 변경 금지).
// 키보드 개방 상태(keyboardOpen)와 입력 ref 포커스 효과는 이 컴포넌트 내부 소유 — 화면은 파생값을 모른다.
// 계층 원칙 (t_e735d936 유지): 웹 모바일 진입 = 조이스틱 홀드-투-톡 1차 UI, 입력창은 키보드 계층 2차.
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput as RNTextInput, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import ChatVoiceConsole from './ChatVoiceConsole';
import { AttachmentChipRow } from './AttachmentChips';
import { MicIcon, PaperclipIcon } from './Icon';
import { useJoystickMap } from '../hooks/useJoystickMap';
import type { AttachmentDraft } from '../hooks/useAttachments';
import { colors, radii, spacing, typography, iconSize } from '../theme';
import { validateMessageInput } from '../lib/chatLogic';
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
  // 음성 우선 (t_e735d936)
  voiceMode: boolean;
  /** route params keyboard=1 → 키보드 계층으로 진입 */
  initialKeyboardOpen: boolean;
  recording: boolean;
  /** errors.* 키 — 권한 거부/캡처 실패 폴백 안내 */
  pttError: string | null;
  onPressHoldStart: () => void;
  onHoldEnd: () => void;
  onHoldAbort: () => void;
}

export default function ChatInputConsole({
  value, onChangeText, onSubmit, isDemo,
  attachmentItems, attachmentCount, onAttach, onAttachmentRemove, onAttachmentRetry,
  voiceMode, initialKeyboardOpen, recording, pttError,
  onPressHoldStart, onHoldEnd, onHoldAbort,
}: Props) {
  const { t, i18n } = useTranslation();
  const { actionFor, directionLabels } = useJoystickMap();
  const [keyboardOpen, setKeyboardOpen] = useState(initialKeyboardOpen);
  const inputRef = useRef<RNTextInput>(null);
  // 폴백(error): 콘솔은 유지(거부 해제 후 재시도 가능)하되 안내 한 줄이 콘솔 안에 뜨고,
  // 입력창이 자동 개방되어 텍스트만으로 완전 작동(요구 1).
  const inputOpen = !voiceMode || keyboardOpen || !!pttError;
  useEffect(() => { if (voiceMode && inputOpen) inputRef.current?.focus(); }, [voiceMode, inputOpen]);
  return (
    <>
      {value.trim().length > 4000 && <Text style={styles.errorText}>{t('errors.tooLong', { limit: formatNumber(4000, i18n.language) })}</Text>}
      {/* 첨부 스테이지 — 전송 대기 칩 행 (t_4497cfce P1-2) */}
      <View style={styles.stageRow}>
        <AttachmentChipRow items={attachmentItems} onRemove={onAttachmentRemove} onRetry={onAttachmentRetry} />
      </View>
      {/* 하단 입력 영역 — t_e735d936 요구 1: 음성 우선. 웹 모바일은 기본이 음성 콘솔(조이스틱 홀드-투-톡)이고
          텍스트 입력창은 키보드를 열었을 때만 나타나는 2차 UI. PC/네이티브/데모는 기존 입력창 상시. */}
      {voiceMode && !keyboardOpen && (
        <ChatVoiceConsole
          onPressHoldStart={onPressHoldStart}
          onHoldEnd={onHoldEnd}
          onHoldAbort={onHoldAbort}
          actionFor={actionFor}
          directionLabels={directionLabels()}
          recording={recording}
          error={pttError}
          onOpenKeyboard={() => setKeyboardOpen(true)}
        />
      )}
      {inputOpen && (
        <View style={styles.inputBar}>
          <View style={styles.inputRow}>
            {/* 클립 버튼 (t_4497cfce P1-2): 사진 선택 → 업로드 + 편집기. PTT 마이크와 동일 SVG 아이콘 버튼 패턴 (#2/#4). */}
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
            {/* t_e735d936: 음성 우선 화면에서만 — 키보드 진입 후 음성 콘솔로 되돌아가는 복귀 버튼 */}
            {voiceMode && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chat.voiceBack')}
                onPress={() => { inputRef.current?.blur(); setKeyboardOpen(false); }}
                testID="chat-voice-back"
                style={({ pressed }) => [styles.clipButton, pressed && { backgroundColor: colors.surfaceHover }]}
              >
                <MicIcon size={iconSize.glyph} color={colors.text2} />
              </Pressable>
            )}
            {/* t_4b1bd4c2 요구 1: 입력창 옆 마이크 홀드 버튼 폐기 — 음성 진입은 PTT 키(PC) / 조이스틱 탭(음성 홈)으로만 */}
            {/* t_64af90b0 #4 — paper Button은 disabled 시 색상 오버라이드가 무시되어 회색이 된다 →
                커스텀 Pressable: 비활성 = 액센트 55% (초록 체계 유지), 활성 = 액센트. 제출 자체는 submit()이 검증. */}
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
          </View>
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
  stageRow: { paddingHorizontal: spacing.sp4, paddingTop: spacing.sp2, minHeight: 0 },
  clipButton: { width: spacing.sp10, height: spacing.sp10, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaise },
});
