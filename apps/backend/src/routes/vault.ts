/**
 * /api/vault — 사용자별 옵시디언식 노트 볼트 (마이그레이션 004, t_3b38c9be)
 *
 * 소유권 모델: 모든 행은 user_id 직접 소유. requireAuth 후 라우트 수준에서
 * user_id 필터를 명시하며(002 확립 패턴), 타 사용자 노트는 존재 자체를 404로 숨긴다.
 * RLS(vault_notes_self_read)는 직접 DB 접근 경로에 대한 2차 방어다.
 *
 * 검색은 MVP: 사용자 자신의 노트만 로드해 서버측 대소문자 무시 부분 문자열 필터
 * (title/content, Postgres ILIKE 동등). pg_trgm 인덱스 최적화는 후속 과제.
 */
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok, ApiError, ERROR_CODES, badRequest } from '../lib/errors';
import { selectAllRows, getOwnedMessage } from '../lib/helpers';
import { normalizeFolder, messageToNote } from '../lib/recordTransform';
import { DbClient } from '../lib/supabase';
import { VaultNotesRow, VaultTreeNode } from '../types/db';

/** 내 노트 전체 로드 (소유권 필터 필수) */
async function listUserNotes(db: DbClient, userId: string): Promise<VaultNotesRow[]> {
  return (await selectAllRows(db, 'vault_notes', { user_id: userId })) as VaultNotesRow[];
}

/** 노트 소유권 확인 — 타 사용자/없는 노트는 모두 404 */
async function getOwnedNote(db: DbClient, userId: string, noteId: string): Promise<VaultNotesRow> {
  const { data, error } = await db.from('vault_notes').select('*')
    .eq('id', noteId).eq('user_id', userId).maybeSingle();
  if (error || !data) throw new ApiError(ERROR_CODES.NOT_FOUND, '노트를 찾을 수 없습니다.', { note_id: noteId });
  return data as VaultNotesRow;
}

/** 요청 body에서 노트 필드 검증/추출 */
function pickNoteFields(body: unknown, partial: boolean) {
  const b = (body ?? {}) as { title?: unknown; content?: unknown; folder?: unknown; tags?: unknown; backlinks?: unknown };
  const out: Record<string, unknown> = {};
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || !b.title.trim()) throw badRequest('title은 비어 있지 않은 문자열이어야 합니다.');
    if (b.title.length > 500) throw badRequest('title은 500자를 초과할 수 없습니다.');
    out.title = b.title.trim();
  }
  if (b.content !== undefined) {
    if (typeof b.content !== 'string') throw badRequest('content는 문자열(마크다운)이어야 합니다.');
    out.content = b.content;
  }
  if (b.folder !== undefined) out.folder = normalizeFolder(b.folder);
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.some(t => typeof t !== 'string')) throw badRequest('tags는 문자열 배열이어야 합니다.');
    out.tags = Array.from(new Set(b.tags.map(t => t.trim()).filter(Boolean))).slice(0, 50);
  }
  if (b.backlinks !== undefined) {
    if (!Array.isArray(b.backlinks)) throw badRequest('backlinks는 배열이어야 합니다.');
    out.backlinks = b.backlinks;
  }
  if (!partial && out.title === undefined) throw badRequest('title은 필수입니다.');
  return out;
}

/** 폴더 경로 목록에서 옵시디언식 트리 구성 — note_count는 해당 폴더 직속 노트 수 */
export function buildFolderTree(folders: string[]): VaultTreeNode {
  const root: VaultTreeNode = { name: '/', path: '/', note_count: 0, children: [] };
  const byPath = new Map<string, VaultTreeNode>([['/', root]]);
  const ensure = (path: string): VaultTreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const parentPath = path.slice(0, path.lastIndexOf('/')) || '/';
    const node: VaultTreeNode = { name: path.slice(path.lastIndexOf('/') + 1) || '/', path, note_count: 0, children: [] };
    byPath.set(path, node);
    ensure(parentPath).children.push(node);
    return node;
  };
  const sorted = Array.from(new Set(folders.map(f => normalizeFolder(f)))).sort();
  for (const folder of sorted) {
    // 폴더 자체와 모든 조상을 트리에 등록 (중간 폴더가 비어 있어도 경로 유지)
    const parts = folder.split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      ensure(acc);
    }
  }
  const sortChildren = (node: VaultTreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortChildren);
  };
  sortChildren(root);
  return root;
}

