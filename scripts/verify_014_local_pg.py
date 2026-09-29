#!/usr/bin/env python3
"""
t_7182aa8f — 마이그레이션 014(graph_runs/graph_checkpoints/graph_checkpoint_writes)
로컬 pgserver 검증 하네스. 001→014 순차 적용 → 스키마 실측 → CRUD/멱등/CASCADE →
롤백(014_down) 역방향 적용. Supabase 스텁(auth.users/auth.uid())은
scripts/verify_migrations_local_pg.py 관례 재사용.
"""
import os, sys, shutil

PGDATA = os.environ.get("VERIFY014_PGDATA", "/tmp/pgdata_014_verify")
PGINSTALL = "/home/holysky87/.hermes/profiles/backdev/cache/scratch/pgenv/lib/python3.11/site-packages/pgserver/pginstall"
MIG_DIR = os.environ.get("VERIFY014_MIG_DIR", "/home/holysky87/worldofagents/apps/backend/supabase/migrations")
ROLLBACK = os.path.join(os.path.dirname(MIG_DIR), "rollback", "014_run_checkpoint_down.sql")

import pgserver
import psycopg

def install_extension_stubs():
    ext_dir = os.path.join(PGINSTALL, "share", "postgresql", "extension")
    for name, ver in (("uuid-ossp", "1.1"), ("pgcrypto", "1.3")):
        ctl = os.path.join(ext_dir, f"{name}.control")
        sql = os.path.join(ext_dir, f"{name}--{ver}.sql")
        if not os.path.exists(ctl):
            with open(ctl, "w") as f:
                f.write(f"comment = 'local test stub (no C code)'\ndefault_version = '{ver}'\nrelocatable = true\n")
        if not os.path.exists(sql):
            with open(sql, "w") as f:
                f.write("-- stub: migrations use only gen_random_uuid (PG16 core)\n")

def q(cur, sql, params=None):
    if params is None:
        cur.execute(sql)
    else:
        cur.execute(sql, params)
    try:
        return cur.fetchall()
    except Exception:
        return None

