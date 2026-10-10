// 채팅 하단 입력 계층 컨테이너 (t_91cb659c 응집 → t_4758f25d 투명 보이스 스테이지 재스펙).
// 대표님 9/28 밤 확정 (#303/#304/#307/#311/#316/#318): 수직 2계층, 전이 2개뿐.
//  A. 음성 계층 (기본): 하단 ~30% 투명 스트립(VoiceStage). 대기 = 빈 영역만 — 히스토리 잘림/가림 소멸.
//     홀드 → 링+초록 마이크+펄스+실측 게인 sine 리본. 놓기=전송 / ↑ 슬라이드=B / 좌·우 끝 0.8s=예·아니요.
//     키보드 전환 버튼 없음 — ↑ 제스처가 유일한 A→B 진입로.
//  B. 키보드 계층 (↑로 열었을 때만): 입력바. t_5e592321 되돌림(대표님 9/30 "전송 버튼은 왼쪽에 있고
//     ... 위치가 바껴있어") — 배치 원상복구: 우=전송(초록), 그 좌측=마이크 탭(B→A 복귀 1개뿐).
//     (0d351d4d #304의 좌전송/우마이크 반전은 폐기). 첨부 로직 불변.
// PC/네이티브/데모(voiceMode=false): 기존 입력바 상시(좌첨부-우전송) — DOM 불변 (t_e735d936 스모크 ⑧).
// 권한 최초 요구는 A의 첫 홀드 시점(usePushToTalk.startHold) — 로드 중 getUserMedia 없음.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { INPUT_MIN_HEIGHT, inputHeightFor, inputScrolls, composerAction } from '../lib/chatInputLogic';
import { getPttKey } from '../lib/userPrefs';
import { PTT_DEFAULT_KEY } from '../lib/pttLogic';

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
  /** t_55e92e7e 실행 배선: ↓ 사진 / ↗ 파일 조이스틱 방향 = 첨부 스테이지 실행 (t_08d671a8 5방향 계약의 온보딩) */
  onPhoto?: () => void;
  onFile?: () => void;
  // 음성 계층 (t_4758f25d)
  voiceMode: boolean;
  /** route params keyboard=1 → 키보드 계층으로 진입 */
  initialKeyboardOpen: boolean;
  recording: boolean;
  /** 0..1 마이크 실측 게인 — sine 리본 진폭 원천 */
  level: number;
  /** errors.* 키 — 권한 거부/캡처 실패 폴백 안내 */
  pttError: string | null;
  /** t_5058e15f ②: hold grant + WS 준비 대기 — '연결 중' 안내 표시(캡처 지연 시작) */
  pttPending?: boolean;
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
  /** t_2f296081 ③: 입력창(B) 포커스 중 pttKey(V) 타격 = 음성 홀드/토글 시작. 화면 ptt.press 주입.
   *  발동 시 B→A 즉시 전환(스테이지 링이 녹음 시각화) + preventDefault('v' 타이핑 억제). */
  onVoicePress?: () => void;
  /** t_2f296081 ③: 로컬 캡처 활성(ptt.active) — VoiceStage 합성 홀드(링+리본+타이머) 소스.
   *  recording(=active||talking)과 달리 서버 전사 중에는 true가 아니라 릴리스 직전까지만 켜진다. */
  pttCapturing?: boolean;
  /** 세로 뷰포트(px) — 스트립 높이 = 30% (voiceStageHeight) */
  viewportHeight: number;
  /** A 계층(스트립) 마운트 상태 통지 — 화면의 리스트 하단 패딩(=strip 실높이) 계약용 (#311).
   *  B 계층(입력바)이 열리면 false → 패딩 0(빈 공간 금지). */
  onStageActiveChange?: (active: boolean) => void;
}

