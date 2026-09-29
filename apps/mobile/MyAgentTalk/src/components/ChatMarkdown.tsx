// 채팅 버블 마크다운 렌더러 (t_e9480e0f 백로그①) — 에이전트 답변 전용.
// MarkdownView(Vault/LegalDoc전용)의 계보를 따르되 채팅 컨텍스트에 맞춤:
//  · 엔진: react-native-markdown-display + MarkdownIt(html:false) — raw HTML 미interpret = sanitize.
//  · typography 매핑만 기존 msgCard/cardStyles.body와 일치시킴(elevation·msgCard 스타일과 충돌 금지).
//  · fence(코드블록) rules 오버라이드: 배경·monospace·복사 버튼 (테스트ID code-copy — Wave1 RichText
//    코드블록과 동일 계약, 대표님 복사 우선 원칙).
//  · 링크 탭: onLinkPress false 반환으로 라이브러리의 openURL 이중호출을 막고 Linking이 열지
//    http(s)만 연다(javascript: 등 스킴 차단 — MarkdownView와 동일 원칙).
//  · 스트리밍 partially-valid: stabilizeStreamingMarkdown으로 미닫힌 fence 임시 마감;
//    미완 볼드(**)는 markdown-it이 그대로 두므로 별도 plain 버퍼 불요(게이트가 이미 plain 경로).
import React, { useCallback, useMemo } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { colors, radii, spacing, typography } from '../theme';
import { cardStyles } from '../cards/styles';
import { isSafeLink } from '../lib/richtext';
import { stabilizeStreamingMarkdown } from '../lib/chatMarkdown';
import ChatCodeBlock from './ChatCodeBlock';

// 인스턴스는 모듈당 1회 — 매편 new는 스트림 flush마다 파서 재생성(사소하지만 지양).
const md = MarkdownIt({ typographer: true, html: false, linkify: true });

const chatMdStyles = StyleSheet.create({
  // 본문 타이포 = cardStyles.body(RichText 경로와 동일 값) — 평문·마크다운 응답의 줄높임統一.
  paragraph: { ...typography.body, color: colors.text1, marginVertical: spacing.sp1 },
  heading1: { ...typography.title2, color: colors.text1, marginTop: spacing.sp2 },
  heading2: { ...typography.title2, color: colors.text1, marginTop: spacing.sp2 },
  heading3: { ...typography.headline, color: colors.text1, marginTop: spacing.sp1 },
  heading4: { ...typography.headline, color: colors.text2 },
  heading5: { ...typography.subhead, color: colors.text2 },
  heading6: { ...typography.caption, color: colors.text2 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  blockquote: { borderLeftWidth: 3, borderLeftColor: colors.borderStrong, paddingLeft: spacing.sp3, marginVertical: spacing.sp1, backgroundColor: 'transparent' },
  blockquote_text: { ...typography.body, color: colors.text2, fontStyle: 'italic' },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, color: colors.text1, backgroundColor: colors.surfaceRaise, borderRadius: radii.xs, paddingHorizontal: spacing.sp1 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  list_item: { ...typography.body, color: colors.text1, marginVertical: 2 },
  bullet_list: { marginVertical: spacing.sp1 },
  ordered_list: { marginVertical: spacing.sp1 },
  hr: { backgroundColor: colors.border, height: 1, marginVertical: spacing.sp2 },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, marginVertical: spacing.sp2 },
  tableScroll: { flexGrow: 0, marginVertical: spacing.sp2 },
  th: { backgroundColor: colors.surfaceRaise, ...typography.subhead, color: colors.text1, minWidth: 64 },
  td: { ...typography.body, color: colors.text1, minWidth: 64 },
  image: { maxWidth: '100%' },
});

export interface ChatMarkdownProps {
  content: string;
  /** 스트리밍 부분 텍스트 안전화 스위치(ChatFeed 스트리밍 카드만 true) */
  streaming?: boolean;
  style?: object;
  /** e2e 훅 (t_e9480e0f smoke_markdown): 히스토리=bubble, 스트리밍=bubble-stream 구분용 */
  testID?: string;
}

export default function ChatMarkdown({ content, streaming = false, style, testID = 'chat-markdown' }: ChatMarkdownProps) {
  const renderable = useMemo(
    () => (streaming ? stabilizeStreamingMarkdown(content ?? '') : content ?? ''),
    [content, streaming],
  );
  const rules = useMemo(() => ({
    // fence(코드블록) 오버라이드 — 렌더 규칙의 styles.fence 대신 우리 배색+복사 버튼.
    fence: (node: { key: string; content: string }) => (
      <ChatCodeBlock key={node.key} text={node.content.replace(/\n$/, '')} />
    ),
    // table 오버라이드 (검수조항: 표 가로 스크롤) — FlatList 행 안에서 표가 넓어도 버블을
    // 깨지 않게 가로 ScrollView 래퍼.
    table: (node: { key: string }, children: React.ReactNode, _parent: unknown, styles: any) => (
      <ScrollView key={node.key} horizontal testID="markdown-table-scroll" style={styles.tableScroll}>
        <View style={styles._VIEW_SAFE_table}>{children}</View>
      </ScrollView>
    ),
  }), []);
  const handleLink = useCallback((url: string) => {
    if (isSafeLink(url)) void Linking.openURL(url).catch(() => undefined);
    return false; // 우리가 직접 열었으므로 라이브러리 이중 openURL 차단
  }, []);
  if (!renderable.trim()) return <RNText style={[cardStyles.body, style]} testID={testID} />;
  return <View testID={testID} style={style}>
    <Markdown markdownit={md} style={chatMdStyles} rules={rules} onLinkPress={handleLink}>
      {renderable}
    </Markdown>
  </View>;
}
