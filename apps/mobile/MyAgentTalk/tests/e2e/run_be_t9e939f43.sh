#!/usr/bin/env bash
# t_9e939f43 — smoke_t64e3_final DEV 스택 하네스 (기존 관례 재현, 볼트 9/29 교준)
# 사용: MDIR=<apps/mobile/MyAgentTalk 절대경로> bash tests/e2e/run_be_t9e939f43.sh
#   → 백엔드 :3077 구동(스모크 종료 후 수동 kill)
set -euo pipefail
MDIR="${MDIR:?MDIR=모바일앱 절대경로 필요}"
REPO="$(cd "$MDIR" && git rev-parse --show-toplevel)"
BRIDGE_ENV="$REPO/apps/backend/.env"   # 있으면 로드(없어도 무방 — 아래에서 명시적으로 우회)
set -a; [ -f "$HOME/.config/myagenttalk/deploy.env" ] && . "$HOME/.config/myagenttalk/deploy.env"; [ -f "$BRIDGE_ENV" ] && . "$BRIDGE_ENV" || true; set +a
# 김비서 브리지 왕복(54~73s) 타임아웃 회피: 브리지 env 비우기 (9/26 교훈)
export SECRETARY_BRIDGE_ENDPOINT=
export OPENAI_API_KEY="${OPENAI_API_…L:}" # deploy.env의 키는 살리되 없으면 ''
cd "$REPO/apps/backend"
DEV_MODE=true PORT=3077 CORS_ORIGIN=http://localhost:8124 \
  STT_SIDECAR_URL=http://127.0.0.1:9833 \
  node_modules/.bin/tsx src/index.ts
