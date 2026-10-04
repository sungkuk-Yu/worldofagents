#!/usr/bin/env bash
# env-snapshot.sh — apps/backend/.env 복구 지점 스냅샷 (t_74587408, 2026-10-05)
#
# 배경: 10/4 레포 궤멸 사고로 git 비추적 파일인 apps/backend/.env가 유실되어
#       프로덕션 백엔드가 SUPABASE_URL 누락으로 401회 크래시루프(502)를 돌았다.
#       백업 지점이 없어 복구가 지연됐으므로, 저장소 밖(~/.config)에 0600 백업을
#       항상 유지한다.
#
# 사용:
#   백엔드 기동 전: systemd unit의 ExecStartPre가 자동 호출 (재해 전 예방)
#   배포 후:       cd apps/backend && bash scripts/env-snapshot.sh
#
# 정책:
#   - .env가 있고 필수 키 정합을 통과할 때만 백업을 갱신한다(원자적 tmp→mv).
#   - .env가 없거나 깨져도 기존 백업을 절대 덮어쓰지 않고 exit 0 —
#     기동 차단/실패 로그는 env-integrity-check.sh의 몫(스냅샷이 크래시를 유발하면 안 된다).
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${MYAGENTTALK_ENV_FILE:-$BACKEND_DIR/.env}"
DEST_DIR="${MYAGENTTALK_SNAPSHOT_DIR:-$HOME/.config/myagenttalk}"
DEST="$DEST_DIR/backend.env.bak"

log() { echo "[env-snapshot] $*"; }

if [ ! -f "$ENV_FILE" ]; then
  log "WARN: $ENV_FILE 없음 — 기존 백업($DEST)을 그대로 유지한다. 유실 사고라면: cp $DEST $ENV_FILE && chmod 600 $ENV_FILE"
  exit 0
fi

# 정합 통과본만 백업에 승격한다: 필수 키 + 실제 값(dev placeholder/mock 금지).
missing=""
for key in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY JWT_SECRET; do
  val=$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \t' || true)
  case "$key" in
    SUPABASE_SERVICE_ROLE_KEY) ok=$(case "$val" in ""|mock*) printf 0;; *) printf 1;; esac);;
    JWT_SECRET)                ok=$(case "$val" in ""|agenttalk-dev-secret-change-in-production) printf 0;; *) printf 1;; esac);;
    *)                         ok=$([ -n "$val" ] && printf 1 || printf 0);;
  esac
  [ "$ok" = "1" ] || missing="$missing $key"
done
if [ -n "$missing" ]; then
  log "WARN: $ENV_FILE에 유효한 값이 없는 키:$missing — 백업 미갱신(깨진 파일로Healthy 백업 덮어쓰기 금지)."
  exit 0
fi

mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR" 2>/dev/null || true
TMP="$(mktemp "$DEST_DIR/.backend.env.bak.XXXXXX")"
cp "$ENV_FILE" "$TMP"
chmod 600 "$TMP"
mv -f "$TMP" "$DEST"
log "OK: $(basename "$ENV_FILE") → $DEST (0600, $(date -u +%Y-%m-%dT%H:%M:%SZ))"