def main():
    install_extension_stubs()
    if os.path.isdir(PGDATA):
        try:
            pgserver.get_server(PGDATA, cleanup_mode="stop").cleanup()
        except Exception:
            pass
        shutil.rmtree(PGDATA, ignore_errors=True)
    srv = pgserver.get_server(PGDATA, cleanup_mode="stop")
    print("pg up:", PGDATA, "migrations:", MIG_DIR)
    failures = []

    with psycopg.connect(srv.get_uri(), autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute("CREATE SCHEMA IF NOT EXISTS auth")
        cur.execute("""CREATE TABLE IF NOT EXISTS auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT, created_at TIMESTAMPTZ DEFAULT now())""")
        cur.execute("""CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$""")
        # GRANT 검증용 supabase 역할 스텁 (pgserver에는 없는 NOLOGIN 역할)
        for role in ('anon', 'authenticated', 'service_role'):
            cur.execute(f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$")

        # 1) 001→014 순차 적용
        files = sorted(f for f in os.listdir(MIG_DIR) if f.endswith(".sql"))
        for fname in files:
            sql = open(os.path.join(MIG_DIR, fname), encoding="utf-8").read()
            try:
                cur.execute(sql)
                print(f"APPLY {fname}: OK")
            except Exception as e:
                failures.append(f"apply {fname}: {e}")
                print(f"APPLY {fname}: FAIL → {e}")
        if failures:
            print("RESULT: FAILED (applies)", failures); sys.exit(1)
        assert "014_run_checkpoint.sql" in files, "014 파일 없음"

        # 2) 스키마 실측 (read-back 프루브 §5와 동일 쿼리)
        cols = dict(q(cur, """SELECT table_name, count(*) FROM information_schema.columns
            WHERE table_schema='public' AND table_name IN ('graph_runs','graph_checkpoints','graph_checkpoint_writes')
            GROUP BY table_name"""))
        print("columns:", cols)
        assert cols == {"graph_runs": 18, "graph_checkpoints": 10, "graph_checkpoint_writes": 9}, \
            f"컬럼 수 불일치: {cols} (기대 18/10/9 — 구현 컬럼 기준)"
        idx = {r[0] for r in q(cur, "SELECT indexname FROM pg_indexes WHERE tablename LIKE 'graph_%'")}
        print("indexes:", sorted(idx))
        for need in ("idx_graph_runs_open", "idx_graph_runs_session", "idx_graph_checkpoints_run_latest"):
            assert need in idx, f"인덱스 누락 {need}"
        cons = {r[0] for r in q(cur, """SELECT conname FROM pg_constraint
            WHERE conrelid IN ('graph_runs'::regclass,'graph_checkpoints'::regclass,'graph_checkpoint_writes'::regclass)""")}
        assert any("fk" in c.lower() or c.startswith("graph_checkpoint") for c in cons), f"FK 없음: {cons}"

        # 3) 실전 CRUD — saver가 쓰는 정확히 그 문형 (upsert onConflict 경로)
        uid = "00000000-0000-0000-0000-00000000f001"
        sid = "00000000-0000-0000-0000-00000000f101"
        rid = "00000000-0000-0000-0000-00000000f201"
        cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (uid,))
        cur.execute("INSERT INTO public.users (id) VALUES (%s)", (uid,))
        cur.execute("INSERT INTO public.agents (id, owner_id, name) VALUES (%s,%s,'a')",
                    ("00000000-0000-0000-0000-00000000f301", uid))
        cur.execute("INSERT INTO public.personas (id, agent_id, name) VALUES (%s,%s,'p')",
                    ("00000000-0000-0000-0000-00000000f401", "00000000-0000-0000-0000-00000000f301"))
        cur.execute("""INSERT INTO public.sessions (id, user_id, agent_id, persona_id, metadata)
                       VALUES (%s,%s,%s,%s,'{}')""", (sid, uid, "00000000-0000-0000-0000-00000000f301", "00000000-0000-0000-0000-00000000f401"))
        cur.execute("""INSERT INTO graph_runs (run_id, session_id, user_id, content, locale)
                       VALUES (%s,%s,%s,'테스트 발화','ko')""", (rid, sid, uid))
        # openRun 재실행 = insert 충돌 (재resume 시 중복 레시피 금지)
        try:
            cur.execute("""INSERT INTO graph_runs (run_id, session_id, user_id, content, locale)
                           VALUES (%s,%s,%s,'x','ko')""", (rid, sid, uid))
            failures.append("graph_runs PK 중복이 허용됨")
        except psycopg.errors.UniqueViolation:
            conn.rollback() if not conn.autocommit else None
        # put = upsert onConflict (run_id,checkpoint_ns,checkpoint_id)
        for i, cpid in enumerate(("1", "2")):
            cur.execute("""INSERT INTO graph_checkpoints (run_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, ts, type, checkpoint, metadata, step)
                           VALUES (%s,'',%s,%s,now()::text,'json',%s::jsonb,%s::jsonb,%s)
                           ON CONFLICT (run_id, checkpoint_ns, checkpoint_id) DO UPDATE
                           SET checkpoint = EXCLUDED.checkpoint""",
                        (rid, f"ck-{cpid}", f"ck-{i}", f'{{"channel_values": {{"n": {i}}}}}', f'{{"step": {i}}}', i))
        assert len(q(cur, "SELECT 1 FROM graph_checkpoints WHERE run_id=%s", (rid,))) == 2
        # putWrites = upsert onConflict 4-key — 동일 (task,idx) 재put 멱등
        for _ in range(2):
            cur.execute("""INSERT INTO graph_checkpoint_writes (run_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
                           VALUES (%s,'','ck-2','t1',0,'out','json','\"v\"')
                           ON CONFLICT (run_id, checkpoint_ns, checkpoint_id, task_id, idx) DO UPDATE SET value = EXCLUDED.value""", (rid,))
        assert len(q(cur, "SELECT 1 FROM graph_checkpoint_writes WHERE run_id=%s AND task_id='t1'", (rid,))) == 1, "writes 멱등 실패"
        # partial index 스캔 형태: 부팅 resume 쿼리
        rows = q(cur, "SELECT run_id FROM graph_runs WHERE status='running' ORDER BY created_at ASC LIMIT 10")
        assert len(rows) == 1
        cur.execute("UPDATE graph_runs SET status='completed' WHERE run_id=%s", (rid,))
        assert q(cur, "SELECT 1 FROM graph_runs WHERE status='running'") == []

        # 4) FK CASCADE: 세션 삭제 → runs → checkpoints/writes 연쇄 소멸
        cur.execute("DELETE FROM public.sessions WHERE id=%s", (sid,))
        assert q(cur, "SELECT 1 FROM graph_runs") == [] and q(cur, "SELECT 1 FROM graph_checkpoints") == [] \
            and q(cur, "SELECT 1 FROM graph_checkpoint_writes") == [], "CASCADE 파기 실패"
        print("CHECK 3/4 (CRUD·멱등·resume 스캔·CASCADE): PASS")

        # 4b) GRANT 실측 (003_favorites 관례 — 기본 권한 없음): anon/authenticated SELECT / service_role DML
        gr = {}
        for g in q(cur, """SELECT grantee::regrole::text, privilege_type FROM information_schema.role_table_grants
                       WHERE table_name='graph_runs'"""):
            gr.setdefault(g[0], set()).add(g[1])
        assert gr.get('anon') == {'SELECT'}, f"anon 권한 오류: {gr}"
        assert gr.get('authenticated') == {'SELECT'}, f"authenticated 권한 오류: {gr}"
        assert gr.get('service_role') == {'SELECT','INSERT','UPDATE','DELETE'}, f"service_role 권한 오류: {gr}"
        print("CHECK 4b (GRANT 3역할 실측): PASS")

        # 5) 롤백 스크립트 적용 → graph_% 0행
        cur.execute(open(ROLLBACK, encoding="utf-8").read())
        assert q(cur, "SELECT tablename FROM pg_tables WHERE tablename LIKE 'graph_%'") == []
        assert q(cur, "SELECT indexname FROM pg_indexes WHERE indexname LIKE 'graph_%'") == []
        # 롤백 멱등 (재실행 OK)
        cur.execute(open(ROLLBACK, encoding="utf-8").read())
        print("CHECK 5 (014_down 역방향·멱등): PASS")

    print("RESULT: 014 LOCAL VERIFY ALL PASS" if not failures else f"RESULT: FAIL {failures}")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
