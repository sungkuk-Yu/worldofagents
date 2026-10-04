# 마이에이전트톡 백엔드 배포 가이드 (Phase 1)

> 대상: `apps/backend` — Fastify + Supabase + LangGraph + WebSocket
> 작성일: 2026-09-25

## 1. 요구 사항

| 도구 | 버전 |
|------|------|
| Node.js | >= 20.12 (require(esm) — LangGraph 로딩) |
| npm | 9+ |
| Supabase | 프로젝트 (Auth, Postgres, Realtime) |
| (선택) OpenAI API Key | STT (Whisper v3 Turbo) |
| (선택) Temporal Cloud/서버 | 작업 오케스트레이션 (Phase 2) |

## 2. 설치

```bash
cd apps/backend
npm install
```

의존성은 `package.json`에 고정되어 있으며 `node_modules` 커밋 여부는 운영 방침에 따라 결정한다.

## 3. 환경 변수

`.env` 파일 또는 배포 환경 변수로 주입:

```env
# ── 기본 ──
PORT=3000
HOST=0.0.0.0
DEV_MODE=false

# ── Supabase ──
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# ── 인증 ──
JWT_SECRET=<32자 이상 랜덤 문자열>
JWT_EXPIRES_IN=7d

# ── CORS ──
CORS_ORIGIN=https://app.example.com

# ── STT (Whisper) ──
OPENAI_API_KEY=sk-...
WHISPER_MODEL=whisper-1   # Whisper v3 Turbo

# ── 뉴런 엔진 ──
# langgraph: LangGraph StateGraph 실행 (권장)
# simple:    순차 파이프라인 폴백 (STT 등 외부 의존성 최소화)
NEURON_ENGINE=langgraph

# ── Stream Chat (실시간 메시징, 미사용 시 공란) ──
STREAM_CHAT_API_KEY=
STREAM_CHAT_API_SECRET=

# ── Temporal (작업 워크플로우, 미사용 시 공란) ──
TEMPORAL_ADDRESS=
TEMPORAL_NAMESPACE=
TEMPORAL_TASK_QUEUE=myagenttalk-tasks
```

**중요:** `DEV_MODE=true`이거나 `SUPABASE_URL`이 없으면 **인메모리 devstore**로 동작한다.
운영 배포는 반드시 `DEV_MODE=false` + Supabase 자격 증명을 설정한다.

## 4. Supabase 스키마 적용

```bash
# 마이그레이션 파일: supabase/migrations/001_initial_schema.sql
# Supabase CLI 사용 시:
supabase link --project-ref <project-ref>
supabase db push

# 또는 SQL Editor에서 001_initial_schema.sql 전체 내용 실행
```

스키마 적용 후 권장 검증:

```sql
-- 15개 테이블 확인
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
-- 시드 뉴런 확인 (서버 기동 시 ensureDefaultNeurons가 자동 보장)
select slug, status from neurons;
```

## 5. 빌드 및 실행

```bash
# 타입 체크 + 빌드
npm run build          # dist/ 생성

# 프로덕션 실행
npm start              # node dist/index.js

# 개발 모드 (Supabase 없이 — devstore 사용)
npm run dev            # tsx watch src/index.ts
```

### 프로세스 관리 (systemd 예시)

```ini
# /etc/systemd/system/myagenttalk-backend.service
[Unit]
Description=MyAgentTalk Backend
After=network.target

[Service]
WorkingDirectory=/opt/worldofagents/apps/backend
ExecStart=/usr/bin/node dist/index.js
Restart=always
EnvironmentFile=/opt/worldofagents/apps/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now myagenttalk-backend
```

### 실 배포 unit (skyserver, t_74587408)

실서는 **사용자 systemd** unit(`~/.config/systemd/user/myagenttalk-backend.service`)로 돌고,
배포 템플릿은 `apps/backend/deploy/myagenttalk-backend.service`에 추적된다. 핵심은 env 계층:
`deploy.env`(EnvironmentFile, ~/.config/myagenttalk)가 먼저 주입되고, `apps/backend/.env`(git 비추적)의
실값이 dotenv로 그 뒤를 채운다. **`.env` 유실 = SUPABASE_URL 누락 크래시루프**(10/4 궤멸 사고, restart 401회).

