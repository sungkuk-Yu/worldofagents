/**
 * t_848d0c3b — 마이그레이션 016_context_patch_archives 정적 프루브.
 * 관례: seed-baseline-015.test.ts(015)의 readFileSync 정적 프루브와 동일 방식 —
 * 상대경로는 vitest cwd(apps/backend) 기준. 카드 범위 "015와 충돌·중복 없어야,
 * additive-only" 회귀 봉쇄.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const UP = readFileSync('supabase/migrations/016_context_patch_archives.sql', 'utf8');
const DOWN = readFileSync('supabase/rollback/016_context_patch_archives_down.sql', 'utf8');

/** 주석 제거 — 실행 문장만 남긴다 (코멘트 내 언급은 계약 위반이 아니다). */
function stripComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, '').replace(/\$\$[\s\S]*?\$\$/g, (m) => m.replace(/^\s*--.*$/gm, ''));
}

describe('016_context_patch_archives — additive-only 계약 (카드 범위)', () => {
  it('context_patches를 바꾸는 문 없음 — ALTER/DROP/DELETE 대상은 오직 신규 테이블 (설계 §1, 카드 ③)', () => {
    const body = stripComments(UP);
    // 금지 작업 (015와 달리 테이블/컬럼/인덱스 드롭 불가 — DROP POLICY 멱등 가드만 허용, RLS 테스트에서 단 1개 확인).
    const up = body.toUpperCase();
    for (const forbidden of ['DELETE FROM', 'TRUNCATE', 'ALTER TABLE CONTEXT_PATCHES', 'DROP TABLE', 'UPDATE CONTEXT_PATCHES', 'DROP INDEX', 'DROP COLUMN']) {
      expect(up, `016 본문에 금지 작업 존재: ${forbidden}`).not.toContain(forbidden);
    }
    // context_patches는 REFERENCES 목적어(FK)로만 언급된다.
    const mentions = body.match(/context_patches\b(?!_archives)/g) ?? [];
    expect(mentions.length).toBeGreaterThanOrEqual(1);
    expect(body).toContain('REFERENCES sessions(id) ON DELETE CASCADE'); // FK 동작은 세션 CASCADE만
    // 테이블 자체를 생성·수정하는 주체는 context_patch_archives 하나.
    expect(body.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1]).toBe('context_patch_archives');
    expect(body.match(/ALTER TABLE (\w+)/g)?.every((s) => s.includes('context_patch_archives'))).toBe(true);
  });

  it('카드 최소 컬럼 10개 + period/id/created_at/updated_at = 14 — 실재 프루브', () => {
    // 테이블 본문(괄호 안)에서만 컬럼을 센다 — 상단 주석·RLS 정책 문이 새지 않게 실행문 앵커.
    const anchor = UP.indexOf('CREATE TABLE IF NOT EXISTS');
    const tbl = UP.slice(anchor, UP.indexOf('\n)', anchor));
    const cols = [...tbl.matchAll(/^\s{4}(\w+) [A-Z]/gm)].map((m) => m[1]);
    for (const need of ['bucket', 'object_path', 'patch_count', 'min_created_at', 'max_created_at',
      'bytes_compressed', 'checksum_sha256', 'archived_at', 'verified_at']) {
      expect(cols, `컬럼 누락: ${need}`).toContain(need);
    }
    expect(cols.filter((c) => !c.endsWith('_constraint')).length).toBe(14);
  });

  it('안전문 4종+: bucket CHECK(context-archive 고정) / object_path UNIQUE / CHECK(period·checksum 형식·max≥min) (설계 §3 무결성 계약)', () => {
    expect(UP).toContain("CHECK (bucket = 'context-archive')");
    expect(UP).toContain('CONSTRAINT context_patch_archives_object_path_key UNIQUE (object_path)');
    expect(UP).toContain(`CHECK (period ~ '^[0-9]{4}-[0-9]{2}$')`);
    expect(UP).toContain("CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')");
    expect(UP).toContain('CHECK (patch_count > 0)');
    expect(UP).toContain('CHECK (bytes_compressed > 0)');
    expect(UP).toContain('CHECK (max_created_at >= min_created_at)');
  });

  it('RLS: enable + SELECT-only owner 정책 + service_role GRANT (002/014 원칙). DROP POLICY는 멱등 재실행용 1개만 허용(015 관례)', () => {
    expect(UP).toContain('ALTER TABLE context_patch_archives ENABLE ROW LEVEL SECURITY');
    expect(UP).toContain('FOR SELECT USING');
    // 쓰기 정책은 없다 — CREATE POLICY는 owner_read 하나.
    expect((UP.match(/CREATE POLICY/g) ?? []).length).toBe(1);
    // DROP은 POLICY 멱등 가드만 (테이블/컬럼/INDEX/TRIGGER 드롭 0 — additive).
    expect((UP.match(/^\s*DROP\s+(\w+)/gm) ?? []).map((s) => s.trim())).toEqual(['DROP POLICY']);
    expect(UP).toContain('GRANT SELECT ON context_patch_archives TO anon, authenticated;');
    expect(UP).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON context_patch_archives TO service_role;');
  });

  it('BEGIN/COMMIT 래핑(원자 적용, 015 관례) + 검증 read-back 주석(007/011/014 관례)', () => {
    expect(UP).toMatch(/^BEGIN;/m);
    expect(UP).toMatch(/^COMMIT;/m);
    expect(UP).toContain('검증 read-back');
  });

  it('015와 충돌·중복 0 — 서로 다른 테이블, 015 본문 재수록 없음', () => {
    expect(UP).not.toContain('ON CONFLICT (slug)');
    expect(UP).not.toContain('seed');
    const M15 = readFileSync('supabase/migrations/015_seed_baseline.sql', 'utf8');
    expect(UP).not.toContain(M15.split('\n').find((l) => l.includes('INSERT INTO neurons'))?.trim() || '__never__');
  });
});

describe('016 down — 롤백 계약 (9/29 전보드 지시)', () => {
  it('실행 문장은 DROP TABLE 1개 — context_patches 무건드림(주석 포함 원리 명시)', () => {
    const body = stripComments(DOWN).trim();
    expect(body.split('\n').filter(Boolean)).toEqual(['DROP TABLE IF EXISTS context_patch_archives;']);
    expect(DOWN).toContain('context_patches'); // 경고 주석 실재
    expect(DOWN).toContain('검증 read-back');
  });
});
