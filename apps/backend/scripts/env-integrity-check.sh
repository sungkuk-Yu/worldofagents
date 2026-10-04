#!/usr/bin/env bash
# env-integrity-check.sh — 프로덕션 기동 직전 env 정합 게이트 (t_74587408, 2026-10-05)
#
# 배경: 10/4 레포 궤멸 사고로 apps/backend/.env(git 비추적)가 유실됐을 때,
#       백엔드는 'SUPABASE_URL이 필요합니다'로 죽었다가 systemd Restart=always가
#       401회 크래시루프를 돌렸다 — 조용한 무한 재시작 대신 기동 자체를 즉시 실패시켜
#       'env 누락'이 로그 한 줄로 진단되게 하는 것이 목적.
#
# 사용: systemd user unit의 ExecStartPre로 직접 호출 (스크립트 mode 755, shebang bash):
#   ExecStartPre=%h/worldofagents/apps/backend/scripts/env-snapshot.sh
#   ExecStartPre=%h/worldofagents/apps/backend/scripts/env-integrity-check.sh
#   (순서 유의: 스냅샷이 먼저 — 정합 게이트가 실패해도 마지막 정상본은 백업에 남아야 한다)
#
# 정책:
#   - DEV_MODE=true(또는 미설정=기본 dev)면 게이트 스킵 exit 0 (devstore는 env 불요).
#   - systemd가 주입한 환경(PORT/DEV_MODE/EnvironmentFile) + dotenv가 읽을 .env를
#     합친 실효 값으로 판정한다. shell 환경이 우선(systemd EnvironmentFile semantics).
#   - 실패 시 어떤 키가 왜 부족한지 명시 로그 후 exit 1 → systemd가 unit을 failed로
#     남기고 재시작 카운터 폭주가 아니라 원인 한 줄이 journal에 찍힌다.
set -uo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${MYAGENTTALK_ENV_FILE:-$BACKEND_DIR/.env}"

log() { echo "[env-check] $*"; }

# effective_value KEY — 실 runtime(dotenv 기본: process.env에 이미 존재하는 값은 .env가 덮지 않음,
# 빈 문자열도 '존재'라 마스킹됨)과 동일 우선순위: env에 있으면 그 값, 없으면 .env 값.
env_value() {
  local key="$1"
  if [ -f "$ENV_FILE" ]; then
    grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed "s/^[\"']//; s/[\"']$//" | tr -d ' \t'
  fi
}
effective_value() {
  local key="$1"
  if [ -n "${!1+x}" ]; then printf '%s' "${!1}"; else env_value "$key"; fi
}

# dev 모드는 게이트 대상 아님 (validateConfig와 동일 기준: devMode면 검사 생략)
devmode=$(effective_value DEV_MODE)
if [ "$devmode" != "false" ]; then
  log "OK: DEV_MODE=${devmode:-true}(dev) — 정합 게이트 스킵."
  exit 0
fi

failures=""
check() { # check KEY "실패조건 설명" validator
  local key="$1" why="$2" val; val=$(effective_value "$key")
  case "$key" in
    SUPABASE_URL)                [ -n "$val" ] || failures="$failures\n  - $key: $why";;
    SUPABASE_SERVICE_ROLE_KEY)   case "$val" in ""|mock*) failures="$failures\n  - $key: $why";; esac;;
    JWT_SECRET)                  case "$val" in ""|agenttalk-dev-secret-change-in-production) failures="$failures\n  - $key: $why";; esac;;
  esac
}

check SUPABASE_URL                "비어있음(유실/미설정) — .env 또는 deploy.env에 실제 프로젝트 URL 필요"
check SUPABASE_SERVICE_ROLE_KEY   "비어있거나 mock — 유효한 service_role 키 필요"
check JWT_SECRET                  "비어있거나 dev placeholder — 운영용 시크릿 필요"

if [ -f "$ENV_FILE" ]; then
  log ".env: $ENV_FILE 존재 ($(wc -l < "$ENV_FILE" | tr -d ' ')줄)"
else
  log ".env: $ENV_FILE **없음** — 백업 복원: cp ~/.config/myagenttalk/backend.env.bak $ENV_FILE && chmod 600 $ENV_FILE"
fi

if [ -n "$failures" ]; then
  log "FAIL: 운영 필수 설정 누락 — 기동을 차단합니다 (크래시루프 대신 이 한 줄을 보고 조치)."
  printf '%b\n' "$failures" >&2
  exit 1
fi
log "OK: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/JWT_SECRET 정합 — 기동 허용."
