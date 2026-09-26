// usePushToTalk — PTT 입력 캡처 (카드 t_eded715c; 백엔드 t_d75ca81c 캐리어)
// PC 웹: 키보드 단축키(기본 V, userPrefs.pttKey) 누르는 동안 녹음 → 릴리스로 전송(hold) 또는
//        한 번 더 눌러 종료(toggle). 모바일 웹: 터치 홀드(onPressIn/out) — 같은 캡처 재사용.
// 네이티브(ios/android): 이 훅은 inactive — 조이스틱 롱프레스 경로(useVoiceSession)가 이미 음성 입력.
// 오디오 경로: getUserMedia → AudioContext(16kHz) → ScriptProcessor → Int16LE PCM 프레임
//               → talk.frame() (WS 바이너리) → talk.end() (서버 Whisper v3-Turbo → transcript).
// 입력 예외(확정 ③): 텍스트 입력에 포커스가 있으면 키를 캡처하지 않는다(pttLogic.isEditableFocus).
// 보안 실패(마이크 권한 거부/비보안 컨텍스트)는 errorKey 상태로 노출 — 조용히 죽이지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { subscribePrefs, getPttKey, getPttMode, hydratePrefs } from '../lib/userPrefs';
import { normalizePttMode, isEditableFocus, PttMode } from '../lib/pttLogic';

export interface TalkBridge {
  ready: boolean;
  start: (mode?: 'hold' | 'toggle') => void;
  frame: (pcm: ArrayBuffer) => void;
  end: () => void;
  cancel: () => void;
}

interface PttAudio {
  stop: (send: boolean) => void;
}

export interface UsePushToTalkReturn {
  /** PTT가 이 플랫폼에서 사용 가능 (웹 + talk 브리프 연결) */
  enabled: boolean;
  active: boolean;
  /** 0..1 녹음 레벨 — 입력 배너 웨이브폼용 */
  level: number;
  mode: PttMode;
  /** 캡처 실패 시 i18n 키 (errors.micDenied 등) */
  error: string | null;
  /** 키 누름(또는 홀드 시작) — mode에 따라 시작/토글 */
  press: () => void;
  release: () => void;
  /** Escape 등 취소 — 서버에 전송하지 않고 폐기(audio.cancel) */
  cancel: () => void;
}

/** 브라우저 AudioContext + ScriptProcessor 기반 16k PCM 캡처. 종료 시 스트림/컨텍스트 해제. */
async function startCapture(onFrame: (buf: ArrayBuffer, level: number) => void): Promise<PttAudio> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const Ctor = (window as unknown as { AudioContext: typeof AudioContext }).AudioContext;
  // Safari는 sampleRate 옵션을 무시하고 48k로 여는 경우가 일반적 → 리샘플로 16k 보장.
  const ctx = new Ctor({ sampleRate: 16000 } as AudioContextOptions);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(1024, 1, 1);
  const ratio = Math.max(1, Math.round(ctx.sampleRate / 16000));
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    // 레벨(peak) — UI 표시용
    let peak = 0;
    for (let i = 0; i < input.length; i++) { const a = input[i] < 0 ? -input[i] : input[i]; if (a > peak) peak = a; }
    // 리샘플(간이 스텝) + float→Int16LE
    const outLen = Math.floor(input.length / ratio);
    if (outLen <= 0) return;
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const v = input[i * ratio];
      out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    onFrame(out.buffer, Math.min(1, peak * 2));
  };
  source.connect(proc);
  proc.connect(ctx.destination);
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { proc.disconnect(); } catch { /* already torn down */ }
      try { source.disconnect(); } catch { /* ignore */ }
      for (const t of stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
      void ctx.close().catch(() => undefined);
    },
  };
}

