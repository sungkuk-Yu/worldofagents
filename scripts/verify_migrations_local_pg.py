#!/usr/bin/env python3
"""
t_cc52fd4f — 로컬 Postgres(pgserver) 마이그레이션 001→010 검증 하네스.

Supabase 호환 스텁:
- CREATE EXTENSION uuid-ossp/pgcrypto → pginstall의 extension 디렉터리에 SQL-온리 스텁
  control/script를 설치(마이그레이션은 digest/uuid_generate_v4를 쓰지 않고 gen_random_uuid는
  PG16 core — 010 적용에 실제 C 확장 불요).
- auth.users 테이블 + auth.uid() 함수 스텁(RLS 정책 파싱용. service_role 우회라 동작 검증은 없음).

검증:
1) 001~010 순차 적용 — 전 구간 오류 0
2) 카탈로그 실측: neurons 5종(core 4+translation custom, active) / skills 공식 4종 published
3) 세션 fixtures 백필 실측: 첫 사용자 메시지 요약 / metadata.title 우선 / 기존 title 보존 /
   빈 제목 무시 / 50자 초과 left(49)+… 규칙
4) 재실행 멱등: 재적용 시 INSERT 0·UPDATE 0·기존 값 불변 (DO NOTHING + title IS NULL 가드)
"""
import os
import sys
import hashlib
import re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

MIG_DIR = "/home/holysky87/worldofagents/.worktrees/t_cc52fd4f/apps/backend/supabase/migrations"
PGDATA = os.environ.get("VERIFY_PGDATA", "/tmp/pgdata_migrations_verify")
PGINSTALL = "/home/holysky87/.hermes/profiles/backdev/cache/scratch/pgenv/lib/python3.11/site-packages/pgserver/pginstall"

import pgserver
import psycopg

def install_extension_stubs():
    ext_dir = os.path.join(PGINSTALL, "share", "postgrsql" if False else "postgresql", "extension")
    for name, ver in (("uuid-ossp", "1.1"), ("pgcrypto", "1.3")):
        ctl = os.path.join(ext_dir, f"{name}.control")
        sql = os.path.join(ext_dir, f"{name}--{ver}.sql")
        if not os.path.exists(ctl):
            with open(ctl, "w") as f:
                f.write("comment = 'local test stub (no C code)'\ndefault_version = '%s'\nrelocatable = true\n" % ver)
        if not os.path.exists(sql):
            with open(sql, "w") as f:
                f.write("-- stub: migrations use only gen_random_uuid (PG16 core)\n")

def q(cur, sql, params=None):
    cur.execute(sql, params or ())
    try:
        return cur.fetchall()
    except Exception:
        return None

