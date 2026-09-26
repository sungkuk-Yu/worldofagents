#!/usr/bin/env bash
# wave4-acceptance 재현 런북 (t_b89df485) — reviewer 3회차 "검증 불가" 피드백 대응
#
# 이전 재현 실패의 원인(직접 진단으로 확정):
#  1) 정적서버(:8081)의 cwd가 삭제된 dist-web → 모든 페이지가 ERR_EMPTY_RESPONSE
#  2) 번들에 구운 기본 API URL은 localhost:3000(prod 모드) — DEV 백엔드(:3020)와 불일치
#  3) WS는 /ws 경로가 필수인데 http→ws 변환만 하면 루트에 접속돼 handshake 무응답
#  4) apps/backend/.env의 placeholder OPENAI_API_KEY가 실제 Whisper를 호출해 PTT 전사가 401
#
# 이 스크립트는 위 4가지를 전부 제거한 결정적 환경으로 전 suite를 돌린다.
# 사용: bash tests/e2e/repro_wave4.sh   (레포 루트에서 실행해도 무관)
set -euo pipefail
MOBILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # apps/mobile/MyAgentTalk
REPO="$MOBILE/../../.."
API_PORT=3100
APP_PORT=8097
WS="$MOBILE/tests/e2e"
SCRATCH="${OUT_DIR:-/tmp/wave4-repro}"
mkdir -p "$SCRATCH"

cleanup() { jobs -p | xargs -r kill 2>/dev/null || true; }
trap cleanup EXIT

# 1) 백엔드 — DEV_MODE + 빈 OPENAI_API_KEY(mock STT 강제). 빈 값은 dotenv이 덮어쓰지 못하게
#    pre-export 한다(placeholder 키가 실제 Whisper 경로를 타면 PTT 스모크가 401로 깨진다).
( cd "$REPO/apps/backend" \
  && OPENAI_API_KEY= DEV…true PORT=$API_PORT HOST=127.0.0.1 \
     CORS_ORIGIN="http://localhost:$APP_PORT,http://localhost:8081" \
     node_modules/.bin/tsx src/index.ts ) >"$SCRATCH/backend.log" 2>&1 &
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null && break; sleep 1; done
curl -sf "http://127.0.0.1:$API_PORT/health" | grep -q '"mode":"dev"' || { echo "백엔드 기동 실패: $SCRATCH/backend.log"; exit 1; }

# 2) 웹 번들 — dist-integration(커밋됨)이 이미 localhost:3100 + ws://localhost:3100/ws 기준으로
#    구워져 있다. SKIP_EXPORT=1이면 커밋된 번들을 그대로 쓰고, 아니면 이 환경에 맞게 재수출한다.
if [ "${SKIP_EXPORT:-1}" = "1" ]; then
  grep -q "ws://localhost:$API_PORT/ws" "$MOBILE"/dist-integration/_expo/static/js/web/index-*.js \
    || { echo "커밋된 dist-integration이 API_PORT=$API_PORT와 불일치 — SKIP_EXPORT=0으로 재수출 필요"; exit 1; }
else
  ( cd "$MOBILE" \
    && EXPO_PUBLIC_API_URL="http://localhost:$API_PORT" \
       EXPO_PUBLIC_WS_URL="ws://localhost:$API_PORT/ws" \
       node_modules/.bin/expo export --platform web --output-dir dist-integration >/dev/null )
fi
# expo 미지원(process.env) shim 주입 (rn-web 번들이 window.process를 참조)
grep -q 'window.process' "$MOBILE/dist-integration/index.html" || \
  sed -i "s|<head>|<head><script>window.process=window.process\\\|\\\|{env:{}};</script>|" "$MOBILE/dist-integration/index.html"
python3 -m http.server $APP_PORT --bind 127.0.0.1 -d "$MOBILE/dist-integration" >"$SCRATCH/static.log" 2>&1 &
sleep 1; curl -sf "http://127.0.0.1:$APP_PORT/" >/dev/null || { echo "정적서버 기동 실패"; exit 1; }

export APP_URL="http://localhost:$APP_PORT" API_URL="http://localhost:$API_PORT"

# 3) suite — 기존 스모크는 기본 포트가 고장난 환경이라 env로 재지정한다.
fail=0
run() { echo "== $1"; ( cd "$WS" && OUT_DIR="$SCRATCH/$1" node "smoke_$1.cjs" ) || fail=1; }
run web_chat        # 채팅 MVP E2E (17)
run wave1           # 카드/즐겨찾기 (fixture 기반, 서버 무관)
run wave2           # 볼트/보드
run continuity      # 2탭 연속성·PTT·favorite.updated (20)
run legal           # 법률 UI
run failure_paths   # 오프라인/재시도 (fixture)
run run_c           # Run C 회귀 (fixture)
echo; echo "재현 결과: fail=$fail — 로그/캡처: $SCRATCH"
exit $fail
