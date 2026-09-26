/**
 * 마크다운 뷰어 — Wave 2 볼트 (t_174b66d2)
 * 렌더 엔진: react-native-markdown-display (markdown-it 기반, html:false — raw HTML이
 * 태그로 해석되지 않는다 = sanitize. 법률 카드 지적 항목과 동일 원칙. WYSIWYG 직접 구현 금지 지시).
 * [[wikilink]]는 vaultLogic.toRenderableMarkdown로 mat-note: 스킴 링크로 치환한 뒤 렌더하고,
 * onLinkPress에서 스킴을 잡아 노트 이동으로 전환(false 반환 → 라이브러리의 Linking.openURL 차단).
 * http(s)는 인앱 브라우저. 이미지 스킴은 데이터 URL/https만 허용(기본값에서 http 강등).
 *
 * 레퍼런스(#50): Obsidian 읽기 뷰 — 본문 최대폭 제한 없이 카드 안 여백, 링크=액센트+언더라인.
 */
import React, { useCallback, useMemo } from 'react';
import { Linking, Platform, StyleSheet, Text as RNText } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { colors, radii, spacing, typography } from '../theme';
import { NOTE_LINK_SCHEME, parseNoteLink, toRenderableMarkdown } from '../lib/vaultLogic';

export interface MarkdownViewProps {
  content: string;
  /** [[노트제목]] 탭 — 존재하는 노트면 그 노트, 없으면 미해결 링크로 호출측에서 처리 */
  onNoteLink?: (title: string) => void;
  style?: object;
}

const md = MarkdownIt({ typographer: true, html: false, linkify: true });

const mdStyles = StyleSheet.create({
  paragraph: { ...typography.body, color: colors.text1, marginVertical: spacing.sp1 },
  heading1: { ...typography.title1, color: colors.text1, marginTop: spacing.sp3 },
  heading2: { ...typography.title2, color: colors.text1, marginTop: spacing.sp3 },
  heading3: { ...typography.headline, color: colors.text1, marginTop: spacing.sp2 },
  heading4: { ...typography.headline, color: colors.text2 },
  heading5: { ...typography.subhead, color: colors.text2 },
  heading6: { ...typography.caption, color: colors.text2 },
  strong: { ...typography.bodyBold },
  em: typography.body,
  blockquote: { borderLeftWidth: 3, borderLeftColor: colors.borderStrong, paddingLeft: spacing.sp3, marginVertical: spacing.sp1 },
  blockquote_text: { ...typography.body, color: colors.text2, fontStyle: 'italic' },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, color: colors.text1, backgroundColor: colors.surfaceRaise, borderRadius: radii.xs, paddingHorizontal: spacing.sp1 },
  pre: { backgroundColor: colors.surfaceRaise, borderRadius: radii.sm, padding: spacing.sp3, marginVertical: spacing.sp2 },
  code_inline: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  code_block: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12.5, lineHeight: 19, color: colors.text1 },
  link: { ...typography.body, color: colors.accent, textDecorationLine: 'underline' },
  list_item: { ...typography.body, color: colors.text1, marginVertical: 2 },
  bullet_list: { marginVertical: spacing.sp1 },
  ordered_list: { marginVertical: spacing.sp1 },
  hr: { backgroundColor: colors.border, height: 1, marginVertical: spacing.sp2 },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, marginVertical: spacing.sp2 },
  th: { backgroundColor: colors.surfaceRaise, ...typography.subhead, color: colors.text1 },
  td: { ...typography.body, color: colors.text1 },
  image: { maxWidth: '100%' },
});

export default function MarkdownView({ content, onNoteLink, style }: MarkdownViewProps) {
  const renderable = useMemo(() => toRenderableMarkdown(content ?? ''), [content]);
  const handleLink = useCallback((url: string) => {
    const note = parseNoteLink(url);
    if (note) { onNoteLink?.(note.title); return false; } // false = 라이브러리의 openURL 억제
    if (url.startsWith(NOTE_LINK_SCHEME)) return false;   // 콜백 없는 화면 — 조용히 무시
    void Linking.openURL(url).catch(() => undefined);
    return false; // 우리가 직접 열었으므로 라이브러리 이중 호출 차단
  }, [onNoteLink]);
  if (!renderable.trim()) return <RNText style={[mdStyles.paragraph, style]} />;
  // allowedImageHandlers는 런타임 프로프(impl 지원, d.ts 미선언) — 기본값이 https/http/data 이미지만 허용.
  return <Markdown
    markdownit={md}
    style={mdStyles}
    onLinkPress={handleLink}
  >{renderable}</Markdown>;
}
