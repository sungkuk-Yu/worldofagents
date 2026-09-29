#!/usr/bin/env python3
"""
볼트 도서관 사이드카 — BM25(FTS5 trigram)+임베딩 하이브리드 검색 (t_d469fac3)

대표님 9/30 "Spotify 도서관" 지시 실행. 1.2MB/156노트 공용 옵시디언 볼트를 로컬 CPU로
인덱싱하고, 에이전트들은 '통째 read' 대신 '쿼리→상위 청크만'을 받는다 (토큰 10~20배 절감).

STT 사이드카(t_1c7be18c)와 같은 박스·같은 venv·같은 패턴(FastAPI, 127.0.0.1 전용 루프).
추가 의존성 0개: fastapi/uvicorn/numpy/onnxruntime/tokenizers — hermes venv에 이미 존재.

형식:
  GET  /health   -> {ok, loaded, files, chunks, built_at}
  GET  /search?q=<쿼리>&k=3&mode=hybrid|bm25|vector
       -> {results: [{rank, score, path, title, heading, date, snippet, kind}], query, took_ms}
  POST /update   -> 증분 재인덱스 {new, changed, deleted, unchanged, seconds} (잠김 직렬화)

검색 계약(판단서 확정): k 기본 3, 스니펫 320자, hybrid = 가중 RRF(BM25 1.2 + 벡터 1.0, k=60).
BM25 질의는 공백 토큰별 trigram 구문 AND(2자 이하 토큰은 무시 — trigram 최소 길이).
출처는 볼트 상대경로 + 헤딩. 사용자 데이터(vault_notes DB)와 완전 격리 — 이 사이드카는
파일시스템 볼트만 읽기 전용으로 다룬다.

연결: 백엔드 VAULT_INDEX_URL(기본 http://127.0.0.1:9834) + VAULT_ADMIN 토큰 게이트.
systemd user: myagenttalk-vault-sidecar.service (기동 시 update 1회, 이후 timer 일 1회)
"""
import json
import os
import sqlite3
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vault_index as vi  # noqa: E402

import numpy as np  # noqa: E402
from fastapi import FastAPI, Query  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

HOST = os.environ.get("VAULT_SIDECAR_HOST", "127.0.0.1")
PORT = int(os.environ.get("VAULT_SIDECAR_PORT", "9834"))
SNIPPET_CHARS = 320
BM25_CANDIDATES = 24
RRF_K = 60  # reciprocal rank fusion 상수 — 점수 스케일 차이(minmax 함정) 없이 순순위만 융합
RRF_W_BM25 = 1.2
RRF_W_VEC = 1.0

app = FastAPI(title="vault-library-sidecar")
_lock = threading.Lock()  # update 직렬화 (빌드는 수 분, 동시 실행 금지)
_state = {"loaded": False, "note": "", "matrix": None, "ids": None, "built_at": ""}