export function usePushToTalk(talk: TalkBridge, opts: { active?: boolean } = {}): UsePushToTalkReturn {
  const isWeb = Platform.OS === 'web';
  const enabled = isWeb && talk.ready && opts.active !== false;
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mode = getPttMode() ?? normalizePttMode(undefined);
  const pttKey = getPttKey() ?? 'KeyV'; // 키맵 재매핑 → effect deps로 윈도우 리스너 재장착
  const captureRef = useRef<PttAudio | null>(null);
  const activeRef = useRef(false);
  const keyHeldRef = useRef(false);

  // 프리퍼런스 재로더 — 키맵 화면에서 바꾸면 키 리스너가 즉시 새 키를 본다.
  // hydratePrefs: 앱 부팅 화면이 VoiceHome이 아닐 수 있으므로(직접 URL 진입/새로고침) PTT도 1회 보장.
  const [, forceRender] = useState(0);
  useEffect(() => {
    void hydratePrefs().then(() => forceRender((n) => n + 1)).catch(() => undefined);
    return subscribePrefs(() => forceRender((n) => n + 1));
  }, []);

  const stopCapture = useCallback((send: boolean) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    setLevel(0);
    captureRef.current?.stop(send);
    captureRef.current = null;
    if (send) talk.end(); else talk.cancel();
  }, [talk]);

  // 프레임 콜백은 AudioWorklet 스레드 근처에서 초당 수십 회 — 상태 갱신은 120ms 스로틀
  const levelAtRef = useRef(0);
  const pushLevel = useCallback((lvl: number) => {
    const now = Date.now();
    if (now - levelAtRef.current < 120) return;
    levelAtRef.current = now;
    setLevel(lvl);
  }, []);

  const startCaptureIfIdle = useCallback(() => {
    if (activeRef.current || !enabled) return;
    activeRef.current = true;
    setActive(true);
    setError(null);
    talk.start(mode); // audio.started 오면 useChatSession.talking=true — PCM은 여기서부터 흐름
    void startCapture((buf, lvl) => {
      pushLevel(lvl);
      if (activeRef.current) talk.frame(buf);
    }).then((cap) => {
      if (activeRef.current) captureRef.current = cap;
      else cap.stop(false); // 그새 종료된 세션 — 즉시 해제
    }).catch(() => {
      setError('errors.micDenied');
      activeRef.current = false;
      setActive(false);
      talk.cancel();
    });
  }, [enabled, talk, pushLevel, mode]);

  const press = useCallback(() => {
    if (!enabled) return;
    if (mode === 'toggle') {
      if (activeRef.current) stopCapture(true);
      else startCaptureIfIdle();
      return;
    }
    startCaptureIfIdle(); // hold: 키 다운에서 시작(중복 누름은 talk.start 가드)
  }, [enabled, mode, startCaptureIfIdle, stopCapture]);

  const release = useCallback(() => {
    if (mode !== 'hold') return;
    stopCapture(true);
  }, [mode, stopCapture]);

  const cancel = useCallback(() => stopCapture(false), [stopCapture]);

  // 키보드 PTT — window 리스너. 입력 예외(③)·반복 이벤트 무시·우클릭/포커스아웃 시 릴리스 보장.
  useEffect(() => {
    if (!enabled || !isWeb || typeof window === 'undefined') return;
    const key = pttKey;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code !== key) return;
      if (isEditableFocus(document.activeElement as HTMLElement & { isContentEditable?: boolean })) return;
      e.preventDefault(); // 'V'가 텍스트로 남거나 브라우저 검색으로 새는 것 방지
      keyHeldRef.current = true;
      press();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== key) return;
      keyHeldRef.current = false;
      release();
    };
    const releaseAll = () => { if (keyHeldRef.current) { keyHeldRef.current = false; release(); } };
    const onCancel = (e: KeyboardEvent) => { if (e.key === 'Escape' && activeRef.current) cancel(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    window.addEventListener('keydown', onCancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('keydown', onCancel);
      releaseAll(); // 언마운트(화면 이탈) 중이면 릴리스 전송으로 마무리
    };
  }, [enabled, isWeb, pttKey, press, release, cancel]); // 키 재매핑/ press 변경 시 리스너 재장착

  // 언마운트 안전망 — 릴리스 미달 상태로 화면을 나가면 서버 안전망(30s/5m)에 기대지 않고 취소
  useEffect(() => () => { captureRef.current?.stop(false); }, []);

  return { enabled, active, level, mode, error, press, release, cancel };
}

export default usePushToTalk;
