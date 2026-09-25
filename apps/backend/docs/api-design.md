# 에이전트톡(AgentTalk) 백엔드 API 설계서

> **작성일:** 2026-09-25
> **문서 유형:** API 설계서 (REST + WebSocket + Stream Chat 이벤트)
> **기반 문서:** `neuron-architecture-spec.md`, `001_initial_schema.sql`
> **기술 스택:** Supabase (Auth/DB/Realtime/Storage), Stream Chat, LangGraph, Temporal.io, Whisper v3 Turbo
> **상태:** 초안 (Draft)

---

## 목차

1. [개요](#1-개요)
2. [공통 규약](#2-공통-규약)
3. [REST 엔드포인트](#3-rest-엔드포인트)
   - 3.1 [인증/사용자](#31-인증사용자)
   - 3.2 [에이전트 CRUD](#32-에이전트-crud)
   - 3.3 [페르소나 관리](#33-페르소나-관리)
   - 3.4 [세션 및 대화](#34-세션-및-대화)
   - 3.5 [뉴런 관리](#35-뉴런-관리)
   - 3.6 [작업(Task)](#36-작업task)
   - 3.7 [스킬 마켓](#37-스킬-마켓)
   - 3.8 [기억/컨텍스트](#38-기억컨텍스트)
4. [WebSocket 프로토콜](#4-websocket-프로토콜)
   - 4.1 [오디오 스트리밍 (STT)](#41-오디오-스트리밍-stt)
   - 4.2 [실시간 트랜스크립트](#42-실시간-트랜스크립트)
   - 4.3 [상태 업데이트](#43-상태-업데이트)
5. [Stream Chat 커스텀 이벤트](#5-stream-chat-커스텀-이벤트)
6. [에러 코드](#6-에러-코드)
7. [Rate Limiting](#7-rate-limiting)
8. [버전 관리](#8-버전-관리)

---

## 1. 개요

에이전트톡 백엔드는 다음 세 계층으로 구성된다:

| 계층 | 역할 | 기술 |
|------|------|------|
| **REST API** | 리소스 CRUD, 인증, 관리자 기능 | Supabase Edge Functions + PostgREST |
| **WebSocket** | 실시간 양방향 통신 (오디오, 상태) | Supabase Realtime + 자체 WS 서버 |
| **Stream Chat** | 채팅 채널, 메시지 동기화 | Stream Chat SDK (서버/클라이언트) |

**설계 원칙:**
- Supabase Auth 기반 JWT 인증 (RLS와 연동)
- REST는 리소스 CRUD, WebSocket은 실시간 이벤트로 역할 분리
- Stream Chat은 "메시지 전송" 레이어로만 활용 (비즈니스 로직은 자체 백엔드)
- 모든 엔드포인트는 `user_id` 기준으로 권한 검증 (본인 리소스만 접근)

---

## 2. 공통 규약

### 2.1 Base URL

```
Production:  https://api.agenttalk.io/v1
Staging:     https://api-staging.agenttalk.io/v1
Development: http://localhost:54321/v1  (Supabase local)
```

### 2.2 인증

모든 API는 Bearer 토큰 (Supabase JWT)을 요구한다:

```
Authorization: Bearer <supabase_access_token>
```

인증 예외: `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`

### 2.3 요청/응답 형식

- Content-Type: `application/json` (파일 업로드 시 `multipart/form-data`)
- 시간 형식: ISO 8601 (UTC) — `2026-09-25T09:30:00Z`
- ID 형식: UUID v4
- 페이지네이션: cursor-based (대규모 목록), offset (소규모)

```json
// 표준 응답 래퍼
{
  "ok": true,
  "data": { ... },
  "meta": {
    "cursor": "eyJpZCI6...",
    "has_more": false,
    "total": 42
  }
}

// 에러 응답
{
  "ok": false,
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "에이전트를 찾을 수 없습니다.",
    "details": { "agent_id": "..." }
  }
}
```

### 2.4 표준 HTTP 상태 코드

| 코드 | 의미 |
|------|------|
| 200 | 성공 |
| 201 | 생성됨 |
| 204 | 성공 (내용 없음) |
| 400 | 잘못된 요청 (유효성 실패) |
| 401 | 인증 필요 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 충돌 (중복 등) |
| 429 | Rate limit 초과 |
| 500 | 서버 오류 |

---

## 3. REST 엔드포인트

### 3.1 인증/사용자

#### 회원가입
```
POST /auth/signup
```
**요청:**
```json
{
  "email": "user@example.com",
  "password": "********",
  "display_name": "김철수",
  "timezone": "Asia/Seoul",
  "language": "ko"
}
```
**응답 (201):** Supabase 세션 (access_token, refresh_token, user)

#### 로그인
```
POST /auth/login
```
**요청:** `{ "email": "...", "password": "..." }`

#### 토큰 갱신
```
POST /auth/refresh
```
**요청:** `{ "refresh_token": "..." }`

#### 로그아웃
```
POST /auth/logout
```

#### 내 프로필 조회
```
GET /me
```
**응답:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "display_name": "김철수",
  "avatar_url": "https://...",
  "timezone": "Asia/Seoul",
  "preferences": {},
  "created_at": "2026-09-25T00:00:00Z"
}
```

#### 프로필 수정
```
PATCH /me
```
**요청:** `{ "display_name": "...", "preferences": { ... } }`

---

### 3.2 에이전트 CRUD

#### 내 에이전트 목록
```
GET /agents
```
**쿼리 파라미터:**
- `status` (선택): `active`, `inactive`
- `limit`, `cursor`

#### 에이전트 상세 조회
```
GET /agents/:agent_id
```

#### 에이전트 생성
```
POST /agents
```
**요청:**
```json
{
  "name": "나의 그림자 비서",
  "description": "일을 대신 처리해주는 든든한 동료",
  "agent_type": "shadow",
  "config": {
    "default_model": "gpt-4o",
    "max_tokens": 4096,
    "temperature": 0.7
  }
}
```
**응답 (201):** 생성된 에이전트 + 기본 페르소나 자동 생성

#### 에이전트 수정
```
PATCH /agents/:agent_id
```

#### 에이전트 삭제 (소프트 삭제)
```
DELETE /agents/:agent_id
```
**주의:** 연관 세션/메시지는 보존, `is_active = false`로 변경

#### 에이전트 복제
```
POST /agents/:agent_id/clone
```
**요청:** `{ "name": "복사본 이름" }`

---

### 3.3 페르소나 관리

#### 에이전트의 페르소나 목록 (버전 포함)
```
GET /agents/:agent_id/personas
```

#### 현재 활성 페르소나 조회
```
GET /agents/:agent_id/personas/current
```

#### 새 페르소나 버전 생성
```
POST /agents/:agent_id/personas
```
**요청:**
```json
{
  "name": "민지",
  "voice_config": {
    "voice_id": "alloy",
    "speed": 1.0,
    "pitch": 0,
    "language": "ko"
  },
  "tone_config": {
    "formality": "friendly",
    "emoji_usage": "rare",
    "sentence_length": "medium",
    "honorific_level": 3
  },
  "style_guide": {
    "personality_traits": ["MBTI: ENFJ", "꼼꼼함", "유머 감각"],
    "preferred_expressions": ["~해볼게요!", "좋아요"],
    "forbidden_expressions": ["못해요", "모르겠어요"],
    "example_responses": [
      {
        "user_input": "내일 회의 준비해줘",
        "agent_response": "네, 내일 회의 준비해볼게요! 어떤 자료부터 정리할까요?"
      }
    ]
  },
  "neuron_overrides": {
    "empathy": { "warmth_delta": 0.2, "allowed_prefixes": ["아", "그렇군요"] },
    "answer": { "formality_delta": 0.1 }
  },
  "relationship_type": "colleague"
}
```

#### 페르소나 수정 (새 버전 생성)
```
PATCH /agents/:agent_id/personas/:persona_id
```

#### 페르소나 프리뷰 (테스트 대화)
```
POST /agents/:agent_id/personas/preview
```
**요청:** `{ "persona_config": {...}, "sample_input": "안녕!" }`  
**응답:** 샘플 입력에 대한 AI 생성 응답 (실제 저장 안 함)

---

### 3.4 세션 및 대화

#### 세션 조회 (또는 자동 생성)
```
POST /sessions/ensure
```
**요청:** `{ "agent_id": "uuid" }`  
**응답:** 기존 세션 반환 또는 새로 생성 (upsert 패턴, `user_id + agent_id` 유니크)
```json
{
  "id": "session_uuid",
  "agent_id": "...",
  "status": "active",
  "stream_channel_id": "session:uuid",
  "created_at": "..."
}
```

#### 세션 상세 조회
```
GET /sessions/:session_id
```

#### 세션 목록
```
GET /sessions
```

#### 세션 상태 변경
```
PATCH /sessions/:session_id
```
**요청:** `{ "status": "suspended" }`

#### 세션 아카이브
```
POST /sessions/:session_id/archive
```

#### 메시지 히스토리 조회
```
GET /sessions/:session_id/messages
```
**쿼리:**
- `before` (cursor) / `after` (cursor)
- `limit` (기본 50, 최대 200)
- `role` 필터: `user`, `agent`, `system`

**응답:**
```json
{
  "data": [
    {
      "id": "msg_uuid",
      "turn_index": 42,
      "role": "agent",
      "message_type": "text",
      "content": "Q3 매출 자료를 정리했어요.",
      "source_neuron": "answer",
      "attachments": [],
      "created_at": "..."
    }
  ],
  "meta": { "has_more": true, "cursor": "..." }
}
```

#### 텍스트 메시지 전송
```
POST /sessions/:session_id/messages
```
**요청:**
```json
{
  "content": "내일 회의 자료 정리해줘",
  "message_type": "text",
  "attachments": []
}
```
**동작:**
1. messages 테이블 INSERT
2. Stream Chat 채널에 전송
3. Temporal 워크플로우에 `user_message` 신호 전송
4. 응답(202 Accepted) — 실제 답변은 Stream Chat 이벤트로 수신

#### 메시지 피드백 (좋아요/싫어요)
```
POST /sessions/:session_id/messages/:message_id/feedback
```
**요청:** `{ "feedback": "like" }` 또는 `{ "feedback": "dislike", "reason": "..." }`

---

### 3.5 뉴런 관리

#### 에이전트에 사용 가능한 뉴런 목록
```
GET /agents/:agent_id/neurons
```
**응답:** 기본 뉴런 4종 + 설치된 커스텀 뉴런

#### 세션 내 활성 뉴런 인스턴스
```
GET /sessions/:session_id/neurons
```
**응답:**
```json
{
  "data": [
    {
      "instance_id": "...",
      "neuron": { "slug": "empathy", "name": "공감 에이뉴런" },
      "status": "active",
      "activated_at": "..."
    }
  ]
}
```

#### 뉴런 수동 활성화/비활성화 (디버그용)
```
POST /sessions/:session_id/neurons/:neuron_id/activate
DELETE /sessions/:session_id/neurons/:instance_id
```

#### 뉴런 연결 이력 조회
```
GET /sessions/:session_id/neurons/history
```
**쿼리:** `limit`, `since`, `event_type`

#### 뉴런 유형 메타데이터 조회 (레지스트리)
```
GET /neurons
GET /neurons/:neuron_id
```

#### 뉴런 유형 등록 (관리자 / 개발자)
```
POST /neurons
```
**요청:** `neurons` 테이블 전체 필드 + 코드 패키지 업로드  
**응답 (202):** 보안 심사 큐에 등록

---

### 3.6 작업(Task)

#### 세션의 작업 목록
```
GET /sessions/:session_id/tasks
```
**쿼리:** `status` (pending/in_progress/completed/blocked)

#### 작업 상세 조회
```
GET /tasks/:task_id
```

#### 작업 생성 (수동)
```
POST /sessions/:session_id/tasks
```
**요청:**
```json
{
  "title": "Q3 매출 보고서 작성",
  "description": "부서별 매출 집계 및 차트 생성",
  "task_type": "research",
  "priority": "high",
  "input_data": { "department": "영업팀", "period": "2026-Q3" }
}
```

#### 작업 상태 변경
```
PATCH /tasks/:task_id
```
**요청:** `{ "status": "in_progress" }`

#### 작업 취소
```
POST /tasks/:task_id/cancel
```
**동작:** Temporal 워크플로우에 `user_stop` 신호 전송

#### 작업 로그 조회
```
GET /tasks/:task_id/logs
```

---

### 3.7 스킬 마켓

#### 스킬 목록 (검색/필터)
```
GET /skills
```
**쿼리:**
- `q` (검색어)
- `category` (general/productivity/creative/analysis/communication/neuron)
- `sort` (popular/new/rating) — 기본 `popular` (composite_score 순)
- `price` (free/paid/all)
- `limit`, `cursor`

#### 스킬 상세 조회
```
GET /skills/:skill_id_or_slug
```

#### 스킬 랭킹 조회
```
GET /skills/ranking
```
**쿼리:** `category`, `limit`  
**응답:** `skill_rankings` 뷰 기반 (다신호 종합 점수)

#### 스킬 등록 (개발자)
```
POST /skills
```
**요청:** 스킬 메타데이터 + 내용 (JSON) + 아이콘 파일  
**동작:** `status = 'pending_review'`로 생성, 보안 심사 큐 등록

#### 스킬 설치
```
POST /skills/:skill_id/install
```
**요청:** `{ "agent_id": "uuid" }` (선택 — 에이전트에 바인딩)  
**응답:** `skill_installations` 레코드

#### 스킬 제거
```
DELETE /skills/:skill_id/install
```

#### 스킬 평가 (별점)
```
POST /skills/:skill_id/rate
```
**요청:** `{ "rating": 5 }` (1~5)

#### 내 스킬 목록 (설치한 것)
```
GET /me/skills
```

#### 내 스킬 목록 (등록한 것 — 개발자)
```
GET /me/skills/authored
```

---

### 3.8 기억/컨텍스트

#### 세션의 압축 기억 목록
```
GET /sessions/:session_id/memories
```
**쿼리:** `min_importance`, `tag`, `limit`

#### 기억 수동 압축 트리거
```
POST /sessions/:session_id/memories/compact
```
**동작:** `check_compaction_needed()` 무시하고 즉시 압축 시작 (Temporal Activity)

#### 세션 컨텍스트 스냅샷 조회
```
GET /sessions/:session_id/context
```
**응답:** 현재 재구성된 컨텍스트 (conversation.summary, task.current, persona.state 등)

#### 컨텍스트 키 삭제 (사용자 요청)
```
DELETE /sessions/:session_id/context/:key
```
**예:** `DELETE .../context/user.preferences` — 개인정보 삭제 요청 대응

#### 원본 트랜스크립트 다운로드
```
GET /sessions/:session_id/transcripts
```
**쿼리:** `format` (json/text), `from_turn`, `to_turn`  
**응답:** 보존된 원본 대화 (압축 후에도 유지됨)

---

## 4. WebSocket 프로토콜

WebSocket은 Supabase Realtime 채널 위에 자체 프로토콜을 얹어 사용한다.

### 4.0 연결 수립

```
wss://realtime.agenttalk.io/v1/agenttalk?token=<supabase_access_token>
```

**클라이언트 → 서버: 구독 시작**
```json
{
  "type": "subscribe",
  "session_id": "uuid",
  "channels": ["audio", "transcript", "neuron_status", "task"]
}
```

**서버 → 클라이언트: 구독 확인**
```json
{
  "type": "subscribed",
  "session_id": "uuid",
  "channels": ["audio", "transcript", "neuron_status", "task"]
}
```

---

### 4.1 오디오 스트리밍 (STT)

Whisper v3 Turbo로 실시간 음성 인식. 오디오는 바이너리 프레임으로 전송.

#### 오디오 스트림 시작
```json
{
  "type": "audio.start",
  "session_id": "uuid",
  "config": {
    "sample_rate": 16000,
    "encoding": "pcm_s16le",
    "language": "auto"
  }
}
```

#### 오디오 청크 (바이너리 프레임)
```
[Binary Frame: PCM 16-bit 오디오 청크, 100ms 단위]
```

#### 오디오 스트림 종료
```json
{ "type": "audio.end", "session_id": "uuid" }
```

#### VAD (Voice Activity Detection) 신호
```json
{ "type": "audio.vad", "active": true }
```

---

### 4.2 실시간 트랜스크립트

#### 부분 트랜스크립트 (low latency)
**서버 → 클라이언트:**
```json
{
  "type": "transcript.partial",
  "session_id": "uuid",
  "text": "내일 회의 자료",
  "confidence": 0.82,
  "language": "ko"
}
```

#### 최종 확정 트랜스크립트 (문장 경계)
**서버 → 클라이언트:**
```json
{
  "type": "transcript.final",
  "session_id": "uuid",
  "turn_index": 42,
  "text": "내일 회의 자료 좀 정리해줘, 특히 Q3 매출 관련해서.",
  "confidence": 0.95,
  "language": "ko",
  "duration_ms": 2340,
  "message_id": "msg_uuid"
}
```

---

### 4.3 상태 업데이트

#### 뉴런 상태 변경
**서버 → 클라이언트:**
```json
{
  "type": "neuron.status",
  "session_id": "uuid",
  "neuron": { "slug": "answer", "name": "답변 에이뉴런" },
  "status": "processing",
  "stage": "thinking",
  "quip": "자료를 찾고 있어요..."
}
```

`stage` 값: `thinking` | `organizing` | `finalizing` | `rendering`  
`quip`: 캐릭터 말투의 짧은 진행 안내 문구

#### 작업 상태 변경
**서버 → 클라이언트:**
```json
{
  "type": "task.status",
  "task_id": "uuid",
  "status": "in_progress",
  "progress": 0.45,
  "message": "Q3 매출 데이터 수집 중..."
}
```

#### 큐 상태 업데이트 (끼어들기 발생 시)
**서버 → 클라이언트:**
```json
{
  "type": "queue.update",
  "session_id": "uuid",
  "pending_count": 2,
  "current_task": "Q3 매출 보고서 작성",
  "next_tasks": ["이메일 답장 작성"]
}
```

#### 세션 이벤트
```json
{ "type": "session.archived", "session_id": "uuid" }
{ "type": "session.error", "code": "NEURON_DEGRADED", "message": "..." }
```

#### 핑/퐁 (연결 유지)
```json
{ "type": "ping", "ts": 1758791400000 }
{ "type": "pong", "ts": 1758791400000 }
```
**간격:** 30초. 클라이언트가 60초 내 pong 미수신 시 재연결.

---

## 5. Stream Chat 커스텀 이벤트

Stream Chat 채널은 세션 1개당 1개 (`channel_id = "session:<session_id>"`).  
표준 메시지 외에 다음 커스텀 이벤트를 활용한다.

### 5.1 클라이언트 → 서버 이벤트

#### STT 중간 결과 전달 (UI 동기화용)
```typescript
"custom.stt_partial": {
  text: string;
  isFinal: boolean;
  language: string;
}
```

#### 사용자 중단 요청 ("잠깐만 멈춰봐")
```typescript
"custom.user_stop": {}
```
**서버 동작:** Temporal 워크플로우에 `user_stop` 신호 전송 → 모든 활성 뉴런 중단

#### 사용자 끼어들기 표시
```typescript
"custom.user_interrupt": {
  text: string;
}
```

### 5.2 서버 → 클라이언트 이벤트

#### 공감 응답 (즉시 표시)
```typescript
"custom.empathy_response": {
  text: string;  // "Q3 매출 정리하시는구나, 바로 해드릴게요."
}
```

#### 답변 스트리밍 청크
```typescript
"custom.answer_chunk": {
  text: string;           // 누적 텍스트
  delta: string;          // 이번 청크만
  progress: number;       // 0.0 ~ 1.0 (예상 진행률)
  is_complete: boolean;
}
```

#### 비주얼 프리뷰
```typescript
"custom.visual_preview": {
  artifact_id: string;
  image_url: string;
  status: "preview" | "final";
  caption: string;
}
```

#### 처리 상태 (UX 피드백)
```typescript
"custom.processing_status": {
  stage: "thinking" | "organizing" | "finalizing" | "rendering";
  quip: string;         // 캐릭터 말투의 짧은 문구
  active_neurons: string[];  // ["empathy", "answer", "visual"]
}
```

#### 큐 업데이트
```typescript
"custom.queue_update": {
  pending_count: number;
  current_task: string;
  estimated_wait_ms: number;
}
```

#### 메시지 메타데이터 (페르소나 가드 결과 등)
```typescript
"custom.message_meta": {
  message_id: string;
  source_neuron: string;
  persona_guard_passed: boolean;
  generation_time_ms: number;
}
```

### 5.3 채널 멤버십

세션 생성 시 자동으로 두 멤버 추가:
- 사용자 (`user_id`)
- 에이전트 봇 (`agent:<agent_id>` — 서버 측 서비스 계정)

---

## 6. 에러 코드

| 코드 | HTTP | 설명 |
|------|------|------|
| `AUTH_REQUIRED` | 401 | 인증 토큰 필요 |
| `AUTH_EXPIRED` | 401 | 토큰 만료 |
| `FORBIDDEN` | 403 | 권한 없음 (타인 리소스 접근 등) |
| `VALIDATION_ERROR` | 400 | 요청 형식 오류 (details 필드 참조) |
| `AGENT_NOT_FOUND` | 404 | 에이전트 없음 |
| `AGENT_LIMIT_EXCEEDED` | 403 | 에이전트 생성 한도 초과 (무료: 3개) |
| `SESSION_NOT_FOUND` | 404 | 세션 없음 |
| `SESSION_ARCHIVED` | 409 | 아카이브된 세션 (쓰기 불가) |
| `PERSONA_VERSION_CONFLICT` | 409 | 페르소나 동시 수정 충돌 |
| `NEURON_NOT_FOUND` | 404 | 뉴런 유형 없음 |
| `NEURON_ACTIVATION_FAILED` | 500 | 뉴런 활성화 실패 (리소스 부족 등) |
| `NEURON_DEGRADED` | 503 | 뉴런 장애 상태 (폴백 동작 중) |
| `TASK_NOT_FOUND` | 404 | 작업 없음 |
| `TASK_ALREADY_COMPLETED` | 409 | 완료된 작업 (수정 불가) |
| `SKILL_NOT_FOUND` | 404 | 스킬 없음 |
| `SKILL_ALREADY_INSTALLED` | 409 | 이미 설치된 스킬 |
| `SKILL_IN_REVIEW` | 409 | 심사 중인 스킬 (설치 불가) |
| `SKILL_SECURITY_FAILED` | 403 | 보안 심사 실패 |
| `STT_SERVICE_UNAVAILABLE` | 503 | STT 서비스 장애 |
| `TEMPORAL_UNAVAILABLE` | 503 | Temporal 워크플로우 엔진 장애 |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit 초과 |
| `INTERNAL_ERROR` | 500 | 알 수 없는 서버 오류 |

---

## 7. Rate Limiting

| 엔드포인트 그룹 | 한도 | 창 |
|-----------------|------|----|
| 인증 (`/auth/*`) | 10회 | 분 |
| 에이전트 CRUD | 60회 | 분 |
| 메시지 전송 | 60회 | 분 |
| 오디오 스트림 | 5 동시 세션 | - |
| 스킬 마켓 조회 | 120회 | 분 |
| 스킬 등록/수정 | 10회 | 시간 |
| 기억 압축 트리거 | 3회 | 시간 |

**헤더 응답:**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 54
X-RateLimit-Reset: 1758791460
```

초과 시 `429 Too Many Requests` + `Retry-After` 헤더.

---

## 8. 버전 관리

- URL 경로에 `/v1` 포함
- 호환성 깨지는 변경은 `/v2`로 분리
- Deprecation은 최소 6개월 전 공지 (`Sunset` 헤더)
- 마이너 변경 (필드 추가 등)은 버전 업 없이 진행, 응답에 `X-API-Version` 헤더 포함

---

## 부록 A: Postman / OpenAPI

`/docs/openapi.yaml` 경로에 OpenAPI 3.1 스펙 제공 (CI에서 자동 생성).  
`/docs/playground` 경로에서 Swagger UI 접근 가능 (staging 환경만).

## 부록 B: 웹훅 (향후)

서드파티 연동을 위한 웹훅 이벤트 (v2 계획):
- `agent.created`, `agent.deleted`
- `session.started`, `session.archived`
- `task.completed`, `task.failed`
- `skill.installed`, `skill.updated`

---

*이 문서는 구현 과정에서 발견되는 사항에 따라 갱신된다. 변경 시 CHANGELOG.md에 기록.*
