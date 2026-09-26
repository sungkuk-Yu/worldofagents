/**
 * 볼트(노트) 순수 로직 — Wave 2 (t_174b66d2)
 * 옵시디언식 [[wikilink]] 파싱/변환과 백링크 계산. UI 의존 없는 순수 함수 모듈.
 *
 * 렌더 전략 (카드 본문 지시): react-native-markdown-display가 마크다운을 그림 —
 * [[제목]] / [[제목|별칭]]을 내장 링크 문법으로 치환하고 URL 스킴을 mat-note:로 표시한다.
 * 마크다운 뷰어는 onLinkPress에서 해당 스킴을 잡아 노트 이동으로 전환하고,
 * http(s) 링크만 Linking으로 연다. 백엔드는 content를 원문 보존하므로(해석은 프론트),
 * 원문 수정 없이 이 변환은 렌더 직전에만 적용한다.
 * sanitize: react-native-markdown-display 기본 MarkdownIt은 html:false — raw HTML이
 * 태그로 해석되지 않고 텍스트로 나온다(법률 카드 지적 사항과 동일 원칙).
 */

export const NOTE_LINK_SCHEME = 'mat-note:';

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

/** ```울타리로 분할 — 홀수 인덱스 조각이 코드블록. 닫히지 않은 ```는 끝까지 코드블록. */
interface FenceSegment { code: boolean; body: string }
function splitFences(text: string): FenceSegment[] {
  const parts = text.split(/```[^\n`]*\n?/);
  const out: FenceSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) out.push({ code: i % 2 === 1, body: parts[i] });
  }
  return out;
}

/** [[타깃]] 또는 [[타깃|별칭]]을 mat-note: 링크로 치환 (코드블록 내 원문은 건드리지 않음). */
export function toRenderableMarkdown(content: string): string {
  if (!content || !content.includes('[[')) return content ?? '';
  return splitFences(content)
    .map((seg) => (seg.code
      ? seg.body
      : seg.body.replace(WIKILINK_RE, (_m, target: string, alias?: string) => {
          const label = (alias ?? target).trim();
          const href = `${NOTE_LINK_SCHEME}${encodeURIComponent(target.trim())}`;
          return `[${label}](${href})`;
        })))
    .join('');
}

/** 본문의 [[wikilink]] 타깃 제목 목록 (중복 제거, 코드블록 제외, 대소문자 원본 유지). */
export function extractWikilinks(content: string): string[] {
  const out: string[] = [];
  if (!content) return out;
  for (const seg of splitFences(content)) {
    if (seg.code) continue;
    for (const m of seg.body.matchAll(WIKILINK_RE)) {
      const target = m[1].trim();
      if (target && !out.includes(target)) out.push(target);
    }
  }
  return out;
}

/** 링크 URL이 노트 링크면 타깃 제목 복원, 아니면 null. */
export function parseNoteLink(url: string | undefined | null): { title: string } | null {
  if (!url || !url.startsWith(NOTE_LINK_SCHEME)) return null;
  try {
    const title = decodeURIComponent(url.slice(NOTE_LINK_SCHEME.length));
    return title ? { title } : null;
  } catch { return null; }
}

export interface NoteRef { id: string; title: string; content?: string }

/**
 * 백링크 계산 — references 노트들을 훑어 target을 [[wikilink]]로 참조하는 노트 목록.
 * 자기 자신은 제외, title 비교는 trim+소문자 정규화(옵시디언 제목 매칭 관례).
 */
export interface NoteLinkRef { id: string; title: string }
export function computeBacklinks(target: NoteRef, references: NoteRef[]): NoteLinkRef[] {
  const needle = target.title.trim().toLowerCase();
  const out: NoteLinkRef[] = [];
  for (const note of references) {
    if (note.id === target.id) continue;
    if (extractWikilinks(note.content ?? '').some((t) => t.trim().toLowerCase() === needle)) {
      out.push({ id: note.id, title: note.title });
    }
  }
  return out;
}

/** 제목으로 노트 찾기 (wikilink 탭 해석용) — trim+소문자 매칭, 없으면 null. */
export function findNoteByTitle<T extends { title: string }>(notes: T[], title: string): T | null {
  const needle = title.trim().toLowerCase();
  return notes.find((n) => n.title.trim().toLowerCase() === needle) ?? null;
}

export interface FolderNodeLite { name: string; path: string; note_count: number; children?: FolderNodeLite[] }

/** 재귀 트리를 depth-first 평면화 (웹 사이드바/모바일 드로어 공통 목록 렌더). */
export interface FlatFolder { name: string; path: string; note_count: number; depth: number }
export function flattenFolderTree(tree: FolderNodeLite, depth = 0): FlatFolder[] {
  const out: FlatFolder[] = [];
  const walk = (node: FolderNodeLite, d: number) => {
    out.push({ name: node.name, path: node.path, note_count: node.note_count, depth: d });
    for (const child of node.children ?? []) walk(child, d + 1);
  };
  walk(tree, depth);
  return out;
}

/** 새 노트 폴더 제안 — 현재 선택 폴더 유지, 루트면 '/대화' 대신 '/노트'. */
export function defaultFolderForNewNote(current: string | null | undefined): string {
  const folder = (current ?? '').trim();
  return folder && folder !== '/' ? folder : '/노트';
}
