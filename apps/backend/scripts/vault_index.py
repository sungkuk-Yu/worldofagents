#!/usr/bin/env python3
"""
볼트 도서관 인덱서 — BM25(SQLite FTS5 trigram) + 다국어 임베딩 (t_d469fac3)

대표님 9/30 "볼트를 도서관처럼 서버에 저장하고 검색하게 하면 토큰 90% 절감" 실행 1단계.
154노트/1.2MB 규모의 공용 옵시디언 볼트(OBSIDIAN_VAULT_PATH)를 로컬 CPU로 인덱싱한다.
API 비용 0원 — faster-whisper 사이드카(t_1c7be18c)와 같은 박스·같은 venv·같은 ONNX/CPU int8 방식.

산출물: ~/.hermes/vault-index/vault.db (sqlite, 전체 수 MB 미만)
  files(path, hash, mtime, date, title)   — sha256 파일 해시로 증분 판단
  chunks(id, path, seq, heading, text)    — ~700자 마크다운 청크
  fts(FTS5 trigram)                        — 한국어 3자 부분일치 BM25 (통째 읽기 금지의 대체)
  vec(chunk_id, blob)                      — int8 양자화 384차원 임베딩 (multilingual-e5-small ONNX quantized)

형식:
  vault_index.py build            전체 재구축 (신규 시/강제 갱신)
  vault_index.py update           hash 변경분만 재임베딩 (일 1회 cron/타이머)
  -> stdout JSON {new, changed, deleted, unchanged, chunks, files, seconds, db_bytes}
     + ~/.hermes/vault-index/update.log 에 신규/변경 노트 목록 1줄 append

주의:
  - 모델 파일: ~/.hermes/vault-index/model-e5/{onnx/model_quantized.onnx, tokenizer.json}(선행 다운로드, HF 오프라인 안전)
  - 읽기 전용: 볼트를 절대 수정하지 않는다.
"""
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata

VAULT = os.environ.get("OBSIDIAN_VAULT_PATH", os.path.expanduser("~/.hermes/obsidian-vault"))
INDEX_DIR = os.environ.get("VAULT_INDEX_DIR", os.path.expanduser("~/.hermes/vault-index"))
DB_PATH = os.path.join(INDEX_DIR, "vault.db")
MODEL_DIR = os.environ.get("VAULT_EMBED_MODEL_DIR", os.path.join(INDEX_DIR, "model-e5"))
LOG_PATH = os.path.join(INDEX_DIR, "update.log")

CHUNK_CHARS = 700
CHUNK_OVERLAP = 80
DATE_RE = re.compile(r"^(20\d{2}-\d{2}-\d{2})")
FRONTMATTER_DATE_RE = re.compile(r"^(?:#*\s*)?(?:날짜|date)\s*[:：]\s*(20\d{2}-\d{2}-\d{2})", re.M | re.I)

import numpy as np  # noqa: E402  (위 상수들과 순서 무관)

_session = None
_tokenizer = None


def _np():
    return np


def load_embedder():
    global _session, _tokenizer
    if _session is not None:
        return
    import onnxruntime as ort
    from tokenizers import Tokenizer

    # e5-small quantized int8 (t_d469fac3 실측: 1,261청크 24.7초, 회귀 5쿼리 ALL PASS).
    # MiniLM-L12는 250k vocab pretokenizer로 10배 느리고 한국어 유사도가 무너져 교체.
    for fname in ("model_quantized.onnx", "model_int8.onnx", "model.onnx"):
        p = os.path.join(MODEL_DIR, "onnx", fname)
        if os.path.exists(p):
            break
    else:
        raise SystemExit(f"임베딩 모델 없음: {MODEL_DIR}/onnx/ 를 먼저 다운로드하세요 (README-설계 노트 참조)")
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = int(os.environ.get("VAULT_EMBED_THREADS", "8"))
    _session = ort.InferenceSession(p, providers=["CPUExecutionProvider"], sess_options=opts)
    _tokenizer = Tokenizer.from_file(os.path.join(MODEL_DIR, "tokenizer.json"))
    _tokenizer.enable_truncation(max_length=256)
    _tokenizer.enable_padding(pad_id=1, pad_token="[PAD]")