def db():
    c = sqlite3.connect(vi.DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def refresh_vectors():
    """vec 테이블 전체를 (N,384) float32 행렬로 캐시 — 1.2MB 볼트 기준 N~수천, RAM 수 MB."""
    try:
        c = db()
        rows = c.execute("SELECT chunk_id, v FROM vec ORDER BY chunk_id").fetchall()
        c.close()
        if not rows:
            _state["matrix"] = None
            _state["ids"] = None
            return False
        _state["ids"] = np.array([r["chunk_id"] for r in rows], dtype=np.int64)
        _state["matrix"] = np.stack([vi.dequantize_blob(r["v"]) for r in rows])
        return True
    except Exception as e:
        _state["note"] = f"vec load failed: {e}"
        return False


def ensure_ready():
    if _state["loaded"]:
        return True
    if os.path.exists(vi.DB_PATH) and refresh_vectors():
        try:
            c = db()
            _state["built_at"] = c.execute("SELECT value FROM meta WHERE key='built_at'").fetchone()["value"]
            c.close()
        except Exception:
            pass
        _state["loaded"] = True
        return True
    return False


def run_update(mode="update"):
    """vault_index.py의 main()을 프로세스 내 호출 (stdout JSON 흡수)."""
    import io
    import contextlib

    if not _lock.acquire(blocking=False):
        return {"busy": True}
    try:
        old_argv = sys.argv
        sys.argv = ["vault_index.py", mode]
        buf = io.StringIO()
        err = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            vi.main()
        sys.argv = old_argv
        result = json.loads(buf.getvalue().strip().splitlines()[-1])
        _state["loaded"] = False
        if not ensure_ready():
            _state["note"] = "ready check failed after update"
        _state["loaded"] = True
        return result
    except Exception as e:
        _state["note"] = f"update failed: {e}"
        return {"error": str(e)}
    finally:
        _lock.release()


def bm25_phrase(q: str) -> str:
    """공백 구분 토큰 각각을 trigram 구문검색으로 AND 결합.

    통째 '"자비스 소개"' 구문은 띄어쓰기 포함 연속 trigram을 요구해 불리하다 —
    토큰 단위 AND('"자비스" AND "소개"')가 한국어 볼트에서 실질적 부분일치다.
    """
    toks = [t for t in q.replace('"', ' ').split() if len(t) >= 3]
    if not toks:
        toks = [t for t in q.replace('"', ' ').split() if t]
    return " AND ".join('"' + t.replace('"', '""') + '"' for t in toks[:8])


def hybrid_search(q: str, k: int, mode: str):
    t0 = time.monotonic()
    c = db()

    # ── BM25 (FTS5 trigram) ──
    bm25_ids = []
    if mode in ("hybrid", "bm25"):
        try:
            rows = c.execute(
                "SELECT rowid FROM fts WHERE fts MATCH ? ORDER BY bm25(fts) LIMIT ?",
                (bm25_phrase(q), BM25_CANDIDATES),
            ).fetchall()
            bm25_ids = [r["rowid"] for r in rows]
        except sqlite3.OperationalError:
            bm25_ids = []

    # ── 벡터 코사인 ──
    vec_ids = []
    vec_sims = {}
    if mode in ("hybrid", "vector") and _state["matrix"] is not None:
        qv = vi.embed([q], kind="query")[0]
        sims = _state["matrix"] @ qv
        top = np.argsort(-sims)[:BM25_CANDIDATES]
        vec_ids = [int(_state["ids"][i]) for i in top]
        vec_sims = {cid: float(max(sims[i], 0.0)) for cid, i in zip(vec_ids, top)}

    # ── 융합: bm25만 = 순순위, vector만 = 코사인, hybrid = 가중 RRF ──
    if mode == "bm25":
        ranked = [(cid, 1.0 / (RRF_K + r + 1)) for r, cid in enumerate(bm25_ids)]
    elif mode == "vector":
        ranked = [(cid, vec_sims[cid]) for cid in vec_ids]
    else:
        merged = {}
        for r, cid in enumerate(bm25_ids):
            merged[cid] = merged.get(cid, 0.0) + RRF_W_BM25 / (RRF_K + r + 1)
        for r, cid in enumerate(vec_ids):
            merged[cid] = merged.get(cid, 0.0) + RRF_W_VEC / (RRF_K + r + 1)
        ranked = sorted(merged.items(), key=lambda x: -x[1])

    out = []
    for rank, (cid, score) in enumerate(ranked[:k], 1):
        row = c.execute(
            "SELECT ch.path, ch.heading, ch.text, f.title, f.date FROM chunks ch JOIN files f ON f.path=ch.path WHERE ch.id=?",
            (cid,),
        ).fetchone()
        if not row:
            continue
        text = row["text"]
        out.append({
            "rank": rank,
            "score": round(float(score), 4),
            "path": row["path"],
            "title": row["title"],
            "heading": row["heading"],
            "date": row["date"],
            "snippet": text[:SNIPPET_CHARS],
            "kind": "vault",
        })
    c.close()
    return out, round((time.monotonic() - t0) * 1000, 1)


@app.get("/health")
def health():
    ready = ensure_ready()
    counts = {"files": 0, "chunks": 0}
    if ready:
        try:
            c = db()
            counts["files"] = c.execute("SELECT COUNT(*) n FROM files").fetchone()["n"]
            counts["chunks"] = c.execute("SELECT COUNT(*) n FROM chunks").fetchone()["n"]
            c.close()
        except Exception as e:
            _state["note"] = str(e)
    return {"ok": True, "loaded": ready, "built_at": _state["built_at"],
            "note": _state.get("note", ""), **counts}


@app.get("/search")
def search(q: str = Query(..., min_length=1, max_length=500),
           k: int = Query(3, ge=1, le=10),
           mode: str = Query("hybrid", pattern="^(hybrid|bm25|vector)$")):
    if not ensure_ready():
        return JSONResponse({"error": "INDEX_NOT_READY", "detail": _state.get("note", "run /update")}, status_code=503)
    results, took = hybrid_search(q.strip(), k, mode)
    return {"ok": True, "query": q.strip(), "mode": mode, "k": k, "took_ms": took, "results": results}


@app.post("/update")
def update(force: bool = Query(False)):
    result = run_update("build" if force else "update")
    return {"ok": "error" not in result, "mode": "build" if force else "update", "result": result}


if __name__ == "__main__":
    import uvicorn

    # 기동 시 1회 증분 (DB 없으면 전체 빌드) — 준비는 /health의 loaded로 확인
    if not os.path.exists(vi.DB_PATH):
        run_update("build")
    else:
        run_update("update")
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
