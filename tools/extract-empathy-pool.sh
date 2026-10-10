#!/usr/bin/env bash
# extract-empathy-pool.sh — 백엔드 apps/backend/src/lib/empathyRule.ts의 재질문 pool+빌더를
# CJS 번들 스냅샷(tests/e2e/empathyPool.generated.cjs)으로 추출한다. e2e fixture(run_c_fixtures.cjs)는
# 이 산출값만 사용해 재질문 문구를 백엔드와 문자 단위로 공유한다 — 프론트↔백엔드 서식 드리프트를
# 구조적으로 봉인(t_a7b39e0f 대표님 10/10: 백엔드 바뀐 뒤 프론트가 뒤늦게 쫓아가는 방식 금지).
# 백엔드 template 변경 시: 백엔드 머지 후 이 스크립트 재생성 1회 = fixture 자동 전파(하드카피 금지).
#
# 실행: bash tools/extract-empathy-pool.sh   (repo root 기준; backend node_modules의 esbuild 사용)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"           # repo root
MKT="$ROOT/apps/mobile/MyAgentTalk"
OUT="$MKT/tests/e2e/empathyPool.generated.cjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# re-export 번들: 백엔드 순수 모듈의 실제 구현을 그대로 담는다(문자열 복사본 X — 함수·pool 단일 소스).
cat > "$TMP/pool-reexport.ts" <<EOF
export {
  EMPATHY_REQUESTION_TEMPLATES as pool,
  buildEmpathyRequestion as requestion,
  empathyKeywordSummary as summary,
} from '$ROOT/apps/backend/src/lib/empathyRule';
EOF

ESBUILD="$ROOT/apps/backend/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || ESBUILD="$MKT/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || { echo "esbuild not found (backend or mobile node_modules missing)"; exit 127; }
"$ESBUILD" "$TMP/pool-reexport.ts" --bundle --platform=node --format=cjs \
  --outfile="$TMP/pool.cjs" --log-level=warning

{
  echo '// AUTO-GENERATED — 백엔드 apps/backend/src/lib/empathyRule.ts의 esbuild CJS 스냅샷.'
  echo '// 손 edits 금지. 백엔드 pool/빌더 변경 후 재생성: bash tools/extract-empathy-pool.sh'
  echo '// 용도: tests/e2e/run_c_fixtures.cjs 재질문 미러 (t_a7b39e0f 드리프트 봉인).'
  cat "$TMP/pool.cjs"
} > "$OUT"

echo "generated $OUT"
node -e "
const p = require(process.argv[1]);
console.log('ids:', p.pool.map(t => t.id).join(','));
let tid = null;
for (let i = 0; i < 4; i++) { const r = p.requestion('내일 출장 일정 잡아줘', tid, 'ko'); tid = r.templateId; console.log('회전', i, '→', r.templateId, ':', r.text); }
" "$OUT"