def embed(texts, kind="passage"):
    """mean-pool + L2-normalize float32. e5는 query/passage 프리픽스 필수 (쿼리 'query: ', 문서 'passage: ')."""
    load_embedder()
    prefix = "query: " if kind == "query" else "passage: "
    encs = _tokenizer.encode_batch([prefix + t for t in texts])
    ids = np.array([e.ids for e in encs], dtype=np.int64)
    mask = np.array([e.attention_mask for e in encs], dtype=np.int64)
    typ = np.array([e.type_ids for e in encs], dtype=np.int64)
    hs = _session.run(None, {"input_ids": ids, "attention_mask": mask, "token_type_ids": typ})[0]
    m = mask[:, :, None].astype(np.float32)
    pooled = (hs.astype(np.float32) * m).sum(1) / np.clip(m.sum(1), 1e-9, None)
    pooled = pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-9, None)
    return pooled.astype(np.float32)


def quantize_int8(vectors):
    """단위벡터 int8 양자화 (부호 보존 스케일 127) — DB 절 half size."""
    q = np.clip(np.round(vectors * 127.0), -127, 127).astype(np.int8)
    return q


def dequantize_blob(blob):
    return np.frombuffer(blob, dtype=np.int8).astype(np.float32) / 127.0


def iter_vault_files():
    for root, _dirs, files in os.walk(VAULT):
        for fn in sorted(files):
            if fn.endswith(".md") and not fn.startswith("."):
                yield os.path.join(root, fn)


def file_meta(path):
    text = read_text(path)
    rel = os.path.relpath(path, VAULT)
    m = DATE_RE.match(os.path.basename(rel)) or FRONTMATTER_DATE_RE.search(text[:2000])
    date = m.group(1) if m else ""
    if not date:
        date = time.strftime("%Y-%m-%d", time.localtime(os.stat(path).st_mtime))
    title = os.path.basename(rel)[:-3]
    return rel, date, title, text


def read_text(path):
    try:
        return unicodedata.normalize("NFC", open(path, encoding="utf-8", errors="ignore").read())
    except Exception:
        return ""


def split_chunks(text, title):
    """헤딩 경계 우선 라인 버퍼 청킹 — 반환: [(heading, chunk_text)].

    라인 단위 슬라이스+중복은 세션로그류(짧은 줄 수천 개)에서 청크가 ~120자로 파편화돼
    BM25 문서통계를 붕괴시키고 재임베딩 비용을 폭증시킨다 (t_d469fac3 실측: 69KB→8,203청크).
    줄을 CHUNK_CHARS까지 채우다가 헤딩에서 잘라 평균 청크 크기를 유지한다.
    """
    if not text.strip():
        return []
    chunks = []
    heading = title
    buf = []
    buf_len = 0

    def flush():
        nonlocal buf, buf_len
        if buf:
            body = "\n".join(buf).strip()
            if body:
                head = f"# {title}\n## {heading}\n" if heading != title else f"# {title}\n"
                chunks.append((heading, head + body))
            buf, buf_len = [], 0

    for ln in text.splitlines():
        m = re.match(r"^#{1,4}\s+", ln)
        if m:
            flush()
            heading = ln.strip().lstrip("#").strip() or title
            continue
        if not ln.strip():
            continue
        buf.append(ln)
        buf_len += len(ln) + 1
        while buf_len >= CHUNK_CHARS:  # 긴 단일 줄이어도 최소 1줄은 보존 후 절단
            part = "\n".join(buf)
            head = f"# {title}\n## {heading}\n" if heading != title else f"# {title}\n"
            chunks.append((heading, head + part[:CHUNK_CHARS].strip()))
            rest = part[CHUNK_CHARS:]
            buf = [rest] if rest.strip() else []
            buf_len = sum(len(b) + 1 for b in buf)
    flush()
    if not chunks:
        chunks = [(title, f"# {title}\n" + text.strip()[:CHUNK_CHARS])]
    return chunks


