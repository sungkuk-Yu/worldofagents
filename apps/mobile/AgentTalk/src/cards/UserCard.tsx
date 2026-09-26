import React from 'react';
import TextCard from './TextCard';
import type { CardProps } from './types';
export default function UserCard(props: CardProps) {
  return <TextCard {...props} />;
}
