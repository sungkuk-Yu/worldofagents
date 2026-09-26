import type { ChatMessage, StructuredPayload } from '../types';
export interface CardActionHandlers {
  openThread: (message: ChatMessage) => void;
  toggleFavorite: (message: ChatMessage) => void;
  forkFromHere: (message: ChatMessage) => void;
  toggleTaskDone?: (message: ChatMessage, index: number, done: boolean) => void;
  openFile?: (url: string) => void;
}
export interface CardProps {
  message: ChatMessage;
  payload?: StructuredPayload;
  handlers: CardActionHandlers;
}
