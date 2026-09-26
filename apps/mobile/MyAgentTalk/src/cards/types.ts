import type { ChatMessage, StructuredPayload } from '../types';
export interface CardActionHandlers {
  openThread: (message: ChatMessage) => void;
  toggleFavorite: (message: ChatMessage) => void;
  forkFromHere: (message: ChatMessage) => void;
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
