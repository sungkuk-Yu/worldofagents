/**
 * t_58d08ab7 — 마이그레이션 015_seed_baseline 정적 프루브 (additive-only 계약).
 * 관례: reply-to.test.ts(012)의 readFileSync 정적 프루브와 동일 방식 — 상대경로는
 * vitest cwd(apps/backend) 기준. D1 카드 범위 "DELETE/DROP 절대 금지" 회귀 봉쇄.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const UP = readFileSync('supabase/migrations/015_seed_baseline.sql', 'utf8');
const DOWN = readFileSync('supabase/rollback/015_seed_baseline_down.sql', 'utf8');

/** 주석 제거 — 실행 문장만 남긴다 (코멘트 내 언급은 계약 위반이 아니다). */
function stripComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, '').replace(/\$\$[\s\S]*?\$\$/g, (m) => m.replace(/^\s*--.*$/gm, ''));
}

describe('015_seed_baseline — additive-only 계약 (카드 범위)', () => {
  it('DELETE/TRUNCATE/ DROP문 없음 (주석 제외 실행 본문)', () => {
    const body = stripComments(UP).toUpperCase();
    for (const forbidden of ['DELETE FROM', 'TRUNCATE', 'DROP TABLE', 'DROP COLUMN', 'ALTER TABLE DROP']) {
      expect(body, `015 본문에 금지 작업 존재: ${forbidden}`).not.toContain(forbidden);
    }
    // DROP TRIGGER만 허용(006 트리거 재정의 멱등 패턴) — 그것도 trg_sessions_title뿐
    const drops = body.match(/DROP\s+\w+/g) ?? [];
    expect(drops).toEqual(['DROP TRIGGER']);
  });

  it('시드부는 전부 ON CONFLICT DO NOTHING — 기존 행 덮어쓰기(UPDATE neurons/skills) 없음', () => {
    const body = stripComments(UP).toUpperCase();
    expect(body.match(/ON CONFLICT \(SLUG\) DO NOTHING/g)?.length).toBeGreaterThanOrEqual(2);
    expect(body).not.toContain('UPDATE NEURONS');
    expect(body).not.toContain('UPDATE SKILLS');
    expect(body).not.toContain('DO UPDATE'); // 006의 DO UPDATE와 달리 더 보수적
  });

  it('sessions.title 백필 가드: WHERE s.title IS NULL 봉인 + 010과 동일 결정론 규칙', () => {
    expect(UP).toMatch(/WHERE s\.id = d\.session_id\s*\n?\s*AND s\.title IS NULL/);
    expect(UP).toContain("role = 'user'");
    expect(UP).toContain("CASE WHEN length(d.t) > 50 THEN left(d.t, 49) || '…' ELSE d.t END");
    // 010 §3b와 문자 단위 동일 — 드리프트 봉쇄
    const M10 = readFileSync('supabase/migrations/010_seed_convergence.sql', 'utf8');
    const rule = (sql: string) => sql.match(/WITH first_user AS \([\s\S]*?AND d\.t IS NOT NULL;/)?.[0] ?? '';
    expect(rule(UP)).not.toBe(''); // 추출 실패(규칙 누락) 방지
    expect(rule(UP).replace(/\s+/g, ' ')).toBe(rule(M10).replace(/\s+/g, ' '));
  });

  it('카탈로그 값은 010 미러 — neurons 5 slug / skills 공식 4 slug', () => {
    for (const slug of ['empathy', 'answer', 'queue', 'visual', 'translation']) {
      expect(UP, `neurons 누락: ${slug}`).toContain(`'${slug}'`);
    }
    for (const slug of ['calendar-sync', 'email-assistant', 'translation-neuron', 'data-analysis']) {
      expect(UP, `skills 누락: ${slug}`).toContain(`'${slug}'`);
    }
    expect(UP).toContain("'agenttalk-official'");
    expect(UP).toContain('NULL, '); // author_id NULL — 시스템 발행(006/010 관례)
  });

  it('BEGIN/COMMIT 래핑(원자 적용) + 재실행 안전 NOTICE', () => {
    expect(UP).toMatch(/^BEGIN;/m);
    expect(UP).toMatch(/^COMMIT;/m);
    expect(UP).toContain('RAISE NOTICE');
  });
});

describe('015 down — 롤백 계약 (9/29 전보드 지시)', () => {
  it('파괴 작업은 주석 지침만 — 실행 문장 없음(no-op down, semantics 경고 명기)', () => {
    const body = stripComments(DOWN).trim();
    expect(body).toBe(''); // 실행 0문장: 실DB 0-row INSERT의 정직한 귀결
    expect(DOWN).toContain('no-op');
    expect(DOWN).toContain('결재');
  });
});
