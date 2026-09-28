// 다중 선택 상태 훅 (t_70cbbd6b: ChatScreen→hooks 순수 추출, 로직 무변경)
// 진입 = 앱바 '선택' 버튼 또는 카드 롱프레스. 보관/이어가기 판정 로직은 화면이 소유하고
// 이 훅은 선택 모드/ID 집합/파생값(selectable·allSelected)만 응집한다.
import { useCallback, useMemo, useState } from 'react';
import type { ChatMessage } from '../lib/chatLogic';

export interface ChatSelection {
  active: boolean;
  ids: string[];
  selectedMessages: ChatMessage[];
  allSelected: boolean;
  begin: (withId?: string) => void;
  exit: () => void;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
}

export function useChatSelection(messages: ChatMessage[]): ChatSelection {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedMessages = useMemo(() => messages.filter((m) => selectedIds.includes(m.id)), [messages, selectedIds]);
  const selectableIds = useMemo(() => messages.filter((m) => !m.pending && m.status !== 'failed').map((m) => m.id), [messages]);
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;
  const exit = useCallback(() => { setSelectionMode(false); setSelectedIds([]); }, []);
  const toggle = useCallback((id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])), []);
  const selectAll = useCallback(() => setSelectedIds(selectableIds), [selectableIds]);
  const clear = useCallback(() => setSelectedIds([]), []);
  const begin = useCallback((withId?: string) => { setSelectionMode(true); if (withId) setSelectedIds([withId]); }, []);
  return { active: selectionMode, ids: selectedIds, selectedMessages, allSelected, begin, exit, toggle, selectAll, clear };
}
