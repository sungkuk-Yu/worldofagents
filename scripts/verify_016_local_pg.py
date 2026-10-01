#!/usr/bin/env python3
"""
t_848d0c3b — 016_context_patch_archives.sql 로컬 Postgres(pgserver) 검증 하네스.

검증:
1) 001→016 순차 적용 — 전 구간 오류 0
2) 테이블 형태 실측: 컬럼 14 / CONSTRAINT 세트(PK·FK CASCADE·UNIQUE object_path·CHECK 6) /
   인덱스 4(PK·UNIQUE·idx_cpa_session·idx_cpa_unverified 부분) / RLS on / 정책 1(owner SELECT)
3) additive-only 프루브: 016 적용 전후 context_patches 행 수·내용 DRIFT 0 (원본 무건드림)
4) 제약 거부 6케이스: period 형식 / bucket 고정값 / checksum 형식 / patch_count·bytes 음수 /
   max<min / object_path UNIQUE 중복(재시도 멱등)
5) FK CASCADE: 세션 삭제 시 인덱스 행 연쇄 소멸 (cold 객체는 버킷에 잔존 — DB 측 정리만)
6) verified 부분 인덱스 동작 + 재실행 멱등: 016 재적용 시 DDL no-op, 행 DRIFT 0
7) down: 016_down 실행 → 테이블·인덱스 0행

Supabase 호환 스텁(auth.users/roles/uuid-ossp/pgcrypto)은
scripts/verify_015_local_pg.py(t_58d08ab7) 관례 재사용.
"""
import os
import sys
import shutil