템플릿의 기동 전 게이트 2종 (systemd는 ExecStartPre 실패 시 Restart=always여도 재시도 루프에
들어가지 않고 unit이 failed로 남는다 — 무음 크래시루프 대신 journal 한 줄로 원인 지목):

```ini
# ① 기동 직전 .env 정본을 ~/.config/myagenttalk/backend.env.bak(0600)에 스냅샷 (항상 exit 0)
ExecStartPre=%h/worldofagents/apps/backend/scripts/env-snapshot.sh
# ② SUPABASE_URL/SERVICE_ROLE_KEY/JWT_SECRET 부재·mock·dev placeholder 시 exit 1로 기동 차단
#    (DEV_MODE != false일 때만; 우선순위는 실 runtime과 동일 — shell/deploy.env에 키가 이미
#     존재하면(빈 값 포함) .env가 덮지 않는다. 이 마스킹 함정이 10/4 사고의 부차 원인)
ExecStartPre=%h/worldofagents/apps/backend/scripts/env-integrity-check.sh
```

### .env 유실 복구 절차 (백업 → 복원 → read-back)

```bash
# 1) 백업 지점이 있다면 (매 기동 ExecStartPre가 정합 통과본만 갱신해 온다):
cp ~/.config/myagenttalk/backend.env.bak apps/backend/.env && chmod 600 apps/backend/.env
#    없다면 백엔드진이 실값 재구성 후 반드시 수동 스냅샷:
apps/backend/scripts/env-snapshot.sh
# 2) 게이트 사전 통과 확인 (기동 없이 검증만):
DEV_MODE=false apps/backend/scripts/env-integrity-check.sh; echo $?   # 0이어야 재시동 자격
# 3) 재기동 + read-back:
systemctl --user restart myagenttalk-backend
systemctl --user is-active myagenttalk-backend          # active
curl -s http://127.0.0.1:3000/health                     # {"status":"ok","mode":"prod"}
journalctl --user -u myagenttalk-backend -n 30 | grep env-check   # [env-check] OK 확인
```

## 6. 헬스 체크

| 엔드포인트 | 역할 |
|-----------|------|
| `GET /health` | 서버 생존 + dev/prod 모드 |
| `GET /api-version` | API 목록/버전 |
| `GET /` | 서비스 개요 |
| `WS /ws?session_id=…&token=…` | WebSocket (STT/트랜스크립트/뉴런 상태) |

## 7. 테스트 (배포 전 검증)

```bash
# 1) 단위 테스트 (33건 — vitest, DEV_MODE 고정)
npm test

# 2) 타입 체크
npx tsc --noEmit

# 3) 스모크 (devstore 서버 + 전체 API 흐름)
PORT=3000 STANDALONE=true DEV_MODE=true tsx src/index.ts   # 터미널 1
node tests/smoke_dev.mjs http://localhost:3000              # 터미널 2
# 기대: 13 passed, 0 failed

# 4) 프로덕션(Supabase) 검증 — 동일 스모크 스크립트를 운영 BASE로 실행
node tests/smoke_dev.mjs https://api.example.com
```

## 8. 운영 노트

- **RLS**: 모든 API 호출은 서버가 Supabase Admin(서비스 롤) 클라이언트로 수행한다.
  사용자 컨텍스트가 필요한 조회는 `createUserClient(accessToken)` 사용 (RLS 적용).
- **JWT**: Fastify `@fastify/jwt` 서명 — `JWT_SECRET` 교체 시 토큰이 모두 무효화된다.
- **STT**: OpenAI `audio/transcriptions` 사용 (`whisper-1` = Whisper v3 Turbo).
  WebSocket 클라이언트는 16kHz PCM s16le 청크를 전송한다.
- **LangGraph**: `NEURON_ENGINE=langgraph` 시 `@langchain/langgraph` v0.2.74 사용.
  패키지 미설치/로드 실패 시 자동으로 `simple` 폴백.
- **로그**: pino JSON 로그. `LOG_LEVEL=info` (기본) / `silent` (테스트).

## 9. 롤백

1. 이전 배포 dist 백업으로 교체 또는 `git revert`
2. `sudo systemctl restart myagenttalk-backend`
3. `/health` 확인
4. 스키마 변경이 포함된 경우: `supabase db diff`로 사전 검토 후 `db push`