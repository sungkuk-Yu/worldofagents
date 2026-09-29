#!/usr/bin/env bash
# t_9e939f43 — smoke_t64e3_final DEV 스택 하네스 (기존 관례 재현, 볼트 9/29 교준)
# 사용: MDIR=<apps/mobile/MyAgentTalk 절대경로> bash tests/e2e/run_be_t9e939f43.sh
#   → 백엔드 :3077 구동(스모크 종료 후 수동 kill)
set -euo pipefail
MDIR="${MDIR:?MDIR=모바일앱 절대경로 필요}"
REPO="$(cd "$MDIR" && git rev-parse --show-toplevel)"
# worktree 실행 시 apps/backend/node_modules는 원 레포에만 존재 — tsx가 없으면 원 레포 백엔드로 절하
BE_DIR="$REPO/apps/backend"
[ -x "$BE_DIR/node_modules/.bin/tsx" ] || BE_DIR=/home/holysky87/worldofagents/apps/backend
BRIDGE_ENV="$BE_DIR/.env"   # 있으면 로드(없어도 무방 — 아래에서 명시적으로 우회)
set -a; [ -f "$HOME/.config/myagenttalk/deploy.env" ] && . "$HOME/.config/myagenttalk/deploy.env"; [ -f "$BRIDGE_ENV" ] && . "$BRIDGE_ENV" || true; set +a
# 김비서 브리지 왕복(54~73s) 타임아웃 회피: 브리지 env 비우기 (9/26 교훈)
export SECRETARY_BRIDGE_ENDPOINT=
# deploy.env에서 로드된 키가 있으면 유지, 없으면 '' (브리지 미동작 시 타임아웃 회피 우선)
if [ -z "${OPENAI_API_KEY:-}" ]; then export OPENAI_API_KEY=""; fi
# CORS_ORIGIN은 서빙포트=SERVE_PORT(기본 8081, 8125 등 충돌 시 오버라이드) — DEV 백엔드라 자유롭게 지정 가능
SERVE_PORT="${SERVE_PORT:-8081}"
cd "$BE_DIR"
DEV_MODE=true PORT=3077 CORS_ORIGIN="http://localhost:${SERVE_PORT}" \
  STT_SIDECAR_URL=http://127.0.0.1:9833 \
  node_modules/.bin/tsx src/index.ts
