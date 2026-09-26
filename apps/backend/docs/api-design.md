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
**동작 (Phase 1 동기 응답):**
1. messages 테이블 INSERT (user 메시지 + 공감 응답 + 답변 응답)
2. 뉴런 파이프라인 실행 (LangGraph 또는 simple 폴백) — 라우팅 → 공감 → 답변 → 비주얼 판정
3. 뉴런 인스턴스 활성화 + 연결 이벤트(`neuron_connections`) 기록
4. 응답(201 Created) — 전체 턴 결과를 동기 반환. 실시간 이벤트는 WebSocket(`neuron.status`, `transcript.*`)으로 수신

**응답 (201):**
```json
{
  "ok": true,
  "data": {
    "user_message_id": "uuid",
    "empathy_message_id": "uuid",
    "answer_message_id": "uuid",
    "empathy_response": "…공감 응답…",
    "answer_response": "…답변 응답…",
    "dialogue_type": "task",
    "activation_plan": { "activate": ["empathy", "answer"], "reason": "empathy=always, answer=request_detected", "dialogue_type": "task" },
    "neuron_events": [
      { "neuron": "router", "status": "processing", "stage": "organizing", "quip": "어떻게 처리할지 정리 중이에요" }
    ],
    "persona_guard_passed": true,
    "engine": "langgraph"
  }
}
```

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

WebSocket은 백엔드의 /ws 엔드포인트에서 자체 프로토콜을 제공한다. 최종 인증·재생·실행 이벤트 계약은 아래 Phase 2 변경 섹션을 따른다.

### 4.0 연결 수립

