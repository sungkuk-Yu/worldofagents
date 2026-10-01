#!/usr/bin/env python3
"""t_58d08ab7 — 실DB read-only 감사 (SELECT 전용, 쓰기/DDL 0건).

목적: 015 작성 전 실Supabase(fppcohttpulkqwzapmff) 카탈로그/스키마 잔여분 확정.
원칙: PostgREST GET만. range 헤더로 페이지네이션, 상한 밖이면 truncated 보고.
"""
import os, sys, json, urllib.request, urllib.error

ENV = "/home/holysky87/worldofagents/apps/backend/.env"
BASE = "https://fppcohttpulkqwzapmff.supabase.co/rest/v1"

def load_env(path):
    kv = {}
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            kv[k.strip()] = v.strip().strip('"').strip("'")
    return kv

def get(key, table, select, order=None, limit=1000):
    url = f"{BASE}/{table}?select={select}"
    if order: url += f"&order={order}"
    req = urllib.request.Request(url, headers={
        "apikey": key, "Authorization": f"Bearer {key}",
        "Range-Unit": "items", "Range": f"0-{limit-1}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read().decode())
            cr = r.headers.get("Content-Range", "")
            return body, cr, None
    except urllib.error.HTTPError as e:
        return None, "", f"HTTP {e.code}: {e.read().decode()[:200]}"
    except Exception as e:
        return None, "", f"ERR: {e}"

def main():
    env = load_env(ENV)
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    out = {}

    # 1) neurons 현재 카탈로그
    rows, cr, err = get(key, "neurons", "slug,name,category,status,author,always_active", order="slug")
    out["neurons"] = {"err": err, "content_range": cr, "rows": rows}

    # 2) skills 현재 카탈로그
    rows, cr, err = get(key, "skills", "slug,name,status,author_name,category", order="slug")
    out["skills"] = {"err": err, "content_range": cr, "rows": rows}

    # 3) sessions.title 잔여 (NULL + 첫 user 메시지 보유 여부)
    rows, cr, err = get(key, "sessions", "id,title,metadata", order="id")
    out["sessions"] = {"err": err, "content_range": cr,
                       "total": len(rows) if rows else None,
                       "title_null": sum(1 for r in (rows or []) if not r.get("title")),
                       "meta_title": sum(1 for r in (rows or []) if (r.get("metadata") or {}).get("title")),
                       "sample_null": [ (str(r["id"])[:8], (r.get("metadata") or {}).get("title")) for r in (rows or []) if not r.get("title")][:10] }

    # 4) messages: 제목 NULL 세션 중 첫 user 메시지 보유 확인용 — 본문(content)은 개인정보 최소노출 원칙으로 미수집,
    #    어느 세션에 user 메시지가 "있는지"만 필요하므로 role/turn_index로 충분.
    rows, cr, err = get(key, "messages", "session_id,role,turn_index", order="session_id,turn_index", limit=5000)
    if rows is not None:
        out["messages"] = {"err": err, "content_range": cr, "count": len(rows), "truncated": len(rows) >= 5000,
                           "sessions_with_user_msg": sorted({r["session_id"] for r in rows if r.get("role") == "user"})}
    else:
        out["messages"] = {"err": err}

    # 5) 마이그레이션 기록 테이블 (PostgREST 노출 여부 프루브)
    rows, cr, err = get(key, "supabase_migrations.schema_migrations", "version,name")
    out["schema_migrations"] = {"err": err, "rows": rows}

    # 6) context_patches 상태 (콜드 아카이브 설계 015 근거 — 행 수/최신 시점)
    req = urllib.request.Request(f"{BASE}/context_patches?select=id", headers={
        "apikey": key, "Authorization": f"Bearer {key}",
        "Range-Unit": "items", "Range": "0-0",
        "Prefer": "count=exact", "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            out["context_patches_count"] = r.headers.get("Content-Range", "")
    except Exception as e:
        out["context_patches_count"] = f"ERR {e}"

    print(json.dumps(out, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
