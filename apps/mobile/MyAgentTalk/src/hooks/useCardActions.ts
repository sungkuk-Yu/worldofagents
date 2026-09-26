import { useState } from 'react';
import { Linking } from 'react-native';
import type { ChatMessage } from '../types';
import type { CardActionHandlers } from '../cards/types';
import { toggleTaskOverride } from '../lib/cardLogic';
import { safeFileUrl } from '../cards/payload';

// 가상 목록이 카드를 해제해도 수동 완료와 즐겨찾기는 화면에 보존한다.
export function useCardActions(openThread: CardActionHandlers['openThread'], forkFromHere: CardActionHandlers['forkFromHere']) {
  const [local, setLocal] = useState<Record<string, Pick<ChatMessage, 'favorite' | 'taskOverrides'>>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const decorate = (message: ChatMessage): ChatMessage => ({ ...message, ...local[message.id] });
  const handlers: CardActionHandlers = {
    openThread, forkFromHere,
    toggleFavorite: (message) => setLocal((prev) => ({ ...prev, [message.id]: { ...prev[message.id], favorite: !(prev[message.id]?.favorite ?? message.favorite) } })),
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
