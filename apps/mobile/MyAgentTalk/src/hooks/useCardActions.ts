import { useState } from 'react';
import { Linking } from 'react-native';
import type { ChatMessage } from '../types';
import type { CardActionHandlers } from '../cards/types';
import { toggleTaskOverride } from '../lib/cardLogic';
import { safeFileUrl } from '../cards/payload';
import { api } from '../lib/api';

// 가상 목록이 카드를 해제해도 수동 완료와 즐겨찾기는 화면에 보존한다.
// 즐겨찾기 영속화 (백엔드 t_219c4d36 연결): 낙관적 업데이트 → PATCH /api/messages/:id/favorite,
// 실패 시 원래 값으로 롤백 + errors.favorite 노출. 서버가 곧 진실 — 재진입 시 GET messages의
// favorite 필드(chatLogic 정규화)로 복원되므로 로컬 override는 화면 세션 한정 캐시다.
export function useCardActions(
  openThread: CardActionHandlers['openThread'],
  forkFromHere: CardActionHandlers['forkFromHere'],
  send?: (content: string) => Promise<{ ok: boolean }>,
) {
  const [local, setLocal] = useState<Record<string, Pick<ChatMessage, 'favorite' | 'taskOverrides'>>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const decorate = (message: ChatMessage): ChatMessage => ({ ...message, ...local[message.id] });
  /** 즐겨찾기 값 설정 — 낙관 반영 → PATCH → 실패 시 롤백. */
  const applyFavorite = async (message: ChatMessage, next: boolean) => {
    const prev = local[message.id]?.favorite ?? message.favorite ?? false;
    if (prev === next) return true;
    setLocal((cur) => ({ ...cur, [message.id]: { ...cur[message.id], favorite: next } }));
    try {
      const env = await api.setFavorite(message.id, next);
      if (!env.ok) throw new Error('favorite');
      return true;
    } catch {
      setLocal((cur) => ({ ...cur, [message.id]: { ...cur[message.id], favorite: prev } }));
      setActionError('errors.favorite');
      return false;
    }
  };
  const toggleFavorite = (message: ChatMessage) => {
    // 미전송(optimistic/failed) 메시지는 서버 행이 없어 즐겨찾기 불가 — 스레드/포크 가드와 동일 원칙
    if (message.pending || message.status === 'failed') { setActionError('errors.unavailableAction'); return; }
    void applyFavorite(message, !(local[message.id]?.favorite ?? message.favorite ?? false));
  };
  // t_a0e998cc (대표님 9/26): 카드→볼트 노트 / 카드→보드 액션과 다중 선택 "보관/볼트로" 제거 —
  // 대화 카드는 기본적으로 볼트에 올라가므로 별도 저장 액션이 불필요.
  // api.noteFromMessage / api.cardFromMessage (백엔드 from-message)는 그대로 두고 UI에서만 뺐다.
  const handlers: CardActionHandlers = {
    openThread, forkFromHere,
    toggleFavorite,
    submitForm: async (_message, content) => {
      if (!send) return false;
      try { const result = await send(content); return result.ok; } catch { setActionError('errors.request'); return false; }
    },
    toggleTaskDone: (message, index, done) => setLocal((prev) => ({
      ...prev, [message.id]: { ...prev[message.id], taskOverrides: toggleTaskOverride({ ...message, ...prev[message.id] }, index, done).taskOverrides },
    })),
    openFile: (url) => {
      const safe = safeFileUrl(url);
      if (!safe) { setActionError('errors.file'); return; }
      void Linking.openURL(safe).catch(() => setActionError('errors.file'));
    },
  };
  return { handlers, decorate, actionError, setActionError };
}
