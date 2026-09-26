// 전역 상태 관리 스토어 — Zustand 스타일 API (의존성 없는 구현)
// 설계: Phase 1 네비게이션 및 상태 관리 · useSyncExternalStore 기반
// 참고: 패키지 설치(zustand)가 보안 스캔으로 차단되어 동일 API 형태의 경량 구현으로 대체.
//   `create<T>()(fn)` → `useStore(selector)` 시그니처로 후일 zustand로 교체 가능.
import { useSyncExternalStore } from 'react';
import { Dialogue, DialogType, Transcript, SegmentHistoryEntry } from '../types';

// ── 상태 타입 ────────────────────────────────────────
export interface DialogueState {
  // 대화 목록 (화면 6)
  dialogues: Dialogue[];
  activeDialogueId: string | null;

  // 실시간 트랜스크립트 (화면 7)
  transcripts: Transcript[];
  isRecording: boolean;

  // 세그먼트 히스토리 (화면 10 결과 캔버스)
  segmentHistory: SegmentHistoryEntry[];
  activeSegmentIndex: number;

  // API 연결 상태
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'disconnected';

  // 액션
  setDialogues: (dialogues: Dialogue[]) => void;
  setActiveDialogue: (id: string | null) => void;
  addDialogue: (dialogue: Dialogue) => void;

  addTranscript: (t: Transcript) => void;
  upsertTranscript: (t: Transcript) => void;
  clearTranscripts: () => void;
  setRecording: (rec: boolean) => void;

  setSegmentHistory: (history: SegmentHistoryEntry[]) => void;
  addSegment: (entry: SegmentHistoryEntry) => void;
  removeSegment: (index: number) => void;
  selectSegment: (index: number) => void;
  nextSegment: () => void;
  prevSegment: () => void;

  setConnectionStatus: (status: DialogueState['connectionStatus']) => void;
}

// ── 경량 스토어 코어 ─────────────────────────────────
type Listener = () => void;

function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();

  const set = (partial: Partial<T> | ((prev: T) => Partial<T>)) => {
    const patch = typeof partial === 'function' ? (partial as (p: T) => Partial<T>)(state) : partial;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const get = () => state;
  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { set, get, subscribe };
}

// ── 스토어 인스턴스 ──────────────────────────────────
const store = createStore<DialogueState>({
  dialogues: [],
  activeDialogueId: null,
  transcripts: [],
  isRecording: false,
  segmentHistory: [],
  activeSegmentIndex: -1,

  connectionStatus: 'idle',

  setDialogues: (dialogues) => store.set({ dialogues }),
  setActiveDialogue: (id) => store.set({ activeDialogueId: id }),

  addDialogue: (dialogue) =>
    store.set((prev) => ({
      dialogues: [dialogue, ...prev.dialogues.filter((d) => d.id !== dialogue.id)],
      activeDialogueId: dialogue.id,
    })),

  addTranscript: (t) =>
    store.set((prev) => ({
      transcripts: [...prev.transcripts, t].slice(-200),
    })),

  upsertTranscript: (t) =>
    store.set((prev) => {
      const idx = prev.transcripts.findIndex((x) => x.id === t.id || (x.text === t.text && !x.isFinal && t.isFinal));
      if (idx < 0) return { transcripts: [...prev.transcripts, t].slice(-200) };
      const next = [...prev.transcripts];
      next[idx] = t;
      return { transcripts: next };
    }),

  clearTranscripts: () => store.set({ transcripts: [] }),
  setRecording: (rec) => store.set({ isRecording: rec }),

  setSegmentHistory: (history) =>
    store.set({
      segmentHistory: history,
      activeSegmentIndex: Math.max(0, history.length - 1),
    }),

  addSegment: (entry) =>
    store.set((prev) => {
      const history = [...prev.segmentHistory, entry];
      return { segmentHistory: history, activeSegmentIndex: history.length - 1 };
    }),

  removeSegment: (index) =>
    store.set((prev) => {
      if (prev.segmentHistory.length <= 1) return prev; // 마지막 세그먼트 삭제 방지
      const next = prev.segmentHistory.filter((_, i) => i !== index);
      const cur = prev.activeSegmentIndex;
      let nextIndex = cur;
      if (index < cur) nextIndex = cur - 1;
      else if (index === cur) nextIndex = Math.min(cur, next.length - 1);
      return { segmentHistory: next, activeSegmentIndex: nextIndex };
    }),

  selectSegment: (index) =>
    store.set((prev) => ({
      activeSegmentIndex: Math.max(0, Math.min(index, prev.segmentHistory.length - 1)),
    })),

  nextSegment: () =>
    store.set((prev) => ({
      activeSegmentIndex: Math.min(prev.activeSegmentIndex + 1, prev.segmentHistory.length - 1),
    })),

  prevSegment: () =>
    store.set((prev) => ({
      activeSegmentIndex: Math.max(0, prev.activeSegmentIndex - 1),
    })),

  setConnectionStatus: (status) => store.set({ connectionStatus: status }),
});

// ── React 훅 ─────────────────────────────────────────
export function useStore<T>(selector: (state: DialogueState) => T): T {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => selector(store.get()),
    () => selector(store.get())
  );
}

export const getState = (): DialogueState => store.get();
export const setState = (patch: Partial<DialogueState>) => store.set(patch);

export type { SegmentHistoryEntry };
export type { DialogType };

export default { useStore, getState, setState };