def open_db(create=False):
    os.makedirs(INDEX_DIR, exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.execute("PRAGMA journal_mode=WAL")
    if create:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, hash TEXT, mtime REAL, date TEXT, title TEXT);
            CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, path TEXT, seq INTEGER, heading TEXT, text TEXT);
            CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
            CREATE TABLE IF NOT EXISTS vec(chunk_id INTEGER PRIMARY KEY, v BLOB);
            CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, content=chunks, content_rowid=id, tokenize='trigram');
            """
        )
        c.commit()
    return c


def drop_file(c, rel):
    rows = c.execute("SELECT id FROM chunks WHERE path=?", (rel,)).fetchall()
    for (cid,) in rows:
        c.execute("INSERT INTO fts(fts, rowid, text) VALUES('delete', ?, (SELECT text FROM chunks WHERE id=?))", (cid, cid))
        c.execute("DELETE FROM vec WHERE chunk_id=?", (cid,))
    c.execute("DELETE FROM chunks WHERE path=?", (rel,))
    c.execute("DELETE FROM files WHERE path=?", (rel,))


def index_file(c, path, force):
    """hash 비교 증분. 반환: 'new'|'changed'|'unchanged'"""
    import hashlib

    text = read_text(path)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    rel, date, title, _ = file_meta(path)
    row = c.execute("SELECT hash FROM files WHERE path=?", (rel,)).fetchone()
    if row and row[0] == digest and not force:
        return "unchanged"
    drop_file(c, rel)
    c.execute(
        "INSERT INTO files(path, hash, mtime, date, title) VALUES(?,?,?,?,?)",
        (rel, digest, os.stat(path).st_mtime, date, title),
    )
    chunks = split_chunks(text, title)
    vectors = []
    for i in range(0, len(chunks), 8):
        batch = chunks[i : i + 8]
        vectors.extend(embed([t for _h, t in batch]))
    for seq, (heading, chunk_text) in enumerate(chunks):
        cur = c.execute(
            "INSERT INTO chunks(path, seq, heading, text) VALUES(?,?,?,?)", (rel, seq, heading, chunk_text)
        )
        c.execute("INSERT INTO fts(rowid, text) VALUES(?,?)", (cur.lastrowid, chunk_text))
        c.execute("INSERT INTO vec(chunk_id, v) VALUES(?,?)", (cur.lastrowid, quantize_int8(np.array([vectors[seq]]))[0].tobytes()))
    return ("new" if not row else "changed"), rel, len(chunks)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "update"
    assert mode in ("build", "update"), "usage: vault_index.py build|update"
    t0 = time.monotonic()
    force = mode == "build"
    if force and os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        for ext in ("-wal", "-shm"):
            p = DB_PATH + ext
            if os.path.exists(p):
                os.remove(p)
    c = open_db(create=True)
    counts = {"new": 0, "changed": 0, "deleted": 0, "unchanged": 0}
    touched = []
    seen = set()
    for path in iter_vault_files():
        result = index_file(c, path, force)
        if isinstance(result, str):
            seen.add(os.path.relpath(path, VAULT))
            counts["unchanged"] += 1
            continue
        status, rel, nchunks = result
        seen.add(rel)
        counts[status] += 1
        touched.append(f"{rel}({nchunks}c)")
        print(f"  {status}: {rel} — {nchunks} chunks", file=sys.stderr)
    # 삭제된 파일 정리
    for (rel,) in c.execute("SELECT path FROM files").fetchall():
        if rel not in seen:
            drop_file(c, rel)
            counts["deleted"] += 1
            touched.append(f"-{rel}")
            print(f"  deleted: {rel}", file=sys.stderr)
    total_chunks = c.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    c.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('built_at',?)", (time.strftime("%Y-%m-%dT%H:%M:%S"),))
    c.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('version',?)", (str(int(time.time())),))
    c.commit()
    c.execute("VACUUM")
    c.close()
    db_bytes = os.path.getsize(DB_PATH)
    seconds = round(time.monotonic() - t0, 1)
    summary = {**counts, "chunks": total_chunks, "files": counts["new"] + counts["changed"] + counts["unchanged"], "seconds": seconds, "db_bytes": db_bytes}
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {mode} new={counts['new']} changed={counts['changed']} deleted={counts['deleted']} unchanged={counts['unchanged']} chunks={total_chunks} {seconds}s"
    if touched:
        line += " touched=" + ",".join(touched[:40]) + ("..." if len(touched) > 40 else "")
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
