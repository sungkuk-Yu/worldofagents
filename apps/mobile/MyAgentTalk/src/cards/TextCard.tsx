import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { CardProps } from './types';
import { cardStyles } from './styles';
import RichText from '../components/RichText';
import RevealBody from '../components/RevealBody';
import RichLinks from '../components/RichLinks';
import ChatMarkdown from '../components/ChatMarkdown';
import { looksLikeChatMarkdown } from '../lib/chatMarkdown';
import { safePayloadLinks } from '../lib/richtext';
import { renderFlags } from '../lib/renderFlags';
export default function TextCard({ message }: CardProps) {
  const { t } = useTranslation();
  // contentKey(시스템 안내문 등 로컬 문자열)는 평문 렌더 — 리치텍스트는 에이전트 응답용
  if (message.contentKey) return <Text style={cardStyles.body}>{t(message.contentKey, message.contentParams)}</Text>;
  const links = safePayloadLinks(message.payload?.links);
  // t_e9480e0f 백로그① — 에이전트 답변만 마크다운 게이트: 볼드/리스트/헤딩/표/hr 등 RichText가
  // 못 그리는 블록 문법이 감지되면 MarkdownView 계보(ChatMarkdown)로 통일 렌더.
  // 평문·링크·인라인코드·인용·코드블록뿐인 응답은 판정이 false → 아래 RichText 경로 = 기존과 100% 동일(회귀 금지).
  // 사용자 발화 버블은 텔레그램 관습대로 평문 유지(UserCard는 role!=='agent').
  // t_da4f8623 사람 타이핑 리빌 ② — 에이전트 행(empathy 재질문 포함) 본문은 RevealBody 경유:
  // 리빌 상태가 있으면 1자씩 노출+커서, 없으면(히스토리 재현·배치 GET·플래그 OFF·reduced-motion)
  // 아래 두 분기와 동일한 렌더를 그대로 내재(RichText/markdown passthrough) → 트리 1:1 무회귀.
  if (message.role === 'agent' && renderFlags.typewriterReveal) return <View>
    <RevealBody revealKey={message.id} content={message.content} allowMarkdown fallbackTestId="chat-bubble" />
    {links.length > 0 && <RichLinks links={links} />}
  </View>;
  if (message.role === 'agent' && looksLikeChatMarkdown(message.content)) return <View>
    <ChatMarkdown content={message.content} testID="chat-bubble" />
    {links.length > 0 && <RichLinks links={links} />}
  </View>;
  return <View>
    <RichText content={message.content} />
    {links.length > 0 && <RichLinks links={links} />}
  </View>;
}
