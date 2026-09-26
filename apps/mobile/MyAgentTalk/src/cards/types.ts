import type { ChatMessage, StructuredPayload } from '../types';
export interface CardActionHandlers {
  openThread: (message: ChatMessage) => void;
  toggleFavorite: (message: ChatMessage) => void;
  forkFromHere: (message: ChatMessage) => void;
  /** Wave 2 (t_174b66d2): 대화 카드 → 볼트 노트 / 칸반 카드 (from-message API) */
  saveToVault?: (message: ChatMessage) => Promise<unknown>;
  addCardToBoard?: (message: ChatMessage) => Promise<unknown>;
  toggleTaskDone?: (message: ChatMessage, index: number, done: boolean) => void;
  openFile?: (url: string) => void;
  /** form 카드 제출 — content를 사용자 메시지로 전송, 성공 시 true (Wave 1 #1) */
  submitForm?: (message: ChatMessage, content: string) => Promise<boolean>;
}
export interface CardProps {
  message: ChatMessage;
  payload?: StructuredPayload;
  handlers: CardActionHandlers;
}