```
wss://<백엔드 호스트>/ws?ticket=<일회용 티켓>
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

## Phase 2 변경 (2026-09-26)

REST `POST /api/sessions/:id/messages`, WS 텍스트 입력과 음성 확정 입력은 같은 턴 실행기를 사용한다. 접수 시 `run_id`를 발급하고 세션별로 직렬 처리한다. 공감 뉴런은 기존 템플릿을 유지하며 답변 뉴런만 LLM을 호출한다.

### WS 텍스트 입력과 신규 이벤트

인증된 세션 소유자는 다음 메시지를 보낼 수 있다.

```json
{"type":"message.send","session_id":"세션 UUID","content":"오늘 할 일을 정리해줘"}
```

### 티켓 인증과 재연결

`POST /api/ws-ticket`에 `Authorization: Bearer <JWT>`를 보내면 `{"ok":true,"data":{"ticket":"32자리 hex","expires_in":30}}`을 반환한다. 발급받은 티켓으로 `/ws?ticket=<ticket>`에 연결한다. 티켓은 30초 동안 유효하며 인증 성공 즉시 소비되므로 재연결마다 새로 발급해야 한다. 헤더 JWT 인증도 유지한다.

**쿼리 JWT 제거(breaking): `?token=***` prod에서 거부, 티켓 사용.** 개발 모드에서도 일반 쿼리 JWT를 인증에 사용하지 않는다. `dev-test`만 개발 전용 사용자로 인정하며 익명 연결은 기존대로 허용한다.

소유권 검증을 통과한 구독에는 현재 최신 seq를 먼저 응답하고, 요청한 last_seq보다 큰 이벤트를 오래된 순서로 재생한다.

```json
{"type":"subscribe","session_id":"세션 UUID","last_seq":12}
{"type":"subscribed","session_id":"세션 UUID","channels":["audio","transcript","neuron_status","task"],"current_seq":20}
```

`message.new`, `run.*`, `answer.delta/done`, `neuron.status`, `transcript.partial/final`, `queue.update`에는 세션별 1부터 단조 증가하는 `seq`가 붙는다. 연결이 없어도 기록하며 세션별 최근 500개만 메모리에 보관한다. `connected/subscribed/error/pong/ping`은 seq와 재생 대상에서 제외한다. 프로세스 재시작 시 번호와 버퍼는 소실된다. last_seq를 생략하면 재생하지 않는다. 버퍼 보관 범위를 벗어난 이력은 REST 메시지 조회로 복구해야 하며, 재시작 후에는 last_seq를 0으로 초기화한다. 클라이언트는 seq로 중복 수신을 제거한다.

### 실행 상태와 취소

`run.started → run.progress → run.completed/run.failed/run.cancelled` 순서로 전이한다. 접수 즉시 started를 발행하고 락 대기 중에는 해당 상태를 유지한다. progress의 stage는 `thinking | organizing | finalizing | rendering`이며 단계 변경 시 quip을 포함한다.

```json
{"type":"run.started","session_id":"세션 UUID","run_id":"실행 UUID","seq":1,"quip":"접수했어요. 바로 살펴볼게요"}
{"type":"run.progress","session_id":"세션 UUID","run_id":"실행 UUID","seq":2,"stage":"thinking","quip":"잠깐만요, 생각해볼게요…"}
{"type":"run.completed","session_id":"세션 UUID","run_id":"실행 UUID","seq":10,"message_ids":{"user":"메시지 UUID","empathy":null,"answer":null},"llm":{"used":false,"model":null,"fallback":false}}
{"type":"run.failed","session_id":"세션 UUID","run_id":"실행 UUID","seq":11,"error":{"code":"INTERNAL_ERROR","message":"처리 중 오류가 발생했습니다."}}
{"type":"run.cancelled","session_id":"세션 UUID","run_id":"실행 UUID","seq":12,"partial_text":"취소 전 생성된 텍스트"}
```

위 종료 이벤트 세 종류는 각 실행에서 하나만 발생한다. 소유자는 `{"type":"run.cancel","session_id":"세션 UUID","run_id":"실행 UUID"}`를 보낼 수 있다. run_id 생략 시 해당 세션의 최신 실행을 취소한다. 실행이 없으면 `error/NOT_FOUND`를 반환한다. 취소 시 사용자 메시지는 유지하고 답변은 저장하지 않는다. partial_text는 누적 스트리밍 텍스트이며 없으면 빈 문자열이다. 내부 오류 코드는 `RUN_CANCELLED`(HTTP 499)이며 WS에서는 cancelled 이후 별도 오류 이벤트를 보내지 않는다.

- `message.new`: `{type, session_id, run_id, seq, message}`. message는 저장된 messages 행 전체다. 성공 시 사용자 → 공감 → 답변 순으로 전송하며 없는 응답 행은 생략한다.
- `answer.delta`: `{type, session_id, run_id, seq, delta, index}`. index는 실행별 0부터 증가한다.
- `answer.done`: `{type, session_id, run_id, seq, text, message_id, llm: {used, model, fallback, usage}}`. PersonaGuard를 적용한 최종 텍스트다. 답변이 없으면 text는 빈 문자열, message_id는 null이다.

성공 시 `message.new`들 → `answer.done` → `run.completed` 순서다. 뉴런 상태와 트랜스크립트 이벤트도 유지한다. LLM 장애 시 템플릿 폴백 또는 PersonaGuard에 의해 텍스트가 달라질 수 있으므로 누적 델타를 answer.done.text로 교체한다.

### REST 응답

`POST /api/sessions/:id/messages`의 기존 필드는 유지하며 다음을 추가한다.

```json
{
  "run_id":"실행 UUID",
  "turn_id":"실행 UUID",
  "llm":{"used":true,"model":"모델명","fallback":false,"usage":{"total_tokens":100},"durationMs":500},
  "messages":{"user":{"id":"사용자 메시지 UUID"},"empathy":{"id":"공감 메시지 UUID"},"answer":{"id":"답변 메시지 UUID"}}
}
```

`turn_id`는 `run_id`와 동일한 값을 갖는 하위호환 alias다.

위 `messages`의 각 객체는 실제 응답에서 저장 행 전체를 포함한다. 공감·답변이 없으면 해당 값은 null이다. LLM 미설정 시 `used: false, fallback: false, reason: LLM_UNCONFIGURED`, 호출 실패 시 `used: false, fallback: true, reason: 오류 코드`다.

`GET /api/sessions/:id/messages`의 `dialogue_type`은 저장된 카드 유형이며, 사용자 라우터 분류는 `router_dialogue_type`으로 반환한다. 상세 계약은 아래 기능성 payload 절을 따른다. `after`와 `before`는 유효한 정수 턴 번호에만 적용하며 `meta.has_more`를 유지한다.

압축 범위는 INT4RANGE 문자열 `[lower,upper)`로 저장한다. 상한은 마지막 메시지의 turn_index + 1이며 기존 객체 범위도 읽을 수 있다.

### 메시지 기능성 payload 계약

카드 유형은 라우터의 `DialogueType`과 별개인 `DialogueCardType`이다. 답변 메시지의 `dialogue_type`은 아래 6종 중 하나이며 `structured_payload`는 JSON 객체다. 아래는 유형별 JSON 예시다.

| dialogue_type | 용도 | structured_payload 예시 |
| --- | --- | --- |
| `text` | 일반 텍스트 | `{}` |
| `info_card` | 요약과 정보 | `{"title":"날씨","summary":"맑음","facts":[{"label":"기온","value":"20도"}]}` |
| `spreadsheet` | 표 | `{"title":"재고","columns":["품목","수량"],"rows":[["사과","2"]]}` |
| `file` | 파일 목록 | `{"files":[{"name":"보고서","kind":"pdf","url":null,"meta":{}}]}` |
| `task_flow` | 작업 체크리스트 | `{"title":"배포","items":[{"title":"검증","status":"pending","detail":null}]}` |
| `multi_agent` | 협업 에이전트 목록 | `{"agents":[{"name":"분석 담당","role":"자료 분석"}]}` |

표의 columns는 문자열 배열, rows는 문자열의 2차원 배열이다. 정보 카드의 facts는 label/value 문자열 쌍이며 규칙 폴백에서는 생략할 수 있다. 작업 항목의 status는 `pending`, detail은 문자열 또는 null이다. 파일 url은 문자열 또는 null, meta는 객체다. 파일·협업 규칙 폴백은 각각 `files: []`, `agents: []`를 반환하며 실제 파일이나 에이전트 생성을 의미하지 않는다.

답변 뉴런은 텍스트 생성 완료 후 `data/file/task/multi` 요청에 한해서 같은 설정 모델로 비스트리밍 구조화 추출을 시도한다(최대 512 토큰). `information/command/question`은 LLM 추출을 생략한다. LLM 미설정, 호출 오류, JSON 파싱 실패, 잘못된 카드 유형 또는 객체가 아닌 payload는 규칙으로 폴백한다. MVP에서는 payload 내부의 유형별 필드까지 엄격하게 검증하지 않는다.

규칙은 data의 마크다운 표를 spreadsheet로, 파싱 실패 시 info_card로 변환한다. task는 체크리스트·번호 목록을 pending 항목으로 만들며 목록이 없으면 요청 제목으로 한 항목을 만든다. question은 요청 앞 50자와 답변 앞 200자로 info_card를 만들고 information/command는 text를 반환한다. multi 요청도 답변 뉴런을 활성화한다. 분류 단계 취소는 규칙 결과로 답변 저장을 완료하고, 답변 텍스트 생성 중 취소는 기존 `run.cancelled` 계약을 유지한다.

`answer.delta`는 기존 순수 텍스트 스트리밍을 유지한다. 구조화 JSON은 델타에 섞이지 않는다. 구조화는 answerNode의 답변을 기준으로 생성되며 이후 PersonaGuard가 확정 텍스트를 변경할 수 있다.

DB에는 답변 행의 `dialogue_type/structured_payload`를 저장한다. 사용자·공감 행은 `dialogue_type: null, structured_payload: {}`로 저장한다. 이전 행의 dialogue_type은 null을 허용하고 structured_payload는 `{}`가 기본값이다. GET 행은 다음 필드를 포함한다.

```json
{
  "role":"agent",
  "source_neuron":"answer",
  "dialogue_type":"info_card",
  "router_dialogue_type":null,
  "structured_payload":{"title":"질문","summary":"답변 요약"}
}
```

`dialogue_type`은 저장 컬럼 우선이며 없으면 null이다. `router_dialogue_type`은 사용자 행에서만 기존 라우터 분류(`information/data/file/task/multi/question/command`)를 반환하고 모든 에이전트·시스템 행에서는 null이다. `structured_payload`는 저장값을 반환하고 이전 개발 저장소 행에 없으면 `{}`로 보완한다.

REST `POST /api/sessions/:id/messages`의 data에는 다음 structured가 추가된다. 기존 data.dialogue_type은 라우터 분류를 유지한다.

```json
{"structured":{"dialogue_type":"info_card","structured_payload":{"title":"질문","summary":"답변 요약"},"classifier":"rules"}}
```

`classifier`는 `llm | rules`이며 TurnResult와 REST의 structured에 포함한다. DB 메시지 행에는 저장하지 않는다. `run.completed.structured`는 같은 dialogue_type과 structured_payload만 포함하며 classifier는 제외한다(프로토콜 타입상 선택 필드). `message.new.message`와 REST의 messages 객체에는 저장 행의 신규 컬럼 dialogue_type과 structured_payload가 그대로 포함된다. message.new에는 조회용 router_dialogue_type을 추가하지 않는다.

### 인증과 운영 설정

REST와 WS는 자체 발급 JWT를 검증하고, 백엔드는 service-role로 DB에 접근한다. 소유권은 라우트와 WS 명령 처리 시 검증한다. 사용자별 Supabase access token 교환은 Phase 3 과제다. 마이그레이션 002는 authenticated/anon의 정책을 SELECT 전용으로 제한하며 쓰기는 백엔드 service_role을 경유한다.

WS는 Authorization 헤더를 우선 검증하고 실패 시 일회용 query.ticket을 소비한다. 초기 세션 및 subscribe, audio.start, audio.end, audio.cancel, transcript, message.send, run.cancel은 소유권 검증을 통과해야 허브에 등록된다. DEV_MODE의 무인증 연결은 connected만 수신하고 세션 작업은 거부한다. `dev-test`도 `dev-test-user` 소유 세션만 접근한다.

DEV_MODE는 `DEV_MODE=true`로만 활성화된다. 운영 모드에서는 SUPABASE_URL, 유효한 SUPABASE_SERVICE_ROLE_KEY, 기본값이 아닌 JWT_SECRET이 없으면 시작 시 즉시 실패한다. 운영 모드의 `dev-refresh-*` 토큰은 AUTH_INVALID로 거부한다.

### 슬랙식 스레드 (Run D)

메시지는 nullable UUID인 `parent_message_id`와 `root_message_id`로 트리를 구성한다. 일반 메시지는 두 값이 null이다. 답글 턴의 사용자 행은 지정한 부모를 가리키며, 공감·답변 행은 해당 사용자 행을 부모로 갖는다. 세 행의 root는 동일하다. 답글도 세션의 기존 `turn_index`를 소비하며 `UNIQUE(session_id, turn_index)`는 유지한다.

`GET /api/messages/:id`는 메시지 전체 행과 스레드 요약을 반환한다. 답글 ID도 자신의 root 기준으로 집계한다. 아래 예시는 행의 주요 필드만 표시한다.

```json
{"ok":true,"data":{"id":"루트 UUID","parent_message_id":null,"root_message_id":null,"dialogue_type":"info_card","structured_payload":{"title":"요약"},"thread_summary":{"reply_count":3,"last_reply_at":"2026-09-26T12:00:00.000Z"}}}
```

`GET /api/messages/:id/thread`는 root 전체 행과 turn_index 오름차순의 replies 전체 행 배열, reply_count를 반환한다. 답글 ID로 호출해도 같은 전체 스레드를 반환한다.

```json
{"ok":true,"data":{"root":{"id":"루트 UUID","dialogue_type":"info_card","structured_payload":{}},"replies":[{"id":"답글 UUID","parent_message_id":"루트 UUID","root_message_id":"루트 UUID","turn_index":3}],"reply_count":1}}
```

`POST /api/messages/:id/replies` 요청:

```json
{"content":"이 카드 내용을 더 설명해줘"}
```

응답은 HTTP 201이며 기존 `POST /api/sessions/:id/messages`의 모든 필드에 다음 thread 객체가 추가된다.

```json
{"thread":{"root_message_id":"루트 UUID","parent_message_id":"대상 메시지 UUID","reply_count":3}}
```

reply_count는 사용자·공감·답변을 포함해 저장된 답글 행 수다. 답글은 runTextTurn의 전체 뉴런 파이프라인과 같은 WS 발행 경로를 사용한다. LLM 이력은 해당 루트와 기존 답글에서 구성하며 기존 historyTurns 제한과 공감 메시지 제외 규칙을 적용한다. 다른 스레드나 일반 세션 메시지는 답변 이력에 포함하지 않는다. 빈 content는 400, archived 세션은 409이며, 메시지 없음·타 사용자 메시지는 404 NOT_FOUND다.

WS `message.send`에 선택 필드 `parent_message_id`를 보내면 같은 스레드 동작을 수행한다. 부모는 인증 사용자의 같은 세션 메시지여야 한다.

```json
{"type":"message.send","session_id":"세션 UUID","content":"추가 질문","parent_message_id":"부모 UUID"}
```

`message.new.message` 전체 행에 parent/root가 포함된다. `answer.done`과 `run.completed.message_ids` 형태는 유지한다.

### 하드포크와 계보 (Run D)

`POST /api/sessions/:id/fork` 요청:

```json
{"from_message_id":"포크 지점 UUID","new_session_title":"대안 검토"}
```

응답은 HTTP 201이다. session은 실제 신규 세션 전체 행이며 아래는 주요 필드 예시다. 선택 제목은 별도 컬럼 추가 없이 `metadata.title`에 저장한다.

```json
{"ok":true,"data":{"session":{"id":"새 세션 UUID","user_id":"소유자 UUID","agent_id":"기존 에이전트 UUID","persona_id":"기존 페르소나 UUID","status":"active","metadata":{"title":"대안 검토"},"forked_from":{"session_id":"원본 UUID","message_id":"포크 지점 UUID","turn_index":5,"forked_at":"2026-09-26T12:00:00.000Z"}},"copied":{"messages":6,"memories":1,"transcripts":1,"context_patches":4}}}
```

복제 범위와 원칙:

- 메시지는 원본 세션에서 포크 지점 turn_index 이하인 전체 행이다. 새 메시지 ID를 발급하고 parent/root를 새 ID로 치환한다. 카드 payload, STT, persona_guard 등 모든 나머지 컬럼은 유지한다.
- 압축 기억의 source_turn_range와 원본 트랜스크립트의 turn_range는 parseRangeUpper 결과가 포크 지점 이하인 행만 복제한다. 문자열 `[lower,upper)`와 기존 객체 `{lower,upper}` 모두 지원한다. 이 조건은 지정된 상한 자체의 비교이므로, 문자열 상한이 지점+1인 배치는 제외된다.
- context_patches는 시점 제한 없이 원본 세션 전체를 새 ID로 복제한다. 따라서 포크 지점 이후 생성된 컨텍스트도 포함될 수 있다. 동일 생성 시각은 패치 ID 순서로 재생한다.
- user_id, agent_id, persona_id를 유지한다. 페르소나 행 자체를 복제하지 않고 같은 버전을 참조한다. neuron_instances, neuron_connections, tasks, task_logs는 복제하지 않는다.
- 원본 불변·독립 진화: 원본 세션·메시지·기억·컨텍스트는 수정하지 않는다. 포크 이후 메시지와 패치는 새 세션에만 기록되고, 기존 세션 이력 로더가 복제 이력을 읽는다.
- 서버 프로세스 내 세션 락으로 턴 실행과 포크 스냅샷을 직렬화한다. 복사 실패 시 신규 행을 정리한다. 여러 PostgREST 요청으로 수행하므로 실DB 트랜잭션 단위의 원자성은 제공하지 않는다.

`GET /api/sessions/:id/lineage`는 가까운 조상부터 ancestors에 반환하며 forks는 직계 자식 세션 전체 행 배열이다.

```json
{"ok":true,"data":{"ancestors":[{"session_id":"부모 UUID","message_id":"부모의 분기 메시지 UUID","turn_index":5,"forked_at":"2026-09-26T12:00:00.000Z"}],"forks":[{"id":"직계 자식 UUID","forked_from":{"session_id":"현재 세션 UUID","message_id":"현재 세션의 분기 메시지 UUID","turn_index":8,"forked_at":"2026-09-26T12:10:00.000Z"}}]}}
```

조상 추적은 visited set으로 순환을 차단하고 최대 50단계로 제한한다. 다른 소유자의 세션은 계보 조회에 노출하지 않는다. 포크 지점 메시지가 원본 세션에 없으면 404다.

마이그레이션은 `002_rls_hardening.sql` 끝에 추가했다. sessions의 기존 `UNIQUE(user_id, agent_id)`를 제거하고 `forked_from ->> 'session_id' IS NULL`인 원본 세션만 부분 유니크 인덱스로 보호한다. 포크 세션은 예외다. ensureSession은 여러 세션 중 forked_from.session_id가 없는 원본만 반환한다. 실DB 적용은 별도 감독 작업이다.

### i18n 계약 (Run E)

지원 로케일은 `ko | en`이며 기본값은 `DEFAULT_LOCALE` 환경변수(기본 `ko`)다.

- **REST 수신**: `Accept-Language` 헤더의 첫 태그를 정규화한다(`en-US,en;q=0.9` → `en`). 미지원/없음 → 기본값.
- **WS 수신**: 연결 쿼리 `locale` → 연결 `Accept-Language` 헤더 → 기본값 순서. `subscribe.locale`로 연결 중 변경 가능.
- **LLM 언어 지시**: 시스템 프롬프트 마지막에 `Respond in {한국어|English}.`를 항상 append한다(persona 프롬프트보다 후순위 고정).
- **run.* quip**: `run.progress.stage`는 언어 중립 코드(`thinking|organizing|finalizing|rendering`)를 유지하고, `quip`·`empathy_response`는 요청 로케일 문구를 담는다. 표시 번역의 1차 책임은 프론트 i18n(stage 코드 기반)이며 quip은 폴백이다.
- **메시지 행**: `locale TEXT NOT NULL DEFAULT 'ko'`, `ai_generated BOOLEAN NOT NULL DEFAULT false` 컬럼 추가(002). 사용자/공감/답변 행 모두 요청 로케일로 저장하며, 에이전트 생성 행(source_neuron != null 또는 role=agent/assistant)은 `ai_generated: true`(AI 기본법 제31조 표시 의무 — 프론트 배지 연동). REST 행·`message.new.message`·`answer.done`·턴 결과에 포함.
- **에러 i18n**: 서버 응답의 `code`(대문자 스네이크)가 번역 키이고 `message`는 한국어 폴백이다. 신규 코드: `CONSENT_REQUIRED`, `AGE_CONFIRM_REQUIRED`.

### 법률 인프라 (Run E — 개인정보보호법·AI 기본법)

**가입 동의 검증** — `POST /api/auth/signup` body 확장:

```json
{"email":"...","password":"***","age_confirmed":true,
 "consents":[{"type":"terms","version":"1.0","consented":true},
             {"type":"privacy","version":"1.0","consented":true},
             {"type":"voice_recording","version":"1.0","consented":true},
             {"type":"overseas_transfer","version":"1.0","consented":true},
             {"type":"marketing","version":"1.0","consented":false}]}
