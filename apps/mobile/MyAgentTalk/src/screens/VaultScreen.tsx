/**
 * 볼트 화면 — 옵시디언식 노트 UI (Wave 2, t_174b66d2)
 * 진입: 대화목록 헤더 ▦. 목록(폴더 레일 + 노트) → 상세(마크다운 뷰어 + [[wikilink]] + 백링크)
 * → 편집(TextInput 마크다운 원문 — WYSIWYG 금지 지시). 검색: GET /api/vault/search.
 *
 * 레이아웃 레퍼런스(#50): Obsidian 사이드바 — 웹은 좌측 폴더 패널, 모바일(390px)은 폴더 칩 레일.
 * 카드 본문 규칙: react-native-markdown-display 렌더 + sanitize(html:false)는 MarkdownView가 소유.
 * 백링크는 프론트 계산(백엔드 content 원문 보존 원칙): 전체 노트 캐시에서 [[타깃]] 스캔.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, VaultNote, VaultSearchHit, VaultTreeNode } from '../lib/api';
import { computeBacklinks, defaultFolderForNewNote, findNoteByTitle, flattenFolderTree } from '../lib/vaultLogic';
import MarkdownView from '../components/MarkdownView';
import { errorKey } from '../lib/errorKeys';
import { colors, radii, spacing, typography, webScreenMotion } from '../theme';

type Mode = { view: 'list' } | { view: 'note'; noteId: string } | { view: 'edit'; noteId: string | null; prefillTitle?: string };

export interface VaultScreenProps {
  navigation: any;
  route?: { params?: { noteId?: string; createTitle?: string } };
}

export default function VaultScreen({ navigation, route }: VaultScreenProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [tree, setTree] = useState<VaultTreeNode | null>(null);
  const [folder, setFolder] = useState<string | null>(null); // null = 전체
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<VaultSearchHit[] | null>(null);
  const [mode, setMode] = useState<Mode>({ view: 'list' });
  const [draft, setDraft] = useState<{ title: string; content: string; folder: string; tags: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [listEnv, treeEnv] = await Promise.all([api.listNotes({ limit: 200 }), api.getVaultTree()]);
      setNotes(listEnv.data ?? []);
      setTree(treeEnv.data?.tree ?? null);
    } catch (e) { setError(errorKey(e)); }
    finally { setLoading(false); }
  }, []);

  // 타이머 래퍼 — effect 동기 setState 회피 (FavoritesScreen load 패턴)
  useEffect(() => { const timer = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(timer); }, [refresh]);

  // 딥링크 진입 (대화→노트 저장 후 "노트 열기", 카드 액션에서)
  useEffect(() => {
    const noteId = route?.params?.noteId;
    const createTitle = route?.params?.createTitle;
    if (!noteId && !createTitle) return;
    const timer = setTimeout(() => {
      if (noteId) setMode({ view: 'note', noteId });
      else if (createTitle) startCreate(undefined, createTitle);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.noteId, route?.params?.createTitle]);

  const showToast = useCallback((key: string) => { setToast(key); setTimeout(() => setToast(null), 2500); }, []);

  const filtered = useMemo(() => {
    let out = notes;
    if (folder) out = out.filter((n) => n.folder === folder);
    if (tag) out = out.filter((n) => (n.tags ?? []).includes(tag));
    return out;
  }, [notes, folder, tag]);

  const allTags = useMemo(() => Array.from(new Set(notes.flatMap((n) => n.tags ?? []))).sort(), [notes]);
  const flatFolders = useMemo(() => (tree ? flattenFolderTree(tree) : []), [tree]);
  const current = mode.view === 'note' ? notes.find((n) => n.id === mode.noteId) ?? null : null;
  const backlinks = useMemo(
    () => (current ? computeBacklinks({ id: current.id, title: current.title, content: current.content }, notes) : []),
    [current, notes],
  );

  // [[wikilink]] 탭 — 제목 매칭, 없으면 Obsidian 관례대로 새 노트 편집 진입
  const openNoteLink = useCallback((title: string) => {
    const hit = findNoteByTitle(notes, title);
    if (hit) setMode({ view: 'note', noteId: hit.id });
    else startCreate(undefined, title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  function startCreate(targetFolder?: string, prefillTitle?: string) {
    setDraft({ title: prefillTitle ?? '', content: '', folder: defaultFolderForNewNote(targetFolder ?? folder), tags: '' });
    setMode({ view: 'edit', noteId: null, prefillTitle });
  }

  const onQuery = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) { setHits(null); return; }
    searchTimer.current = setTimeout(() => {
      api.searchNotes(value.trim()).then((env) => setHits(env.data ?? [])).catch(() => setHits([]));
    }, 350);
  };

  const saveDraft = async () => {
    if (!draft || !draft.title.trim()) return;
    const body = {
      title: draft.title.trim(),
      content: draft.content,
      folder: draft.folder.trim() || '/',
      tags: draft.tags.split(',').map((s) => s.trim()).filter(Boolean),
    };
    try {
      const env = mode.view === 'edit' && mode.noteId
        ? await api.patchNote(mode.noteId, body)
        : await api.createNote(body);
      const saved = env.data;
      await refresh();
      setDraft(null);
      setMode(saved ? { view: 'note', noteId: saved.id } : { view: 'list' });
      showToast(mode.view === 'edit' && mode.noteId ? 'vault.saved' : 'vault.created');
    } catch (e) { setError(errorKey(e)); }
  };

  const removeNote = async (id: string) => {
    try { await api.deleteNote(id); await refresh(); setMode({ view: 'list' }); showToast('vault.deleted'); }
    catch (e) { setError(errorKey(e)); }
  };

  const headerRow = (title: string, right?: React.ReactNode) => (
    <View style={styles.header}>
      <Pressable
        // 노트/편집 → 목록, 목록 → 대화목록(웹은 스택 헤더가 없어 목록에서도 뒤로 필요)
        onPress={() => (mode.view === 'list' ? navigation.goBack() : setMode({ view: 'list' } as Mode))}
        testID={mode.view === 'list' ? 'vault-home-back' : 'vault-back'}
        style={styles.backButton} accessibilityRole="button" accessibilityLabel={t('common.back')}>
        <Text style={styles.backIcon}>{t('common.backIcon')}</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );

  // ── 노트 상세 ──
  if (mode.view === 'note') {
    if (!current) return (
      <SafeAreaView style={styles.container}>
        {headerRow(t('vault.title'))}
        <View style={styles.center}><ActivityIndicator color={colors.accent} testID="vault-note-missing" /></View>
      </SafeAreaView>
    );
    return (
      <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
        {headerRow(current.title, (
          <View style={styles.headerRight}>
            <Pressable onPress={() => { setDraft({ title: current.title, content: current.content, folder: current.folder, tags: (current.tags ?? []).join(', ') }); setMode({ view: 'edit', noteId: current.id }); }} testID="vault-edit" style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('vault.edit')}>
              <Text style={styles.headerAction}>{t('vault.edit')}</Text>
            </Pressable>
            <Pressable onPress={() => void removeNote(current.id)} testID="vault-delete" style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('vault.delete')}>
              <Text style={styles.dangerText}>{t('vault.delete')}</Text>
            </Pressable>
          </View>
        ))}
        <ScrollView contentContainerStyle={styles.noteScroll} testID="vault-note">
          <View style={styles.noteMeta}>
            <Text style={styles.metaText}>{current.folder}</Text>
            {(current.tags ?? []).map((tg) => (
              <Pressable key={tg} onPress={() => { setTag(tg); setMode({ view: 'list' }); }} testID={`vault-tag-${tg}`} style={styles.tagChip}>
                <Text style={styles.tagChipText}>#{tg}</Text>
              </Pressable>
            ))}
          </View>
          <MarkdownView content={current.content} onNoteLink={openNoteLink} />
          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>{t('vault.backlinks')}</Text>
          {backlinks.length === 0
            ? <Text style={styles.emptyText}>{t('vault.noBacklinks')}</Text>
            : backlinks.map((b) => (
              <Pressable key={b.id} onPress={() => setMode({ view: 'note', noteId: b.id })} testID={`vault-backlink-${b.id}`} style={styles.backlinkRow}>
                <Text style={styles.linkText}>{b.title}</Text>
              </Pressable>
            ))}
          {current.source_message_id && (
            <Pressable onPress={() => navigation.navigate('Chat', { sessionId: current.source_session_id })} testID="vault-open-source" style={styles.backlinkRow}>
              <Text style={styles.linkText}>{t('vault.openSourceChat')}</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 편집 (마크다운 원문 — WYSIWYG 아님) ──
  if (mode.view === 'edit') {
    return (
      <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
        {headerRow(t('vault.edit'))}
        <View style={styles.editor} testID="vault-editor">
          <TextInput
            style={styles.editorTitle} placeholder={t('vault.untitled')} placeholderTextColor={colors.text3}
            value={draft?.title ?? ''} onChangeText={(v) => setDraft((d) => (d ? { ...d, title: v } : d))} testID="vault-title-input"
          />
          <TextInput
            style={styles.editorBody} multiline placeholder={t('vault.editorHint')} placeholderTextColor={colors.text3}
            value={draft?.content ?? ''} onChangeText={(v) => setDraft((d) => (d ? { ...d, content: v } : d))} testID="vault-content-input"
          />
          <View style={styles.editorRow}>
            <TextInput style={[styles.editorMeta, { flex: 2 }]} value={draft?.folder ?? ''} onChangeText={(v) => setDraft((d) => (d ? { ...d, folder: v } : d))} placeholder={t('vault.folder')} placeholderTextColor={colors.text3} testID="vault-folder-input" />
            <TextInput style={[styles.editorMeta, { flex: 1 }]} value={draft?.tags ?? ''} onChangeText={(v) => setDraft((d) => (d ? { ...d, tags: v } : d))} placeholder={t('vault.tagsPlaceholder')} placeholderTextColor={colors.text3} testID="vault-tags-input" />
          </View>
          <View style={styles.editorActions}>
            <Pressable onPress={() => { setDraft(null); setMode({ view: 'list' }); }} testID="vault-cancel" style={styles.cancelButton}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable onPress={() => void saveDraft()} testID="vault-save" style={[styles.saveButton, { opacity: draft?.title.trim() ? 1 : 0.5 }]} disabled={!draft?.title.trim()}>
              <Text style={styles.saveText}>{t('vault.save')}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── 목록 (폴더 레일 + 검색 + 노트) ──
  return (
    <SafeAreaView style={[styles.container, webScreenMotion('mat-slide-from-right')]}>
      {headerRow(t('vault.title'), (
        <Pressable onPress={() => startCreate()} testID="vault-new" style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('vault.new')}>
          <Text style={styles.headerAction}>{t('vault.new')}</Text>
        </Pressable>
      ))}
      {error && <Pressable style={styles.errorBar} onPress={() => void refresh()} testID="vault-retry"><Text style={styles.errorText}>{t(error)}</Text></Pressable>}
      {toast && <Text style={styles.toast} testID="vault-toast">{t(toast)}</Text>}
      <TextInput
        style={styles.search} placeholder={t('vault.search')} placeholderTextColor={colors.text3}
        value={query} onChangeText={onQuery} testID="vault-search"
      />
      <View style={styles.bodyRow}>
        {/* 웹: 좌측 폴더 패널 / 모바일: 폴더+태그 칩 레일 (같은 데이터, Layout 갈래) */}
        <View style={styles.folderRail}>
          <ScrollView contentContainerStyle={Platform.OS === 'web' ? styles.folderRailWeb : styles.folderRailNative} testID="vault-folders">
            <Pressable onPress={() => { setFolder(null); setTag(null); }} testID="vault-folder-all" style={[styles.folderItem, !folder && styles.folderActive]}>
              <Text style={[styles.folderText, !folder && styles.folderTextActive]}>{t('vault.allNotes')}</Text>
            </Pressable>
            {flatFolders.map((f) => (
              <Pressable key={f.path} onPress={() => setFolder(f.path === '/' ? null : f.path)} testID={`vault-folder-${f.path}`}
                style={[styles.folderItem, folder === f.path && styles.folderActive, f.depth > 0 && { paddingLeft: spacing.sp2 + f.depth * spacing.sp3 }]}>
                <Text style={[styles.folderText, folder === f.path && styles.folderTextActive]} numberOfLines={1}>{f.name} · {f.note_count}</Text>
              </Pressable>
            ))}
            {allTags.length > 0 && <Text style={styles.sectionLabel}>{t('vault.tags')}</Text>}
            <View style={styles.tagWrap}>
              {allTags.map((tg) => (
                <Pressable key={tg} onPress={() => setTag(tag === tg ? null : tg)} testID={`vault-chip-${tg}`} style={[styles.tagChip, tag === tg && styles.tagChipActive]}>
                  <Text style={[styles.tagChipText, tag === tg && { color: colors.onPrimary }]}>#{tg}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
        <View style={styles.noteColumn}>
          {loading ? <ActivityIndicator color={colors.accent} style={styles.center} /> : hits ? (
            <FlatList data={hits} keyExtractor={(h) => h.id} contentContainerStyle={styles.listContent} testID="vault-results"
              renderItem={({ item }) => (
                <Pressable onPress={() => setMode({ view: 'note', noteId: item.id })} testID={`vault-hit-${item.id}`} style={styles.noteCard}>
                  <Text style={styles.noteTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.noteSnippet} numberOfLines={2}>{item.snippet}</Text>
                </Pressable>
              )}
            />
          ) : (
            <FlatList data={filtered} keyExtractor={(n) => n.id} contentContainerStyle={styles.listContent} testID="vault-list"
              ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t('vault.empty')}</Text><Text style={styles.emptySub}>{t('vault.emptyHint')}</Text></View>}
              renderItem={({ item }) => (
                <Pressable onPress={() => setMode({ view: 'note', noteId: item.id })} testID={`vault-note-${item.id}`} style={styles.noteCard}>
                  <Text style={styles.noteTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.notePreview} numberOfLines={2}>{item.content.replace(/^---[\s\S]*?---\s*/, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2$1').slice(0, 140)}</Text>
                  <View style={styles.noteMeta}>
                    <Text style={styles.metaText}>{item.folder}</Text>
                    {(item.tags ?? []).slice(0, 3).map((tg) => <Text key={tg} style={styles.metaText}>#{tg}</Text>)}
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  headerTitle: { ...typography.title2, color: colors.text1, flex: 1, minWidth: 0 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2 },
  headerButton: { paddingHorizontal: spacing.sp2, paddingVertical: spacing.sp1 },
  headerAction: { ...typography.subhead, color: colors.accent },
  backButton: { paddingHorizontal: spacing.sp1, paddingVertical: spacing.sp1 },
  backIcon: { ...typography.title2, color: colors.text1 },
  errorBar: { backgroundColor: colors.surfaceRaise, padding: spacing.sp2 },
  errorText: { ...typography.caption, color: colors.statusErr, textAlign: 'center' },
  toast: { ...typography.caption, color: colors.statusOk, textAlign: 'center', paddingVertical: spacing.sp1 },
  search: { ...typography.body, color: colors.text1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, marginHorizontal: spacing.sp3, marginTop: spacing.sp2, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2 },
  bodyRow: { flex: 1, flexDirection: Platform.OS === 'web' ? 'row' : 'column' },
  // 웹: 좌측 150px 폴더 패널 / 모바일: 위 가로 칩 레일 (같은 데이터, Layout 갈래)
  folderRail: { width: Platform.OS === 'web' ? 150 : 'auto', borderRightWidth: Platform.OS === 'web' ? 1 : 0, borderRightColor: colors.border },
  folderRailWeb: { paddingVertical: spacing.sp2 },
  folderRailNative: { flexDirection: 'row', gap: spacing.sp1, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, alignItems: 'center' },
  folderItem: { paddingVertical: spacing.sp1, paddingHorizontal: spacing.sp3, borderRadius: radii.sm, marginHorizontal: spacing.sp2, minHeight: 20 },
  folderActive: { backgroundColor: colors.accentTint },
  folderText: { ...typography.subhead, color: colors.text2 },
  folderTextActive: { color: colors.accent, fontWeight: '600' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp1, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp1 },
  tagChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.full, paddingHorizontal: spacing.sp2, paddingVertical: 2, backgroundColor: colors.surface },
  tagChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tagChipText: { ...typography.micro, color: colors.text2 },
  noteColumn: { flex: 1, minWidth: 0 },
  listContent: { padding: spacing.sp3, gap: spacing.sp2, flexGrow: 1 },
  noteCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.sp3, marginBottom: spacing.sp2 },
  noteTitle: { ...typography.headline, color: colors.text1 },
  notePreview: { ...typography.body, color: colors.text2, marginTop: spacing.sp1 },
  noteSnippet: { ...typography.caption, color: colors.text2, marginTop: spacing.sp1 },
  noteMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sp2, marginTop: spacing.sp1 },
  metaText: { ...typography.micro, color: colors.text3 },
  empty: { alignItems: 'center', paddingTop: spacing.sp10, gap: spacing.sp2 },
  emptyText: { ...typography.body, color: colors.text2 },
  emptySub: { ...typography.caption, color: colors.text3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noteScroll: { padding: spacing.sp4, gap: spacing.sp1 },
  sectionLabel: { ...typography.micro, color: colors.text3, marginTop: spacing.sp3, textTransform: 'uppercase' },
  divider: { height: 1, backgroundColor: colors.border, marginTop: spacing.sp4 },
  backlinkRow: { paddingVertical: spacing.sp2 },
  linkText: { ...typography.body, color: colors.accent },
  editor: { flex: 1, padding: spacing.sp3, gap: spacing.sp2 },
  editorTitle: { ...typography.title2, color: colors.text1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2 },
  editorBody: { ...typography.body, color: colors.text1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.sp3, minHeight: 240, textAlignVertical: 'top', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 },
  editorRow: { flexDirection: 'row', gap: spacing.sp2 },
  editorMeta: { ...typography.caption, color: colors.text2, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sp2 },
  cancelButton: { padding: spacing.sp2 },
  cancelText: { ...typography.subhead, color: colors.text2 },
  saveButton: { backgroundColor: colors.accent, borderRadius: radii.md, paddingHorizontal: spacing.sp5, paddingVertical: spacing.sp2 },
  saveText: { ...typography.bodyBold, color: colors.onPrimary },
  dangerText: { ...typography.subhead, color: colors.statusErr },
});
