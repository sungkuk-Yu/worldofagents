// useVoiceSession — API(REST+WS) ↔ 전역 스토어 연동 훅
// 설계: Phase 1 네비게이션 및 상태 관리 · API 연동 (REST + WebSocket)
// 동작:
//   - 장착 시 REST /api/sessions/ensure 시도 → 세션 id 확보
//   - WS /ws 연결 → transcript.partial/final → store.addTranscript(upsert)
//   - neuron.status/task.status → store.connectionStatus 반영 (오케스트레이터에 포워드)
//   - dev 모드(백엔드 없음)에서는 자동 데모 모드: 3초 후 가짜 트랜스크립트 스트림
import { useCallback, useEffect, useRef, useState } from 'react';
import { getState, useStore, setState } from '../store';
import i18n from '../i18n';
import { api, connectVoiceSocket, setApiConfig, VoiceSocket, ServerMessage } from '../lib/api';
import { orchestrator } from '../neurons';

export interface UseVoiceSessionOptions {
  /** REST/WS 서버 주소 오버라이드 (기본 localhost:3000, EXPO_PUBLIC_API_URL) */
  baseUrl?: string;
  /** 데모 모드 강제 (백엔드 미기동 시 목업 트랜스크립트) */
  forceDemo?: boolean;
}

export interface UseVoiceSessionReturn {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'disconnected';
  /** REST 세션 id — null이면 데모/미연결 */
  sessionId: string | null;
  /** 녹음 시작 핸들러 */
  startSession: () => Promise<void>;
  /** 트랜스크립트 전송 (WebSocket "transcript" 프레임, is_final) */
  sendFinalTranscript: (text: string) => void;
  /** 데모 모드 여부 — UI에 뱃지 표시용 */
  isDemo: boolean;
}

// 데모 스크립트 4종 — 렌더/push 시점 t()로 해석 (모듈 상수 고정 금지: 언어 전환 반영)
const DEMO_KEYS = ['voice.demoTranscript1', 'voice.demoTranscript2', 'voice.demoTranscript3', 'voice.demoTranscript4'] as const;

export function useVoiceSession(opts: UseVoiceSessionOptions = {}): UseVoiceSessionReturn {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const socketRef = useRef<VoiceSocket | null>(null);
  const demoIndex = useRef(0);
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // baseUrl 오버라이드
  useEffect(() => {
    if (opts.baseUrl) {
      setApiConfig({
        apiUrl: opts.baseUrl,
        wsUrl: opts.baseUrl.replace(/^http/, 'ws') + '/ws',
      });
    }
  }, [opts.baseUrl]);

  // 연결 정리
  useEffect(() => {
    return () => {
      socketRef.current?.close();
      if (demoTimer.current) clearTimeout(demoTimer.current);
    };
  }, []);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'transcript.partial': {
        const { text } = msg;
        getState().upsertTranscript({
          id: `partial-${msg.session_id}-${text.length}`,
          text,
          isFinal: false,
          speaker: 'user',
          timestamp: new Date(),
        });
        break;
      }
      case 'transcript.final': {
        const { text, message_id } = msg;
        getState().addTranscript({
          id: message_id ?? `final-${Date.now()}`,
          text,
          isFinal: true,
          speaker: 'user',
          timestamp: new Date(),
        });
        setState({ isRecording: false });
        break;
      }
      case 'neuron.status': {
        // 뉴런 상태 → 오케스트레이터 미러 (네오런 대시보드 연동)
        const slug = msg.neuron.slug as 'empathy' | 'answer' | 'visual' | 'custom';
        const isStart = msg.status === 'running' || msg.status === 'active';
        if (isStart) orchestrator.activate(slug, msg.quip);
        else orchestrator.deactivate(slug, msg.quip);
        break;
      }
      case 'task.status': {
        setState({ connectionStatus: 'connected' });
        break;
      }
      case 'error':
      case 'session.error': {
        setState({ connectionStatus: 'disconnected' });
        break;
      }
      default:
        break;
    }
  }, []);

  const startSession = useCallback(async () => {
    setState({ connectionStatus: 'connecting' });

    // 1) REST 세션 확보
    let sid: string | null = null;
    try {
      const env = await api.ensureSession('musk');
      const data = env?.data;
      if (data?.id) {
        sid = data.id;
        setSessionId(sid);
      }
    } catch {
      // 서버 없음 → 데모 폴백
    }

    if (!sid && opts.forceDemo !== false) {
      // 데모 모드: WS 없이 가짜 트랜스크립트 스트림
      setIsDemo(true);
      setState({ connectionStatus: 'connected' });
      getState().clearTranscripts();
      demoIndex.current = 0;
      const pushNext = () => {
        const text = i18n.t(DEMO_KEYS[demoIndex.current % DEMO_KEYS.length]);
        demoIndex.current += 1;
        getState().addTranscript({
          id: `demo-${Date.now()}`,
          text,
          isFinal: true,
          speaker: demoIndex.current % 3 === 0 ? 'agent' : 'user',
          timestamp: new Date(),
        });
        demoTimer.current = setTimeout(pushNext, 1600);
      };
      demoTimer.current = setTimeout(pushNext, 600);
      return;
    }

    // 2) 실서버 → WS 연결
    setIsDemo(false);
    socketRef.current?.close();
    socketRef.current = connectVoiceSocket(sid, {
      onConnected: () => setState({ connectionStatus: 'connected' }),
      onPartial: handleServerMessage,
      onFinal: handleServerMessage,
      onNeuronStatus: handleServerMessage,
      onTaskStatus: handleServerMessage,
      onError: handleServerMessage,
      onStatusChange: (status) => setState({ connectionStatus: status }),
    });
  }, [handleServerMessage, opts.forceDemo]);

  const sendFinalTranscript = useCallback((text: string) => {
    const sid = sessionId;
    if (sid && socketRef.current?.ready) {
      socketRef.current.send(
        JSON.stringify({ type: 'transcript', text, session_id: sid, is_final: true })
      );
    }
  }, [sessionId]);

  return { connectionStatus, sessionId, startSession, sendFinalTranscript, isDemo };
}

export default useVoiceSession;