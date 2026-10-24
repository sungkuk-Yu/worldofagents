import React, { createContext, useContext } from 'react';
import { View } from 'react-native';
import { Button, Checkbox, Text } from 'react-native-paper';
import ChatMarkdown from './ChatMarkdown';
import { ChoicePart, ChoiceState, choiceSubmission, createChoiceState } from '../lib/choiceParse';

export const ChoiceContext = createContext<{
  activeId?: string;
  states: Record<string, ChoiceState>;
  toggle: (id: string, item: number) => void;
  submit: (id: string) => void;
}>({ states: {}, toggle: () => {}, submit: () => {} });

export default function ChoiceBody({ messageId, parts }: { messageId: string; parts: ChoicePart[] }) {
  const controls = useContext(ChoiceContext);
  const state = controls.states[messageId] ?? createChoiceState();
  const active = controls.activeId === messageId && !state.locked;
  return <View testID={`choices-${messageId}`}>
    {parts.map((part, index) => part.kind === 'text'
      ? <ChatMarkdown key={index} content={part.text} />
      : <View key={index}>{part.items.map((item) => <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Checkbox.Android status={state.selected.includes(item.id) ? 'checked' : 'unchecked'} disabled={!active}
          accessibilityLabel={`${item.number}번 ${item.text}`} onPress={() => controls.toggle(messageId, item.id)} />
        <Text style={{ flex: 1 }}>{item.number}. {item.text}</Text>
      </View>)}</View>)}
    <Button disabled={!choiceSubmission(parts, state, active)} onPress={() => controls.submit(messageId)}>선택</Button>
  </View>;
}