export default function ChatInputConsole({
  value, onChangeText, onSubmit, isDemo,
  attachmentItems, attachmentCount, onAttach, onAttachmentRemove, onAttachmentRetry,
  onPhoto, onFile,
  voiceMode, initialKeyboardOpen, recording, level, pttError, pttPending,
  onPressHoldStart, onHoldEnd, onHoldAbort, onSendAck, ackActive, forceOpenKeyboard, viewportHeight,
  onVoicePress, pttCapturing,
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
  // ── t_c690274e 요구 1/2: Enter 단독=전송, Shift+Enter=개행, IME 조합 중 Enter=미전송 ──
  // RN-web TextInput의 supportedProps.onKeyDownCapture(paper가 rest로 투하)이 bubble handleKeyDown보다
  // 선행 실행: Enter 단독 → preventDefault(textarea 개행 삽입 차단) + submit 직접 호출.
  // preventDefault로 RN-web bubble의 submit 분기도 스킵(isDefaultPrevented) → 이중 전송 0.
  // Shift+Enter: 여기선 return만 — multiline+blurOnSubmit=false에서 RN-web도 submit을 스킵하므로
  // 개행이 기본 동작으로 삽입된다(버그 교대의 핵심 경로).
  // IME(한글) 조합 중: isComposing/keyCode 229 → 스킵(전송·개행 모두 브라우저/IME에 양보).
  // 네이티브(0.86): submitBehavior='submit' 계약이 동일 분기를 수행하고 DOM nativeEvent가 없어 no-op.
  const submitRef = useRef(onSubmit);
  useLayoutEffect(() => { submitRef.current = onSubmit; }, [onSubmit]); // 전송 시점에 항상 최신 submit(첨부 게이트/드래프트 클로저) — 렌더 중 ref 기록 금지(lint)
  // t_2f296081 ③ (대표님 10/4): B 계층 입력창 포커스 중 pttKey(V, userPrefs 단일 소스) 타격 =
  // 음성 홀드/토글 시작. 전역 window keydown은 isEditableFocus(입력 포커스)에서 스킵하므로
  // 이중 발동 없음 — capture가 입력창 한정 예외로 press()를 직접 호출하고, 전역 keyup(동일 키,
  // 포커스 예외 없음)이 기존대로 release/cancel을 담당한다(hold 모드 릴리스 전송·toggle 재타격
  // 종료 모두 성립). preventDefault는 'v' 문자 삽입 차단 = pttKey 우선 병합(대표님 지시).
  // 마이크 버튼(chat-voice-back)은 상시 병존 유지 — 키를 모르는 사용자도 클릭 가능(#304 계약).
  const voicePressRef = useRef(onVoicePress);
  useLayoutEffect(() => { voicePressRef.current = onVoicePress; }, [onVoicePress]);
  // PTT 장착 게이트: onVoicePress는 화면이 PTT 활성 상태에서만 주입한다(t_2f296081 ③ 설계 —
  // 데모/미연결은 화면이 콜백 없이 전달, 또는 undefined). 데모는 startHold가 no-op이라 무해.
  const voiceActiveRef = useRef({ enabled: false });
  useLayoutEffect(() => { voiceActiveRef.current = { enabled: Platform.OS === 'web' && !!onVoicePress }; }, [onVoicePress]);
  const handleInputKeyDown = useCallback((e: { nativeEvent?: unknown }) => {
    if (Platform.OS !== 'web') return;
    const native = e.nativeEvent as KeyboardEvent | undefined;
    if (!native || native.defaultPrevented) return;
    const action = composerAction(native, { pttKey: getPttKey() ?? PTT_DEFAULT_KEY, voiceEnabled: voiceActiveRef.current.enabled });
    if (action === 'send') {
      native.preventDefault();
      submitRef.current();
    } else if (action === 'voice') {
      native.preventDefault(); // 'v' 타이핑 차단 — 키 재매핑 시 새 키가 동일 역할(단일 소스)
      // React 컨테이너는 document 루트 — 이 capture 단계에서 네이티브 전파를 끊어야 window
      // keydown(PTT 전역 리스너, isEditableFocus 스킵 대상)에 도달하기 전에 소비된다.
      // 안 끊으면: 포커스가 스테이지로 이동한 뒤 bubbles: true 재분합 상승 이벤트가 window
      // 리스너를 관통 → toggle 모드 재호출(녹음 정지) 위험. keyup은 창 밖이라 무영향(릴리스 정상).
      native.stopPropagation();
      setKeyboardOpen(false); // 즉시 A 진입 — 스테이지 링이 녹음 시각화(owner: VoiceStage)
      voicePressRef.current?.();
    }
    // 'newline'/'pass': 개입 없음 — textarea 개행·OS 편집 단축키(Ctrl+X/Z/C/V)·드래그 선택 그대로.
  }, []);
  // RN 0.86 .d.ts가 TextInputProps에 capture·rows를 선언 누락(flow/RNW에는 존재) → 웹 전용 props 스프레드.
  // rows=1 필수: textarea의 height:'auto' 계측은 rows가 box 높이를 정하므로, 기본 rows=2면 1줄 본문도
  // scrollHeight 2줄로 나온다(MUI TextareaAutosize 동일 처방). 네이티브는 rows 미지원 prop = 무시(no-op).
  const WEB_INPUT_PROPS = { onKeyDownCapture: handleInputKeyDown, rows: 1 } as Record<string, unknown>;
  // ── t_c690274e 요구 3: 높이 성장(1줄→최대 5줄, 초과 내부 스크롤)·발송(value 소거) 후 원복 ──
  // MUI TextareaAutosize와 동일한 명령형 계측: height auto→scrollHeight(패딩 포함 자연 높이)→[48,155.75] 클램프.
  // React 스타일에 height를 넣지 않는 이유: 고정 높이에서 scrollHeight는 clientHeight에 물려 축소 계측이
  // 불가능(삭제 시 5줄에 고착). deps=[value,inputOpen] — 마운트/키보드 계층 개방·본문 변경·소거 시에만
  // 재계측(스트리밍 재렌더 시 불필요 reflow 금지). paper가 rest로 투하한 testID가 textarea에 그대로 있어
  // (RN-web data-testid) DOM 조회는 제품 코드 범위 내 결정적 셀렉터.
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !inputOpen) return;
    const ta = document.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement | null;
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    // 빈 값은 계측하지 않는다 — placeholder가 좁은 폭(390px 모바일 B 계층, '에이전트에게 메시지 보내기'
    // 2줄 절첩)에서 scrollHeight를 본문 없이 2줄(75px)로 부른다(Chrome placeholder 최소content known 동작).
    // 본문 입력부터 계측 — IME 조합 text도 RN-web
    // onChangeText가 value에 실어주므로 조합 중 성장이 정상 동작한다.
    if (!value) {
      ta.style.height = `${INPUT_MIN_HEIGHT}px`;
      ta.style.overflowY = 'hidden';
      return;
    }
    ta.style.height = 'auto';
    const natural = ta.scrollHeight;
    ta.style.height = `${inputHeightFor(natural)}px`;
    ta.style.overflowY = inputScrolls(natural) ? 'auto' : 'hidden';
  }, [value, inputOpen]);
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
            // t_55e92e7e 실행 배선: ↓/↗ 라벨의 '놓으면 실행'을 참으로 — 첨부 경로 단일 소스 재사용.
            onPhoto={onPhoto}
            onFile={onFile}
            recording={recording}
            level={level}
            error={pttError}
            pending={pttPending}
            externalHolding={pttCapturing}
          />
        </View>
      )}
      {/* 권한 거부 폴백 안내는 VoiceStage 내부(chat-voice-fallback) — 자동 입력창 병행 개방은 inputOpen */}
      {inputOpen && (
        <View style={styles.inputBar} testID="chat-input-bar">
          {/* t_5e592321 되돌림(대표님 9/30): 마이크 탭을 입력좌·전송을 최우로 — 0d351d4d 반전 이전 배치 복구.
              PC·데모(voiceMode=false)는 기존 좌=첨부 … 우=전송 배치 DOM 불변. */}
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
              // t_c690274e (대표님 10/3 'shift+엔터 줄바꿈 불가'): Shift+Enter=개행(\n 삽입)·Enter 단독=전송·
              // 조합 중 Enter=미전송 복원 — 직전 HEAD(f7e0fcf9)는 multiline=false+returnKeyType='send'로
              // Enter/Shift+Enter 모두 submit 경로만 태웠다(git show f7e0fcf9 …:ChatInputConsole.tsx:154 실측).
              //   웹: multiline+blurOnSubmit=false → RN-web handleKeyDown이 Enter submit을 스킵하고
              //        개행을 기본 동작에 남긴다 → Shift+Enter는 그대로 개행. Enter 단독은 아래
              //        onKeyDownCapture에서 preventDefault(개행 차단)+submit 승격. IME 조합 중
              //        (isComposing/keyCode 229)은 절대 승격 금지 — RN-web도 같은 가드로 submit을 막는다.
              //   네이티브(0.86 new arch): submitBehavior='submit'가 multiline에서 Enter=submit
              //        (Shift+Enter=개행), blurOnSubmit=false로 전송 후 포커스 유지.
              multiline
              blurOnSubmit={false}
              submitBehavior="submit"
              testID="chat-input"
              onSubmitEditing={onSubmit}
              // RN 0.86 .d.ts가 TextInputProps에 onKeyDownCapture/rows를 선언하지 않아(flow·RN-web에는 존재)
              // 웹 전용 props로 스프레드 투하 — paper가 rest로 RN-web에 넘기고 pickProps가 DOM textarea에 전달.
              {...WEB_INPUT_PROPS}
              accessibilityLabel={t('chat.input')}
            />
          </View>
          {/* 마이크 탭 = 키보드 닫히고 A 복귀 — B→A 유일한 전이 (#304). 전송의 좌측에 상치 (t_5e592321). */}
          {/* PC/네이티브/데모 + 음성 모드 공통: 우측 끝 전송 버튼 (t_64af90b0 #4 — paper Button disabled 색상 문제 → 커스텀 Pressable) */}
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
    // t_c690274e 요구 3: 구 maxHeight 48(sp6*2)는 1줄 고정 시대의 상한 — 제거.
    // 높이는 useLayoutEffect의 명령형 계측(inputHeightFor: 48→155.75 클램프)이 소유한다.
    // 남은 상한(최대 5줄+내부 스크롤)은 그 클램프가 보장하므로 CSS 상한은 이중 제한이 된다.
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
