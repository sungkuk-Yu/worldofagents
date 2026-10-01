#!/usr/bin/env python3
"""
t_58d08ab7 — 015_seed_baseline.sql 로컬 Postgres(pgserver) 검증 하네스.

검증:
1) 001~015 순차 적용 — 전 구간 오류 0
2) 카탈로그 실측: neurons 5종(core 4+translation custom, active) / skills 공식 4종 published
3) 세션 백필: title NULL + turn_index=1 user 메시지 보유 → 요약 백필 / metadata.title 보유
   세션 불변 / user 메시지 없는 NULL 세션 불변 / 기존 title 불변 / 빈 제목 무시 / 50자 규칙
4) 재실행 멱등: 015 재적용 시 INSERT 0·UPDATE 0·기존 값 DRIFT 0
5) 수렴 환경 no-op: 006·010만 적용된 DB에 015 얹으면 행 수·값 변화 0 (D1 잔여 0 실증)

Supabase 호환 스텁(auth.users/roles/uuid-ossp/pgcrypto)은
scripts/verify_migrations_local_pg.py(t_cc52fd4f) 관례 재사용.
"""
import os
import sys
import shutil

PGDATA = os.environ.get("VERIFY015_PGDATA", "/tmp/pgdata_015_verify")
# t_848d0c3b 하네스 수정: script 위치 기준 자기 워크트리(하드코딩 t_58d08ab7 이식성 결함 —
# 그 worktree가 정리되면 하네스가 죽는다). 환경변수로 덮어쓰기 가능.
WORKROOT = os.environ.get("VERIFY015_WORKROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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


def snap(cur, table, cols):
    cur.execute(f"SELECT {cols} FROM {table} ORDER BY 1")
    return cur.fetchall()


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

    ok = True
    with psycopg.connect(srv.get_uri(), autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute("CREATE SCHEMA IF NOT EXISTS auth")
        cur.execute("""CREATE TABLE IF NOT EXISTS auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT, created_at TIMESTAMPTZ DEFAULT now())""")
        cur.execute("""CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$""")
        # GRANT 검증용 supabase 역할 스텁 (014 하네스 관례 — pgserver에는 없는 NOLOGIN 역할)
        for role in ('anon', 'authenticated', 'service_role'):
            cur.execute(f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$")

        # ---- 1) 001→015 순차 적용 ----
        # t_848d0c3b 갱신: 번호 필터 — 016 이후 파일이 추가돼도 본 하네스 범위는 001~015 고정.
        files = sorted(f for f in os.listdir(MIG_DIR) if f.endswith(".sql") and f[:3] <= "015")
        assert files[-1] == "015_seed_baseline.sql", f"unexpected migration list tail: {files[-1]}"
        for fname in files:
            try:
                apply(cur, fname)
                print(f"APPLY {fname}: OK")
            except Exception as e:
                print(f"APPLY {fname}: FAIL → {e}")
                sys.exit(1)
        print("CHECK 1 (001~015 적용 오류 0): PASS")

        # ---- 2) 카탈로그 실측 ----
        cur.execute("SELECT slug, category, status FROM neurons ORDER BY slug")
        neurons = cur.fetchall()
        expect_n = {("answer", "core", "active"), ("empathy", "core", "active"), ("queue", "core", "active"),
                    ("translation", "custom", "active"), ("visual", "core", "active")}
        assert set(neurons) == expect_n, f"neurons mismatch: {neurons}"
        cur.execute("SELECT slug, status, author_name, COALESCE(author_id::text,'NULL') FROM skills ORDER BY slug")
        skills = cur.fetchall()
        expect_s = {("calendar-sync", "published", "agenttalk-official", "NULL"),
                    ("data-analysis", "published", "agenttalk-official", "NULL"),
                    ("email-assistant", "published", "agenttalk-official", "NULL"),
                    ("translation-neuron", "published", "agenttalk-official", "NULL")}
        assert set(skills) == expect_s, f"skills mismatch: {skills}"
        print("CHECK 2 (neurons 5 active / skills 공식 4 published·author_id NULL): PASS")

        # ---- 3) 백필 fixtures (015 §3b) ----
        def mkuser(i):
            uid = f"00000000-0000-0000-0000-0000000000f{i}"
            cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (uid,))
            cur.execute("INSERT INTO public.users (id) VALUES (%s)", (uid,))
            cur.execute("INSERT INTO public.agents (id, owner_id, name) VALUES (%s, %s, 'a')",
                        (f"00000000-0000-0000-0000-00000000e00{i}", uid))
            cur.execute("INSERT INTO public.personas (id, agent_id, name) VALUES (%s, %s, 'p')",
                        (f"00000000-0000-0000-0000-00000000d00{i}", f"00000000-0000-0000-0000-00000000e00{i}"))
            return uid, f"00000000-0000-0000-0000-00000000e00{i}", f"00000000-0000-0000-0000-00000000d00{i}"

        def mksess(sid, uid, aid, pid, metadata):
            cur.execute("INSERT INTO public.sessions (id, user_id, agent_id, persona_id, metadata) VALUES (%s,%s,%s,%s,%s::jsonb)",
                        (sid, uid, aid, pid, metadata))

        def mkmsg(mid, sid, role, turn, content):
            cur.execute("""INSERT INTO public.messages (id, session_id, role, turn_index, content, dialogue_type)
                           VALUES (%s,%s,%s,%s,%s,'text')""", (mid, sid, role, turn, content))

        u1, a1, p1 = mkuser(1)   # 첫 user 메시지 있음 → 백필
        mksess("00000000-0000-0000-0000-00000000a101", u1, a1, p1, "{}")
        mkmsg("00000000-0000-0000-0000-00000000b101", "00000000-0000-0000-0000-00000000a101", "agent", 0, "안녕하세요!")
        mkmsg("00000000-0000-0000-0000-00000000b102", "00000000-0000-0000-0000-00000000a101", "user", 1, "오늘 회의 일정을 정리해줘\n추가 요청")

        u2, a2, p2 = mkuser(2)   # metadata.title 있음 → 불변
        mksess("00000000-0000-0000-0000-00000000a102", u2, a2, p2, '{"title":"기존 제목"}')
        mkmsg("00000000-0000-0000-0000-00000000b103", "00000000-0000-0000-0000-00000000a102", "user", 1, "사용자 첫 발화")

        u3, a3, p3 = mkuser(3)   # user 메시지 없음 → NULL 불변 (실DB NULL 20세션과 동일 형태)
        mksess("00000000-0000-0000-0000-00000000a103", u3, a3, p3, "{}")
        mkmsg("00000000-0000-0000-0000-00000000b104", "00000000-0000-0000-0000-00000000a103", "agent", 0, " 에이전트 인사만 존재")

        u4, a4, p4 = mkuser(4)   # 50자 초과 → left(49)+…
        mksess("00000000-0000-0000-0000-00000000a104", u4, a4, p4, "{}")
        long = "가" * 60
        mkmsg("00000000-0000-0000-0000-00000000b105", "00000000-0000-0000-0000-00000000a104", "user", 1, long)

        u5, a5, p5 = mkuser(5)   # 빈 사용자 첫 발화 → NULL 불변
        mksess("00000000-0000-0000-0000-00000000a105", u5, a5, p5, "{}")
        mkmsg("00000000-0000-0000-0000-00000000b106", "00000000-0000-0000-0000-00000000a105", "user", 1, "   \n  ")

        u6, a6, p6 = mkuser(6)   # 기존 title 있음 → 불변
        mksess("00000000-0000-0000-0000-00000000a106", u6, a6, p6, "{}")
        cur.execute("UPDATE sessions SET title='수동 제목' WHERE id='00000000-0000-0000-0000-00000000a106'")
        mkmsg("00000000-0000-0000-0000-00000000b107", "00000000-0000-0000-0000-00000000a106", "user", 1, "두 번째 발화")

        apply(cur, "015_seed_baseline.sql")  # 백필 구간 재실행 (1차 적용 시엔 세션 없음 → 0행)
        cur.execute("SELECT id, title FROM public.sessions ORDER BY id")
        titles = {str(r[0])[-4:]: r[1] for r in cur.fetchall()}
        assert titles["a101"] == "오늘 회의 일정을 정리해줘", f"a101: {titles['a101']!r}"          # 첫 줄만
        assert titles["a102"] == "기존 제목", f"a102: {titles['a102']!r}"                          # metadata 우선
        assert titles["a103"] is None, f"a103: {titles['a103']!r}"                                 # user 없음 → NULL
        assert titles["a104"] == "가" * 49 + "…", f"a104: {titles['a104']!r}"                      # 50자 규칙
        assert titles["a105"] is None, f"a105: {titles['a105']!r}"                                 # 빈 제목 무시
        assert titles["a106"] == "수동 제목", f"a106: {titles['a106']!r}"                          # 기존 불변
        print("CHECK 3 (백필 6 케이스: 첫줄/metadata우선/NULL불변/50자/빈제목/기존불변): PASS")

        # ---- 4) 재실행 멱등 ----
        n_before = snap(cur, "neurons", "slug, name, status")
        s_before = snap(cur, "skills", "slug, name, status, author_name")
        t_before = snap(cur, "sessions", "id, title")
        apply(cur, "015_seed_baseline.sql")
        assert snap(cur, "neurons", "slug, name, status") == n_before, "neurons drift"
        assert snap(cur, "skills", "slug, name, status, author_name") == s_before, "skills drift"
        assert snap(cur, "sessions", "id, title") == t_before, "sessions.title drift"
        print("CHECK 4 (015 재적용 멱등 — 행 수·값 DRIFT 0): PASS")

        # ---- 5) 수렴 환경 no-op 실증: 기존 행 보호(사용자 전환 시나리오) ----
        cur.execute("UPDATE neurons SET status='deprecated' WHERE slug='queue'")
        cur.execute("INSERT INTO skills (name, slug, description, category, author_name, status)\n"
                    " VALUES ('내 커스텀 스킬', 'my-skill', 'x', 'general', 'user1', 'draft')")
        apply(cur, "015_seed_baseline.sql")
        cur.execute("SELECT status FROM neurons WHERE slug='queue'")
        assert cur.fetchone()[0] == "deprecated", "015가 사용자 status 전환을 덮어썼다"
        cur.execute("SELECT count(*) FROM skills")
        assert cur.fetchone()[0] == 5, "015가 불필요 행을 추가했다"
        print("CHECK 5 (수렴/사용자 변경 환경 — DO NOTHING 보장, 덮어쓰기 0): PASS")

    print("RESULT: ALL PASS")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            pgserver.get_server(PGDATA, cleanup_mode="stop").cleanup()
        except Exception:
            pass