```

필수 4종(terms/privacy/voice_recording/overseas_transfer) 모두 `consented: true` + `age_confirmed: true`(만 14세) 아니면 400(`CONSENT_REQUIRED`/`AGE_CONFIRM_REQUIRED`). marketing은 선택. 동의 이력은 `consents` 테이블(user_id/consent_type/version/consented/ip_or_device/created_at, RLS 자기 열람)에 기록되며, 기록 실패 시 발급된 계정을 즉시 삭제한다(동의 없는 계정 미발급). **DEV_MODE=true에서만** consents 필드 전체 생략 시 `version: 'dev-auto'`로 자동 기록(스모크 호환) — 운영 모드는 strict 거부.

**회원탈퇴** — `DELETE /api/me` (requireAuth): auth.users 삭제 → FK ON DELETE CASCADE로 users/agents/personas/sessions/messages/raw_transcripts/compressed_memories/tasks/consents/context_patches/skills(작성자) 등 전 파기(개인정보보호법 제21조). 실행 중 턴은 세션 락으로 마무리 대기 후 삭제하고, 삭제 후 해당 사용자의 WS 연결·이벤트 버퍼를 정리한다. 응답 `{ok:true,data:{deleted:true}}`. DEV_MODE에서는 devstore cascade 시뮬레이션(`deleteDevUser`).

**전문가 디스클레이머** — 에이전트 태그/이름/프롬프트가 법률·세무/회계·의료 계열이면(`classifyExpertise` 순수함수) 응답 끝에 로케일별 면책 문구 append(예 ko: "본 응답은 AI가 생성한 정보이며 정식 법률 자문이 아닙니다."). 일반 에이전트는 미부착.

**raw_transcripts 보존 정책** — `RAW_TRANSCRIPT_RETENTION_DAYS`(기본 180일)을 config로 선언하고 탈퇴 시 즉시 파기. 자동 삭제 크론은 Phase 3(코드 주석 명시).