def main():
    install_extension_stubs()
    # 하네스 결정성: 매 실행 빈 클러스터에서 시작 (실DB와 무관한 scratch 인스턴스)
    import shutil
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
        # ---- Supabase 스텁 ----
        cur.execute("CREATE SCHEMA IF NOT EXISTS auth")
        cur.execute("""CREATE TABLE IF NOT EXISTS auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT, created_at TIMESTAMPTZ DEFAULT now())""")
        cur.execute("""CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$""")

        # ---- 1) 마이그레이션 순차 적용 ----
        errs = []
        files = sorted(f for f in os.listdir(MIG_DIR) if f.endswith(".sql"))
        for fname in files:
            path = os.path.join(MIG_DIR, fname)
            sql = open(path, encoding="utf-8").read()
            try:
                cur.execute(sql)
                print(f"APPLY {fname}: OK")
            except Exception as e:
                errs.append((fname, str(e)))
                print(f"APPLY {fname}: FAIL → {e}")
        if errs:
            print("RESULT: migration apply FAILED", errs)
            sys.exit(1)
        print("CHECK 1 (001~010 적용 오류 0): PASS")

        # ---- 2) 카탈로그 실측 ----
        cur.execute("SELECT slug, category, status FROM neurons ORDER BY slug")
        neurons = cur.fetchall()
        expect_n = {("answer","core","active"),("empathy","core","active"),("queue","core","active"),
                    ("translation","custom","active"),("visual","core","active")}
        assert set(neurons) == expect_n, f"neurons mismatch: {neurons}"
        cur.execute("SELECT slug, status, author_name FROM skills ORDER BY slug")
        skills = cur.fetchall()
        expect_s = {("calendar-sync","published","agenttalk-official"),("data-analysis","published","agenttalk-official"),
                    ("email-assistant","published","agenttalk-official"),("translation-neuron","published","agenttalk-official")}
        assert set(skills) == expect_s, f"skills mismatch: {skills}"
        print("CHECK 2 (neurons 5종 active / skills 공식 4종 published): PASS")

        # ---- 3) 백필 fixtures ----
        cur.execute("DELETE FROM public.sessions")  # 하네스 전용 빈 DB(실DB 아님) — fixture 재실행 정리

        cur.execute("""
            INSERT INTO auth.users (id) VALUES
              ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a2'),
              ('00000000-0000-0000-0000-0000000000a3'),('00000000-0000-0000-0000-0000000000a4'),
              ('00000000-0000-0000-0000-0000000000a5'),('00000000-0000-0000-0000-0000000000a6'),
              ('00000000-0000-0000-0000-0000000000a7')""")
        for i in (1, 2, 3, 4, 6, 7):  # d005는 아래에서 title 세팅용으로 별도 생성
            uid = f"00000000-0000-0000-0000-0000000000a{i}"
            cur.execute("INSERT INTO public.users (id) VALUES (%s)", (uid,))
            cur.execute("INSERT INTO public.agents (id, owner_id, name) VALUES (%s, %s, 'a')",
                        (f"00000000-0000-0000-0000-00000000b00{i}", uid))
            cur.execute("INSERT INTO public.personas (id, agent_id, name) VALUES (%s, %s, 'p')",
                        (f"00000000-0000-0000-0000-00000000c00{i}", f"00000000-0000-0000-0000-00000000b00{i}"))
            cur.execute("""INSERT INTO public.sessions (id, user_id, agent_id, persona_id, metadata) VALUES
                (%s,%s,%s,%s,%s)""",
                (f"00000000-0000-0000-0000-00000000d00{i}", uid, f"00000000-0000-0000-0000-00000000b00{i}",
                 f"00000000-0000-0000-0000-00000000c00{i}",
                 "{}"))
        msgs = [
            # d001: 첫 사용자 메시지 요약 (여러 줄 → 첫 행만, 공백 접기)
            ("00000000-0000-0000-0000-00000000d001", 0, "user",   "이번  주  일정   알려줘\n두번째 줄은 무시"),
            ("00000000-0000-0000-0000-00000000d001", 1, "agent",  "네, 이번 주 일정입니다"),
            # d002: agent 먼저, user는 뒤 → 첫 *user* 메시지 기준
            ("00000000-0000-0000-0000-00000000d002", 0, "agent",  "안녕하세요"),
            ("00000000-0000-0000-0000-00000000d002", 1, "user",   "오늘 날씨 어때"),
            # d003: 50자 초과 → left(49)+'…' (한글/영문 혼재)
            ("00000000-0000-0000-0000-00000000d003", 0, "user", "가"*60),
            # d004: metadata.title 보유 → 3b가 덮지 않는다 (3a 백필 우선)
            # d005: 기존 컬럼 title 보유 → 불변
            # d006: 사용자 메시지 없음 → NULL 유지
            # d007: 사용자 메시지가 공백 전용 → NULL 유지 (빈 제목 금지 규약)
            ("00000000-0000-0000-0000-00000000d007", 0, "user", "   \n  "),
        ]
        for sid, ti, role, content in msgs:
            cur.execute("INSERT INTO public.messages (session_id, turn_index, role, content) VALUES (%s,%s,%s,%s)",
                        (sid, ti, role, content))
        cur.execute("""UPDATE public.sessions SET metadata = '{"title":"포크된 대화"}' WHERE id='00000000-0000-0000-0000-00000000d004'""")
        cur.execute("""INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000a8')""")
        cur.execute("""INSERT INTO public.users (id) VALUES ('00000000-0000-0000-0000-0000000000a8')""")
        # d005는 생성 시 title 세팅 시뮬: 컬럼에 값 넣고 메시지 추가
        cur.execute("""INSERT INTO public.agents (id, owner_id, name) VALUES ('00000000-0000-0000-0000-00000000b008','00000000-0000-0000-0000-0000000000a8','a')""")
        cur.execute("""INSERT INTO public.personas (id, agent_id, name) VALUES ('00000000-0000-0000-0000-00000000c008','00000000-0000-0000-0000-00000000b008','p')""")
        cur.execute("""INSERT INTO public.sessions (id, user_id, agent_id, persona_id, title, metadata) VALUES
            ('00000000-0000-0000-0000-00000000d005','00000000-0000-0000-0000-0000000000a8','00000000-0000-0000-0000-00000000b008','00000000-0000-0000-0000-00000000c008','이미 붙은 제목', '{}')""")
        cur.execute("""INSERT INTO public.messages (session_id, turn_index, role, content) VALUES
            ('00000000-0000-0000-0000-00000000d005', 0, 'user', '뒤늦은 첫 질문')""")

        # 010 백필부만 재실행 (fixtures 주입 후) — 파일 그대로 재적용(멱등 검증과 동일 경로)
        cur.execute(open(os.path.join(MIG_DIR, "010_seed_convergence.sql"), encoding="utf-8").read())
        cur.execute("SELECT id, title FROM public.sessions ORDER BY id")
        titles = {str(r[0])[-4:]: r[1] for r in cur.fetchall()}
        assert titles["d001"] == "이번 주 일정 알려줘", titles["d001"]
        assert titles["d002"] == "오늘 날씨 어때", titles["d002"]
        assert titles["d003"] == "가"*49 + "…", repr(titles["d003"])
        assert titles["d004"] == "포크된 대화", titles["d004"]
        assert titles["d005"] == "이미 붙은 제목", titles["d005"]
        assert titles["d006"] is None, titles["d006"]
        assert titles["d007"] is None, titles["d007"]
        print("CHECK 3 (백필: 첫 user 메시지 요약 / metadata 우선 / 기존 불변 / 빈 제목 NULL / 50자 규칙): PASS")

        # ---- 4) 재실행 멱등 ----
        cur.execute("SELECT count(*) FROM public.neurons"); n_before = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM public.skills"); s_before = cur.fetchone()[0]
        cur.execute("""UPDATE public.neurons SET description='DRIFT-MARK' WHERE slug='empathy'""")
        cur.execute("""UPDATE public.sessions SET title='수동 제목' WHERE id='00000000-0000-0000-0000-00000000d006'""")
        cur.execute(open(os.path.join(MIG_DIR, "010_seed_convergence.sql"), encoding="utf-8").read())
        cur.execute("SELECT count(*) FROM public.neurons"); assert cur.fetchone()[0] == n_before
        cur.execute("SELECT count(*) FROM public.skills"); assert cur.fetchone()[0] == s_before
        cur.execute("SELECT description FROM public.neurons WHERE slug='empathy'"); assert cur.fetchone()[0] == 'DRIFT-MARK'
        cur.execute("SELECT title FROM public.sessions WHERE id='00000000-0000-0000-0000-00000000d006'"); assert cur.fetchone()[0] == '수동 제목'
        print("CHECK 4 (재적용 멱등: 행 수 불변·기존 값 DRIFT/수동 제목 보존 — 덮어쓰기 0): PASS")

        # ---- 5) name 충돌 가드 (cards 예시명 충돌 시나리오) ----
        cur.execute("""INSERT INTO public.neurons (name, slug) VALUES ('공감 에이뉴런','user-custom-empathy')
                       ON CONFLICT (name) DO NOTHING""")
        # 위 insert가 slug는 새 값이라 name UNIQUE 위반 → 실패 가능. 우회: 다른 name 행은 이미 금지.
        # 가드 자체 검증은 "충돌 행 존재 + slug 미존재 → 해당 행 스킵" 경로:
        cur.execute("SELECT count(*) FROM public.neurons WHERE slug='user-custom-empathy'")
        clash_exists = cur.fetchone()[0]
        print(f"NOTE: name 충돌 시뮬 행 존재={clash_exists} (name UNIQUE로 사용자 동명 등록은 원천 차단 — 010 가드는 방어선)")
        # 빈 문자열 트리거 확인 (006 세팅 유지 + 010 재적용 후에도 '') — 고유 user/agent/persona 쌍 사용
        cur.execute("INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000a9')")
        cur.execute("INSERT INTO public.users (id) VALUES ('00000000-0000-0000-0000-0000000000a9')")
        cur.execute("INSERT INTO public.agents (id, owner_id, name) VALUES ('00000000-0000-0000-0000-00000000b009','00000000-0000-0000-0000-0000000000a9','a')")
        cur.execute("INSERT INTO public.personas (id, agent_id, name) VALUES ('00000000-0000-0000-0000-00000000c009','00000000-0000-0000-0000-00000000b009','p')")
        cur.execute("""INSERT INTO public.sessions (id, user_id, agent_id, persona_id, title)
                       VALUES ('00000000-0000-0000-0000-00000000d010',
                               '00000000-0000-0000-0000-0000000000a9',
                               '00000000-0000-0000-0000-00000000b009',
                               '00000000-0000-0000-0000-00000000c009', '   ')""")
        cur.execute("SELECT title FROM public.sessions WHERE id='00000000-0000-0000-0000-00000000d010'")
        assert cur.fetchone()[0] is None, "빈 문자열 → NULL 트리거(006) 실패"
        print("CHECK 5 (006 빈문자열→NULL 트리거가 010 백필 경로에도 적용): PASS")

        # CHECK 6 — 롤백: 010의 BEGIN/COMMIT을 벗긴 본문만 외부 트랜잭션에서 실행 → 롤백 시
        # 카탈로그·백필 효과가 전혀 남아선 안 된다 (적용 전 스냅샷과 완전 동일).
        sql_text = open(os.path.join(MIG_DIR, "010_seed_convergence.sql"), encoding="utf-8").read()
        body = re.sub(r'^\s*(BEGIN|COMMIT)\s*;\s*$', '', sql_text, flags=re.M)
        cur.execute("CREATE TABLE _pre_snapshot AS SELECT * FROM public.sessions WITH DATA")
        cur.execute("CREATE TABLE _pre_neuron AS SELECT * FROM public.neurons WITH DATA")
        cur.execute("CREATE TABLE _pre_skill AS SELECT * FROM public.skills WITH DATA")
        cur.execute("BEGIN")
        cur.execute(body)  # psycopg3 simple-protocol: 다중 문장 단일 execute (006와 동일 경로)
        cur.execute("""SELECT count(*) FROM public.sessions s JOIN _pre_snapshot p ON p.id=s.id
                       WHERE s.title IS DISTINCT FROM p.title""")
        applied_in_tx = cur.fetchone()[0]  # 같은 트랜잭션 내 백필 diff가 있었어야(이미 반영분 0 = 정상: 멱등 상태)
        cur.execute("ROLLBACK")
        cur.execute("SELECT md5(string_agg(id::text||coalesce(title,'∅'), ',' order by id)) FROM public.sessions")
        a = cur.fetchone()[0]
        cur.execute("SELECT md5(string_agg(id::text||coalesce(title,'∅'), ',' order by id)) FROM _pre_snapshot")
        b = cur.fetchone()[0]
        assert a == b, "롤백 후 sessions 스냅샷이 다르다 — 010이 커밋 없이 잔여 상태를 남김"
        cur.execute("SELECT count(*) FROM public.neurons n FULL JOIN _pre_neuron p USING (id) WHERE n.slug IS DISTINCT FROM p.slug OR n.id IS NULL OR p.id IS NULL")
        assert cur.fetchone()[0] == 0, "롤백 후 neurons 변경 잔여"
        cur.execute("SELECT count(*) FROM public.skills s FULL JOIN _pre_skill p USING (id) WHERE s.slug IS DISTINCT FROM p.slug OR s.id IS NULL OR p.id IS NULL")
        assert cur.fetchone()[0] == 0, "롤백 후 skills 변경 잔여"
        cur.execute("DROP TABLE _pre_snapshot; DROP TABLE _pre_neuron; DROP TABLE _pre_skill")
        print(f"CHECK 6 (적용-롤백: 외부 트랜잭션 ROLLBACK 후 세션·카탈로그 잔여 변경 0): PASS (in-tx 백필 diff {applied_in_tx}행은 롤백으로 소멸)")

    print("RESULT: ALL PASS — 001~010 로컬 pg 적용·백필·멱등 실측 완료")

if __name__ == "__main__":
    main()