export async function vaultRoutes(app: FastifyInstance) {
  // GET /api/vault/notes?folder=&tag=&limit=&offset= — 내 노트 목록 (updated_at 내림차순)
  app.get('/notes', { preHandler: requireAuth }, async (request) => {
    const { folder, tag, limit: limitRaw, offset: offsetRaw } = request.query as { folder?: string; tag?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(parseInt(limitRaw || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(offsetRaw || '0', 10) || 0, 0);
    let notes = await listUserNotes(request.db, request.userId);
    if (folder) {
      const wanted = normalizeFolder(folder);
      notes = notes.filter(n => normalizeFolder(n.folder) === wanted);
    }
    if (tag) notes = notes.filter(n => (n.tags || []).includes(tag));
    notes.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const total = notes.length;
    const page = notes.slice(offset, offset + limit);
    return ok(page, { total, has_more: offset + page.length < total });
  });

  // POST /api/vault/notes — 노트 생성
  app.post('/notes', { preHandler: requireAuth }, async (request, reply) => {
    const fields = pickNoteFields(request.body, false);
    const { data, error } = await request.db.from('vault_notes').insert({
      user_id: request.userId,
      title: fields.title,
      content: fields.content ?? '',
      folder: fields.folder ?? '/',
      tags: fields.tags ?? [],
      backlinks: fields.backlinks ?? [],
      source_session_id: null,
      source_message_id: null,
    }).select().single();
    if (error || !data) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '노트 생성 실패', { detail: error?.message });
    return reply.status(201).send(ok(data));
  });

  // GET /api/vault/tree — 폴더 트리 (노트 수 포함)
  app.get('/tree', { preHandler: requireAuth }, async (request) => {
    const notes = await listUserNotes(request.db, request.userId);
    const tree = buildFolderTree(notes.map(n => n.folder));
    for (const note of notes) {
      const path = normalizeFolder(note.folder);
      const walk = (node: VaultTreeNode): VaultTreeNode | null => {
        if (node.path === path) return node;
        for (const child of node.children) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      const target = walk(tree);
      if (target) target.note_count += 1;
    }
    return ok({ tree, note_total: notes.length });
  });

  // GET /api/vault/search?q=&folder= — title/content 대소문자 무시 부분 검색 (MVP)
  app.get('/search', { preHandler: requireAuth }, async (request) => {
    const { q, folder, limit: limitRaw } = request.query as { q?: string; folder?: string; limit?: string };
    if (!q || !q.trim()) throw badRequest('검색어(q)는 필수입니다.');
    const limit = Math.min(Math.max(parseInt(limitRaw || '50', 10) || 50, 1), 200);
    const needle = q.trim().toLowerCase();
    let notes = await listUserNotes(request.db, request.userId);
    if (folder) {
      const wanted = normalizeFolder(folder);
      notes = notes.filter(n => normalizeFolder(n.folder) === wanted);
    }
    const hits = notes
      .filter(n => (n.title || '').toLowerCase().includes(needle) || (n.content || '').toLowerCase().includes(needle))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, limit)
      .map(n => {
        const idx = (n.content || '').toLowerCase().indexOf(needle);
        const snippet = idx >= 0
          ? `${n.content.slice(Math.max(0, idx - 60), idx + needle.length + 60)}`
          : (n.content || '').slice(0, 120);
        return { id: n.id, title: n.title, folder: n.folder, tags: n.tags, snippet, updated_at: n.updated_at };
      });
    return ok(hits, { total: hits.length });
  });

  // POST /api/vault/notes/from-message — 대화 메시지를 마크다운 노트로 변환 저장
  app.post('/notes/from-message', { preHandler: requireAuth }, async (request, reply) => {
    const body = (request.body ?? {}) as { message_id?: unknown; title?: string; folder?: string; tags?: string[] };
    if (typeof body.message_id !== 'string' || !body.message_id.trim()) throw badRequest('message_id는 필수입니다.');
    // 소유권 검증: 내 세션의 메시지가 아니면 404 (존재 숨김)
    const { message, session } = await getOwnedMessage(request.db, request.userId, body.message_id.trim());
    const { data: agent } = await request.db.from('agents').select('name').eq('id', session.agent_id).maybeSingle();
    const note = messageToNote({ message, session, agentName: (agent as { name?: string } | null)?.name });
    const fields = pickNoteFields({ title: body.title, folder: body.folder ?? note.folder, tags: body.tags ?? note.tags }, true);
    const { data, error } = await request.db.from('vault_notes').insert({
      user_id: request.userId,
      title: fields.title ?? note.title,
      content: note.content,
      folder: fields.folder ?? note.folder,
      tags: fields.tags ?? note.tags,
      backlinks: [],
      source_session_id: session.id,
      source_message_id: message.id,
    }).select().single();
    if (error || !data) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '노트 저장 실패', { detail: error?.message });
    return reply.status(201).send(ok(data));
  });

  // GET /api/vault/notes/:id — 노트 상세 (from-message보다 뒤에서 등록: 정적 경로 우선)
  app.get('/notes/:id', { preHandler: requireAuth }, async (request) => {
    const note = await getOwnedNote(request.db, request.userId, (request.params as { id: string }).id);
    return ok(note);
  });

  // PATCH /api/vault/notes/:id — 부분 수정 (title/content/folder/tags/backlinks)
  app.patch('/notes/:id', { preHandler: requireAuth }, async (request) => {
    const note = await getOwnedNote(request.db, request.userId, (request.params as { id: string }).id);
    const fields = pickNoteFields(request.body, true);
    if (!Object.keys(fields).length) return ok(note);
    const { data, error } = await request.db.from('vault_notes').update(fields)
      .eq('id', note.id).eq('user_id', request.userId).select().single();
    if (error || !data) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '노트 수정 실패', { detail: error?.message });
    return ok(data);
  });

  // DELETE /api/vault/notes/:id — 노트 삭제
  app.delete('/notes/:id', { preHandler: requireAuth }, async (request) => {
    const note = await getOwnedNote(request.db, request.userId, (request.params as { id: string }).id);
    const { error } = await request.db.from('vault_notes').delete()
      .eq('id', note.id).eq('user_id', request.userId);
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '노트 삭제 실패', { detail: error.message });
    return ok({ deleted: true, id: note.id });
  });
}
