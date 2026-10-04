#!/usr/bin/env node
// scripts/deploy-gate.mjs — 배포 게이트 (읽기 전용): 라이브 번들 grep + 2단 sha 대조
//
// 출처: 9/30 P0 실패로그(2026-09-30-김비서-실패사고-라이브번들-localhost-P0) 재발 방지 항목.
//       "env로 주소를 맞췄다"를 믿지 말고 산출물(라이브 번들)에서 되읽는 것이 관례 — 이 스크립트가 그 관례의 실행체.
//
// 검사:
//  (a) grep — https://myagenttalk.com (커스텀 도메인) + Netlify 원본 도메인에서
//      실제 서빙되는 _expo 번들을 fetch 후:
//        · 금지: 따옴표 박힌 URL 형태의 localhost / ws://localhost / 127.0.0.1  → 0건이어야 위반 아님.
//          (메모 관례: \uXXXX 이스케이프 저장 회피 대응 — raw + 디코딩 병행 검색)
//          참고: 민번들에는 URI.js 계열 라이브러리 정규식 템플릿에 'localhost'가 평문으로 존재한다
//          (예: tpl_host_fuzzy_test='localhost|www\\.…').따라서 "raw 카운트 0"은 어떤 빌드에서도
//          달성 불가능한 기준 → 위반 판정은 '문자열 리터럴 안의 스킴 URL' 패턴으로 하고,
//          raw 'localhost' 전체 카운트와 컨텍스트는 감사용으로 항상 인쇄한다.
//        · 필수: 'app.myagenttalk.com' 1건 이상 실측.
//  (b) 2단 sha 대조 — Netlify API가 기록한 deploy-file sha1은 사실상 git blob hash
//      (sha1("blob <len>\0" + bytes))이다 (t_4d97f5eb 관례 이식: CLI --skip-blob/upload-file는
//      git hash-object를 쓰는 반면 API가 기록하는 값과 CLI가 서버에 전송하는 원시 페이로드가
//      다른 해시 계열이라 단일 비교는 오판한다). 그래서 3계열을 병행 계산·인쇄:
//        · gitBlobSha(네트워크 fetch 라이브 바이트)  ← API record sha와 이 값이 일치해야 함
//        · raw sha1(라이브 바이트)                   ← 참고용 (API sha와 다른 계열, 불일치 정상)
//        · 로컬 산출물 git hash-object + gitBlobSha  (--dist 지정 시, 라이브=로컬 확인)
//
// 사용:
//   node scripts/deploy-gate.mjs [--token-file PATH] [--dist DIR] [--strict-raw] [--site-id ID]
//   exit 0 = PASS / 1 = 위반 / 2 = 스크립트·네트워크 오류
//   (--strict-raw: 라이브러리 정규식混入 여부 떠나 raw 'localhost' 자체가 보이면 위반 취급 — 데모·자가테스트용)
//   (--dist DIR: 그 빌드 산출물과 라이브 바이트의 동일성까지 3단 대조)
//
// 주의: 토큰 파일 내용은 절대 stdout에 인쇄하지 않는다. revoke 금지. 이 스크립트는 어떤
//       사이드 이펙트도 없다 (GET만 수행, 파일 쓰지 않음, DB 무침범).

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ORIGIN = 'https://myagenttalk.com';
const NETLIFY_ORIGIN = 'https://myagenttalk-app.netlify.app';
const SITE_ID_DEFAULT = 'c1b51d85-2a79-44b6-8e4c-327893d10723'; // ~/.netlify/state.json
const TOKEN_FILE_DEFAULT =
  '/home/holysky87/openclaw-migration/rsync/workspace-javis/study/deploy/netlify_token.txt';
const REQUIRED_PATTERN = /app\.myagenttalk\.com/g;

