import type { ComponentType } from 'react';
import type { CardProps } from './types';

// UI 의존 없는 레지스트리: 기본 등록은 defaults에서 한 번 수행한다.
const cards = new Map<string, ComponentType<CardProps>>();
export function registerCard(type: string, Component: ComponentType<CardProps>) {
  cards.set(type, Component);
}
/** 등록 여부만 확인 — 미등록 유형은 FallbackCard로 렌더한다 (#51 유연성 폴백). */
export function isCardRegistered(type?: string | null): boolean {
  return cards.has(type || 'text');
}
export function getCard(type?: string | null): ComponentType<CardProps> {
  const found = cards.get(type || 'text');
  if (found) return found;
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[cards] Unknown type:', type);
  const fallback = cards.get('text');
  if (!fallback) throw new Error('cards.text must be registered');
  return fallback;
}
