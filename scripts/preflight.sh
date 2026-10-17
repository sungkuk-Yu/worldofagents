#!/usr/bin/env bash
# preflight.sh — 변경 파일 구문검사 + 오염패턴 grep (소프트런 기본)
# PREFLIGHT_STRICT=1 시 위반 exit 1 (2026-10-24 이후 김비서 승인 후)
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

STRICT="${PREFLIGHT_STRICT:-0}"
WARN_COUNT=0

warn() {
  echo "[preflight WARN] $1" >&2
  ((WARN_COUNT++)) || true
}

# 변경 파일 목록 (staged + worktree + untracked)
mapfile -t CHANGED < <(git status --porcelain 2>/dev/null | awk '{print $NF}' || true)
if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "[preflight] 변경 파일 없음 — skip"
  exit 0
fi

echo "[preflight] 검사 대상 ${#CHANGED[@]}개 파일"

# 확장자별 구문검사
TS_FILES=()
PY_FILES=()
JS_FILES=()

for f in "${CHANGED[@]}"; do
  [[ ! -f "$f" ]] && continue  # 삭제된 파일 skip
  # dist/, node_modules/ 제외
  case "$f" in
    dist/*|*/dist/*|node_modules/*|*/node_modules/*) continue ;;
  esac
  case "$f" in
    *.ts|*.tsx) TS_FILES+=("$f") ;;
    *.py)       PY_FILES+=("$f") ;;
    *.js|*.cjs|*.mjs) JS_FILES+=("$f") ;;
  esac
done

# TypeScript: tsc --noEmit (레포 설정 기준)
if [[ ${#TS_FILES[@]} -gt 0 ]]; then
  echo "[preflight] tsc --noEmit (${#TS_FILES[@]} TS/TSX files)"
  TSC_BIN="$REPO_ROOT/node_modules/.bin/tsc"
  if [[ -x "$TSC_BIN" && -f apps/backend/tsconfig.json ]]; then
    if ! "$TSC_BIN" --noEmit -p apps/backend/tsconfig.json 2>&1 | head -30; then
      warn "TypeScript 구문 오류"
    fi
  elif command -v tsc &>/dev/null; then
    if ! tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -30; then
      warn "TypeScript 구문 오류"
    fi
  else
    warn "tsc 없음 — TS 검사 skip"
  fi
fi

# Python: py_compile
for f in "${PY_FILES[@]}"; do
  if ! python3 -m py_compile "$f" 2>&1; then
    warn "Python 구문 오류: $f"
  fi
done

# JavaScript: node --check
for f in "${JS_FILES[@]}"; do
  if ! node --check "$f" 2>&1; then
    warn "JavaScript 구문 오류: $f"
  fi
done

# 오염 패턴 grep
echo "[preflight] 오염 패턴 검사"

# 패턴 목록 (BRE)
PATTERNS=(
  '\*\*\*'                          # 마스킹 잔재
  'COMPRESSION'                     # 압축 마커
  'sk-[a-zA-Z0-9]\{20,\}'           # OpenAI API key
  'AKIA[A-Z0-9]\{16\}'              # AWS access key
  'ghp_[a-zA-Z0-9]\{36\}'           # GitHub PAT
  'xoxb-[a-zA-Z0-9-]\{50,\}'        # Slack bot token
  'YOUR_API_KEY'                    # placeholder
  'INSERT_.*_HERE'                  # placeholder
  'REPLACE_THIS'                    # placeholder
)

for f in "${CHANGED[@]}"; do
  [[ ! -f "$f" ]] && continue
  # 바이너리, 락 파일, dist/, preflight.sh 자체 제외
  case "$f" in
    *.png|*.jpg|*.gif|*.ico|*.woff*|*.ttf|*.lock|package-lock.json|pnpm-lock.yaml) continue ;;
    dist/*|*/dist/*|node_modules/*|*/node_modules/*) continue ;;
    scripts/preflight.sh) continue ;;  # 자기 자신 제외
  esac

  for pat in "${PATTERNS[@]}"; do
    matches=$(grep -n "$pat" "$f" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      while IFS= read -r line; do
        warn "$f:$line (pattern: $pat)"
      done <<< "$matches"
    fi
  done
done

# 결과
echo "[preflight] 완료 — 경고 ${WARN_COUNT}건"

if [[ "$STRICT" == "1" && $WARN_COUNT -gt 0 ]]; then
  echo "[preflight] STRICT 모드: 위반 발견 → exit 1"
  exit 1
fi

exit 0