// 위반 패턴: 문자열 리터럴/코드 안에 구워진 localhost·127.0.0.1 URL (P0 실사례 형태 포함)
// P0 실사례 = OUR code의 API base(`http://localhost:8157`, `:3000`, `:8432` 등 로컬 서버 포트).
// 10/4부터 @supabase 라이브러리 자체가 번들에 자체 localhost 상수를 든다(GoTrue 기본 URL
// `http://localhost:9999` — OUR anon-key 없으면 client 자체가 생성되지 않아사실상 unreachable,
// storage allowlist '127.0.0.1' 등) — 제3자 라이브러리常量은 우리 배포 도메인을 가리키지 않으므로
// 위반 집합에서 our-server 포트만 명시적으로 잡는다 (lib-상수는 (참고) raw 카운트에 계속 인쇄).
const FORBIDDEN_PATTERNS = [
  { name: 'http(s)://localhost (GoTrue :9999 lib 상수 제외)', re: /["'`\`]https?:\/\/localhost(?!:9999)(:[0-9]{2,5})?/gi },
  { name: 'ws(s)://localhost (quoted)', re: /["'`\`]wss?:\/\/localhost/gi },
  { name: 'protocol-relative //localhost', re: /["'`\`]\/\/localhost[:\/"']/gi },
  { name: 'http(s)://127.0.0.1 (URL form)', re: /["'`\`]https?:\/\/127\.0\.0\.1/gi },
];

const args = process.argv.slice(2);
function argVal(flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const tokenFile = argVal('--token-file', TOKEN_FILE_DEFAULT);
const siteId = argVal('--site-id', SITE_ID_DEFAULT);
const distDir = argVal('--dist', null);
const strictRaw = args.includes('--strict-raw'); // 데모·자가테스트용: raw localhost도 위반 취급

function decodeUnicodeEscapes(text) {
  // \uXXXX (JS 소스 이스케이프) 형태 저장 회피 대응 (메모 관례): 디코딩 사본을 만들어 병행 검색.
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
}

function contextAt(text, index, before = 70, after = 50) {
  const s = Math.max(0, index - before);
  const e = Math.min(text.length, index + after);
  return text.slice(s, e).replace(/\s+/g, ' ');
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return { text: await res.text(), status: res.status };
}

async function extractBundleUrl(siteHtml, label) {
  const m = siteHtml.match(/src="(\/_expo\/static\/js\/web\/index-[0-9a-f]+\.js)"/);
  if (!m) throw new Error(`${label}: index.html에서 번들 경로를 찾지 못함`);
  return m[1];
}

function grepBundle(text, label) {
  const decoded = decodeUnicodeEscapes(text);
  const violations = [];
  const lines = [`--- [a] grep: ${label} (${(text.length / 1024).toFixed(0)}KB) ---`];

  for (const { name, re } of FORBIDDEN_PATTERNS) {
    // 이스케이프 사본이 원문과 다르면(= \uXXXX 존재) 같은 히트가 양쪽에서 잡힌다 —
    // 정규화된 컨텍스트로 중복 제거해 raw 히트는 1회만 신고하고, 원문에 없는 이스케이프 전용 형태만 추가 신고.
    const seen = new Set();
    const sheets = decoded === text ? [{ tag: 'raw', s: text }] : [{ tag: 'raw', s: text }, { tag: 'unescape', s: decoded }];
    for (const hay of sheets) {
      for (const h of [...hay.s.matchAll(re)]) {
        const ctx = contextAt(hay.s, h.index);
        const key = `${name}|${ctx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({ label, rule: `${name} [${hay.tag}]`, at: h.index, ctx });
      }
    }
  }

  if (strictRaw) {
    const rawHits = [...text.matchAll(/localhost/gi)];
    lines.push(`  strict-raw: 'localhost' total=${rawHits.length} (위반 취급)`);
    for (const h of rawHits) {
      violations.push({ label, rule: "raw 'localhost' [strict]", at: h.index, ctx: contextAt(text, h.index) });
    }
  } else {
    const rawHits = [...text.matchAll(/localhost/gi)];
    lines.push(`  (참고) raw 'localhost' 카운트=${rawHits.length} — 라이브러리 정규식 템플릿混入 가능, 위반판정은 quoted-URL 패턴만`);
    for (const h of rawHits) {
      lines.push(`    · @${h.index}: ${contextAt(text, h.index, 55, 35)}`);
    }
  }

  const reqRaw = (text.match(REQUIRED_PATTERN) || []).length;
  const reqDec = decoded === text ? 0 : (decoded.match(REQUIRED_PATTERN) || []).length;
  const reqCount = reqRaw + reqDec;
  lines.push(`  필수 'app.myagenttalk.com' 실측=${reqCount}건`);
  if (reqCount < 1) {
    violations.push({ label, rule: "required 'app.myagenttalk.com' >=1", at: 0, ctx: '(실측 0건)' });
  }
  return { lines, violations };
}

function gitBlobSha(buf) {
  // git hash-object: sha1("blob <len>\0" + bytes)
  const h = createHash('sha1');
  h.update(`blob ${buf.length}\0`, 'latin1');
  h.update(buf);
  return h.digest('hex');
}

async function checkNetlifySha(bundlePath, liveBytes) {
  const lines = ['--- [b] 2단 sha 대조 (Netlify API file-sha vs 로컬 git hash-object) ---'];
  const violations = [];
  if (!existsSync(tokenFile)) {
    violations.push({ label: 'netlify', rule: 'token file 존재', at: 0, ctx: tokenFile });
    return { lines: [...lines, `  토큰 파일 없음: ${tokenFile}`], violations };
  }
  const token = readFileSync(tokenFile, 'utf8').trim();
  const api = async (path) => {
    const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Netlify API ${res.status} ${path}`);
    return res.json();
  };

  const site = await api(`/sites/${siteId}`);
  const dep = site.published_deploy;
  if (!dep || !dep.id) throw new Error('published_deploy 없음');
  lines.push(
    `  published deploy=${dep.id} branch=${dep.branch ?? '?'} commit_ref=${dep.commit_ref || dep.review_id || '-'}`,
  );
  lines.push(`  deployed_at=${dep.created_at}`);

  let entries;
  try {
    entries = await api(`/deploys/${dep.id}/files?per_page=1000`);
  } catch {
    entries = await api(`/deploys/${dep.id}/files`);
  }
  // 실측(9/30): 이 엔드포인트는 {path: sha} 객체가 아니라 [{sha, path,...}] 배열로 올 수 있다 — 양쪽 대응.
  let rec;
  if (Array.isArray(entries)) {
    rec = entries.find((f) => f && f.path === bundlePath);
    rec = rec && { sha: rec.sha };
  } else {
    rec = (entries || {})[bundlePath];
  }
  const liveRaw = createHash('sha1').update(liveBytes).digest('hex');
  const liveGit = gitBlobSha(liveBytes);
  lines.push(`  ${bundlePath}`);
  if (!rec) {
    violations.push({ label: 'netlify', rule: 'deploy-record에 번들 없음', at: 0, ctx: bundlePath });
  } else {
    const apiSha = typeof rec === 'string' ? rec : rec.sha;
    lines.push(`    1) Netlify API file-sha        = ${apiSha}`);
    lines.push(`    2) fetch 라이브 바이트 sha1    = ${liveRaw}`);
    lines.push(`    3) fetch 라이브 바이트 git-hash= ${liveGit}`);
    if (apiSha === liveRaw || apiSha === liveGit) {
      const series = apiSha === liveRaw ? '원시sha1' : 'gitblob';
      lines.push(`      → API sha == 라이브 ${series} 일치 ✓`);
    } else {
      violations.push({ label: 'netlify', rule: 'API sha ≠ 라이브(fetch) 바이트의 sha1·git-hash 양 계열', at: 0, ctx: `api=${apiSha} raw=${liveRaw} git=${liveGit}` });
    }
    if (distDir) {
      const localPath = join(distDir, bundlePath);
      if (existsSync(localPath)) {
        const buf = readFileSync(localPath);
        lines.push(`    4) 로컬 산출물 ${localPath}`);
        lines.push(`      raw-sha1=${createHash('sha1').update(buf).digest('hex')} git-hash-object=${gitBlobSha(buf)} 바이트수=${buf.length}(live=${liveBytes.length})`);
        if (buf.length !== liveBytes.length || !buf.equals(liveBytes)) {
          violations.push({ label: 'netlify', rule: '로컬 산출물 바이트 ≠ 라이브 바이트', at: 0, ctx: localPath });
        } else {
          lines.push('      → 로컬=라이브 바이트 동일 ✓');
        }
      } else {
        lines.push(`    (로컬 산출물 없음, 비교 건너뜀: ${localPath})`);
      }
    }
  }
  return { lines, violations };
}

async function main() {
  const allViolations = [];
  const out = [];
  out.push(`deploy-gate ${new Date().toISOString()} — 대상: ${ORIGIN} (+ ${NETLIFY_ORIGIN})`);

  let netlifyHtml;
  for (const [url, label] of [
    [ORIGIN, 'myagenttalk.com(커스텀 도메인)'],
    [NETLIFY_ORIGIN, 'netlify 원본'],
  ]) {
    const { text: html } = await fetchText(url);
    const bundlePath = await extractBundleUrl(html, label);
    out.push(`  ${label} 번들 경로: ${bundlePath}`);
    const bundleUrl = new URL(bundlePath, url).toString();
    const { text } = await fetchText(bundleUrl);
    const { lines, violations } = grepBundle(text, label);
    out.push(...lines);
    allViolations.push(...violations);
    if (label.startsWith('netlify')) netlifyHtml = { bundlePath, bytes: Buffer.from(text, 'utf8') };
  }

  const { lines, violations } = await checkNetlifySha(netlifyHtml.bundlePath, netlifyHtml.bytes);
  out.push(...lines);
  allViolations.push(...violations);

  out.push('='.repeat(60));
  if (allViolations.length) {
    out.push(`RESULT: FAIL — 위반 ${allViolations.length}건`);
    for (const v of allViolations) out.push(`  [${v.label}] ${v.rule} @${v.at} :: ${v.ctx}`);
  } else {
    out.push('RESULT: PASS — 금지 0건, 필수 도메인 실측, sha 대조 일치');
  }
  console.log(out.join('\n'));
  process.exit(allViolations.length ? 1 : 0);
}

main().catch((e) => {
  console.error('SCRIPT ERROR:', e && e.message ? e.message : e);
  process.exit(2);
});