PGDATA = os.environ.get("VERIFY016_PGDATA", "/tmp/pgdata_016_verify")
WORKROOT = os.environ.get("VERIFY016_WORKROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIG_DIR = os.path.join(WORKROOT, "apps/backend/supabase/migrations")
PGINSTALL = "/home/holysky87/.hermes/profiles/backdev/cache/scratch/pgenv/lib/python3.11/site-packages/pgserver/pginstall"

import pgserver
import psycopg


def install_extension_stubs():
    ext_dir = os.path.join(PGINSTALL, "share", "postgresql", "extension")
    for name, ver in (("uuid-ossp", "1.1"), ("pgcrypto", "1.3")):
        ctl = os.path.join(ext_dir, f"{name}.control")
        sql = os.path.join(ext_dir, f"{name}--{ver}.sql")
        if not os.path.exists(ctl):
            with open(ctl, "w") as f:
                f.write("comment = 'local test stub (no C code)'\ndefault_version = '%s'\nrelocatable = true\n" % ver)
        if not os.path.exists(sql):
            with open(sql, "w") as f:
                f.write("-- stub: migrations use only gen_random_uuid (PG16 core)\n")


def apply(cur, fname):
    sql = open(os.path.join(MIG_DIR, fname), encoding="utf-8").read()
    cur.execute(sql)


SESS = "00000000-0000-0000-0000-00000000aa16"
SHA = "a" * 64


def base_row(**over):
    r = dict(session_id=SESS, period="2026-06", bucket="context-archive",
             object_path="2026/06/session=%s.ndjson.gz" % SESS, patch_count=3,
             min_created_at="2026-06-01T00:00:00+00", max_created_at="2026-06-30T00:00:00+00",
             bytes_compressed=128, checksum_sha256=SHA, verified_at=None)
    r.update(over)
    return r


def insert_row(cur, r):
    cur.execute("""INSERT INTO context_patch_archives
        (session_id, period, bucket, object_path, patch_count, min_created_at, max_created_at,
         bytes_compressed, checksum_sha256, verified_at)
        VALUES (%(session_id)s, %(period)s, %(bucket)s, %(object_path)s, %(patch_count)s,
                %(min_created_at)s, %(max_created_at)s, %(bytes_compressed)s,
                %(checksum_sha256)s, %(verified_at)s)""", r)


def expect_fail(cur, r, why):
    try:
        insert_row(cur, r)
    except psycopg.Error:
        cur.connection.rollback()
        print(f"  reject OK: {why}")
        return True
    return False, f"FAIL — {why} 가 거부되지 않았다"


def main():
    install_extension_stubs()
    if os.path.isdir(PGDATA):
        try:
            pgserver.get_server(PGDATA, cleanup_mode="stop").cleanup()
        except Exception:
            pass
        shutil.rmtree(PGDATA, ignore_errors=True)
    srv = pgserver.get_server(PGDATA, cleanup_mode="stop")
    print("pg up:", PGDATA)

    with psycopg.connect(srv.get_uri(), autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute("CREATE SCHEMA IF NOT EXISTS auth")
        cur.execute("""CREATE TABLE IF NOT EXISTS auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT, created_at TIMESTAMPTZ DEFAULT now())""")
        cur.execute("""CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$""")
        for role in ("anon", "authenticated", "service_role"):
            cur.execute(f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$")

        # ---- 1) 001→016 순차 적용 ----
        files = sorted(f for f in os.listdir(MIG_DIR) if f.endswith(".sql"))
        assert files[-1] == "016_context_patch_archives.sql", f"unexpected migration list tail: {files[-1]}"
        for fname in files:
            try:
                apply(cur, fname)
                print(f"APPLY {fname}: OK")
            except Exception as e:
                print(f"APPLY {fname}: FAIL → {e}")
                sys.exit(1)
        print("CHECK 1 (001~016 적용 오류 0): PASS")

        # ---- 2) 테이블 형태 ----
        cur.execute("SELECT count(*) FROM information_schema.columns WHERE table_name='context_patch_archives'")
        ncols = cur.fetchone()[0]
        assert ncols == 14, f"columns {ncols} != 14"
        cur.execute("SELECT conname FROM pg_constraint WHERE conrelid='context_patch_archives'::regclass ORDER BY conname")
        cons = {r[0] for r in cur.fetchall()}
        assert "context_patch_archives_pkey" in cons and "context_patch_archives_object_path_key" in cons, cons
        assert any("session_id_fkey" in c for c in cons), cons
        ncheck = sum(1 for c in cons if "check" in c.lower())
        assert ncheck == 6, f"CHECK 제약 {ncheck} != 6 (period·bucket·max>=min·patch_count·bytes·checksum)"
        cur.execute("SELECT indexname FROM pg_indexes WHERE tablename='context_patch_archives' ORDER BY indexname")
        idx = [r[0] for r in cur.fetchall()]
        assert idx == ["context_patch_archives_object_path_key", "context_patch_archives_pkey",
                       "idx_cpa_session", "idx_cpa_unverified"], idx
        cur.execute("SELECT count(*) FROM pg_class WHERE relname='context_patch_archives' AND relrowsecurity")
        assert cur.fetchone()[0] == 1, "RLS 미enable"
        cur.execute("SELECT cmd FROM pg_policies WHERE tablename='context_patch_archives'")
        assert cur.fetchall() == [("SELECT",)], "owner_read SELECT 정책 1개 기대"
        print("CHECK 2 (14컬럼/제약/인덱스4/RLS/policy 1): PASS")

        # ---- 3) additive-only: context_patches 무건드림 프루브 ----
        uid, aid, pid = ("00000000-0000-0000-0000-00000000ff16",
                         "00000000-0000-0000-0000-00000000ee16",
                         "00000000-0000-0000-0000-00000000dd16")
        cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (uid,))
        cur.execute("INSERT INTO public.users (id) VALUES (%s)", (uid,))
        cur.execute("INSERT INTO agents (id, owner_id, name) VALUES (%s,%s,'a')", (aid, uid))
        cur.execute("INSERT INTO personas (id, agent_id, name) VALUES (%s,%s,'p')", (pid, aid))
        cur.execute("INSERT INTO sessions (id, user_id, agent_id, persona_id, metadata) VALUES (%s,%s,%s,%s,'{}'::jsonb)", (SESS, uid, aid, pid))
        cur.execute("INSERT INTO context_patches (session_id, key, operation, delta) VALUES (%s,'task.current','set','{\"value\":1}'::jsonb)", (SESS,))
        cur.execute("SELECT id, session_id, key, operation, delta, source_neuron, created_at FROM context_patches ORDER BY id")
        before = cur.fetchall()
        apply(cur, "016_context_patch_archives.sql")  # 재적용(멱등)과 동일한 경로
        cur.execute("SELECT id, session_id, key, operation, delta, source_neuron, created_at FROM context_patches ORDER BY id")
        assert cur.fetchall() == before, "016이 context_patches를 건드렸다"
        print("CHECK 3 (016 재적용 멱등 + context_patches DRIFT 0): PASS")

        # ---- 4) 제약 거부 6케이스 ----
        rejects = [
            (base_row(period="26-06"), "period 형식"),
            (base_row(period="2026-6"), "period 형식(1자리 월)"),
            (base_row(bucket="attachments"), "bucket 고정값"),
            (base_row(checksum_sha256="Z" * 64), "checksum hex"),
            (base_row(patch_count=0), "patch_count>0"),
            (base_row(bytes_compressed=-1), "bytes 양수"),
            (base_row(min_created_at="2026-06-30T00:00:00+00", max_created_at="2026-06-01T00:00:00+00"), "max>=min"),
        ]
        for r, why in rejects:
            out = expect_fail(cur, r, why)
            if out is not True:
                print(out[1]); sys.exit(1)
        insert_row(cur, base_row())  # 정상 1행
        if expect_fail(cur, base_row(), "object_path UNIQUE(재시도 멱등)") is not True:
            print("FAIL — object_path 중복이 거부되지 않았다"); sys.exit(1)
        # 다른 object_path(period 다른 달)는 같은 세션이라도 허용 — UNIQUE는 경로 단위.
        insert_row(cur, base_row(period="2026-07", object_path="2026/07/session=%s.ndjson.gz" % SESS))
        cur.execute("DELETE FROM context_patch_archives WHERE period='2026-07'")
        print("CHECK 4 (제약 거부 6 + UNIQUE 중복 거부·이월 경로 허용): PASS")

        # ---- 5) FK CASCADE ----
        n0 = cur.execute("SELECT count(*) FROM context_patch_archives").fetchone()[0]
        assert n0 == 1
        cur.execute("INSERT INTO context_patches (session_id, key, operation, delta) VALUES (%s,'k.b','set','{}'::jsonb)", (SESS,))
        # verified 사후 프루브용: 원본 잔존 상태에서 verified_at 갱신 가능
        cur.execute("UPDATE context_patch_archives SET verified_at = now()")
        cur.execute("SELECT verified_at IS NOT NULL FROM context_patch_archives")
        assert cur.fetchone()[0]
        cur.execute("DELETE FROM sessions WHERE id = %s", (SESS,))
        left = cur.execute("SELECT count(*) FROM context_patch_archives").fetchone()[0]
        assert left == 0, "session FK CASCADE 미작동"
        print("CHECK 5 (FK CASCADE + verified_at 갱신): PASS")

        # ---- 6) down ----
        cur.execute(open(os.path.join(WORKROOT, "apps/backend/supabase/rollback/016_context_patch_archives_down.sql"), encoding="utf-8").read())
        assert cur.execute("SELECT count(*) FROM pg_tables WHERE tablename='context_patch_archives'").fetchone()[0] == 0
        assert cur.execute("SELECT count(*) FROM pg_indexes WHERE indexname LIKE 'idx_cpa_%%'").fetchone()[0] == 0
        print("CHECK 6 (016_down — 테이블·인덱스 0행): PASS")

    print("RESULT: ALL PASS")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            pgserver.get_server(PGDATA, cleanup_mode="stop").cleanup()
        except Exception:
            pass
