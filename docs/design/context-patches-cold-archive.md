# context_patches Storage 콜드 아카이브 설계 초안 (A6)

- 카드: t_8ef66bb0 (D1/A4/A5/A6, 9/26)
- 작성: 백개발 (직접 작성, Codex 미경유) — 2026-09-26
- 상태: 설계 초안. 구현 마이그레이션 미포함 — 승인 후 별도 카드로 분할한다.

## 1. 문제 (실패로그 A6)

`context_patches`는 append-only 감사 로그로 매 턴마다 여러 행이 쌓인다
(src/lib/contextSync.ts — set/append 연산마다 INSERT, 세션 생성 시점부터 무한 증가).
001의 인덱스는 `(session_id, key, created_at DESC)` 하나뿐이라 행 자체는 작아도
장기 세션·장기 가입 사용자에서 테이블이 단조 증가하고, 세션 목록/포크 경로
(sessions.ts fork가 `context_patches` 전체를 selectAllRows로 읽음)가 커진 테이블에
직격탄을 맞는다. 세션 삭제 시 ON DELETE CASCADE로 지워지지만 세션이 삭제되지
않는 한 보존·성능 문제가 모두 남는다.

## 2. 목표 / 비목표

목표:
- hot 존을 "최근 컨텍스트 복원에 필요한 패치"로 한정해 fork·resume 경로의 읽기 비용을 상한화한다.
- 원본 데이터는 무손실로 보존한다 (DELETE/DROP 금지 원칙 — 이관 후에도 소스 행 제거는 2단계 승인 절차).
- 사용자·세션 단위 복구가 가능해야 한다 (감사 로그로서의 존재 이유 유지).

비목표 (이번 초안에서 명시적으로 보류):
- raw_transcripts / compressed_memories의 아카이브 (동일 프레임워크 재사용은 Phase 2).
- 자동 삭제(보존 초과 파기) — config.retention이 선언만 하고 크론이 없는 것과 같은 정책: 파기는 Phase 3.

## 3. 설계

### 3.1 경계 (hot/cold split)

- hot 존: 세션당 `created_at >= now() - HOT_WINDOW` (기본 90일, 환경변수
  CONTEXT_PATCH_HOT_DAYS) OR 키가 `conversation.summary`/`persona.state`인 최근 1행.
  → 복원 데드라인이 없는 감사·디버깅용 과거 패치는 cold로 내린다.
- cold 존: Supabase Storage 버킷 `context-archive`에 세션·월 단위 NDJSON 객체.
  - 경로: `context-archive/{year}/{month}/session={session_id}.ndjson.gz`
    (세션 단위로 묶는 이유: 읽기 접근이 전부 session_id 경유 — fork·resume·감사 조회.
     월 파티션은 객체 수 상한과 수명주기 정책(Lifecycle) 적용 단위.)
  - 레코드 포맷(1행 = 1패치, 원본 컬럼 1:1):
    {"id":12345,"session_id":"uuid","key":"...","operation":"append","delta":{...},"source_neuron":"...","created_at":"ISO8601"}
  - gzip: delta jsonb는 텍스트 반복이 많아 평균 6~10배 압축. NDJSON 선택 — 스트리밍
    읽기/쓰기 가능, pg_dump-free 복구, 행 단위의 부분 파싱.

### 3.2 인덱스 테이블 (restore 및 조회 메타데이터)

cold 객체 자체는 SQL로 조인할 수 없으므로 최소 메타를 DB에 남긴다 (신규 마이그레이션 007 후보):

CREATE TABLE context_patch_archives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    bucket TEXT NOT NULL DEFAULT 'context-archive',
    object_path TEXT NOT NULL,           -- 위 경로 규칙
    patch_count INTEGER NOT NULL,        -- 검증 게이트용 (이관 전 SELECT count와 대조)
    min_created_at TIMESTAMPTZ NOT NULL,
    max_created_at TIMESTAMPTZ NOT NULL,
    bytes_compressed BIGINT NOT NULL,
    checksum_sha256 TEXT NOT NULL,       -- 객체 본문 해시 (손상 감지)
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at TIMESTAMPTZ,             -- read-back 검증 완료 시각 (NULL = 미검증, 삭제 후보 금지)
    UNIQUE (object_path)
);

- sessions ON DELETE CASCADE 유지: 회원 탈퇴/세션 삭제 시 아카이브 인덱스 행도 사라지고,
  Storage 객체는 5.절의 가비지 수집 절차로 later 정리 ( orphan 객체 = 수동 회수 큐 ).
- RLS: 002 원칙 유지 — authenticated SELECT 전용(자기 세션 경유), 쓰기 service_role.

### 3.3 아카이브 잡 (crond 또는 백그라운드 워커)

1. 대상 선출: hot 조건을 만족하지 않는 패치 중 `created_at < now() - SAFETY_LAG`(24h)인 것.
   SAFETY_LAG가 필요한 이유: 방금 쓰인 행을 읽으면 트래픽 재현窗口와 겹쳐 이관-쓰기 레이스가 생긴다.
2. 세션×월 단위로 묶어 NDJSON 생성 → gzip → Storage 업로드 (service_role, 버킷은 private, 업로드만 허용).
3. 검증(read-back — '햇빛' 금지 게이트):
   a. 다운로드 → sha256이 업로드 시 계산값과 일치,
   b. NDJSON 행 수 = 대상 SELECT count,
   c. 무작위 N개 id의 delta 원문 일치.
   통과 시 context_patch_archives.verified_at 기록.
4. verified_at가 있는 배치에 한해 hot 테이블에서 DELETE — 이 DELETE가 전체 설계에서
   유일한 파기 동작이며, 검증 실패 배치는 절대 도달하지 못한다. (카드 "DELETE/DROP 금지"는
   데이터 손실 금지를 뜻하므로: 무손실 검증 후 이관 완료 삭제만 예외로 인정. 승인은 7절.)

### 3.4 읽기 경로 (투명 페치)

contextSync.ts의 패치 조회 지점(최근 N개 윈도우)에 cold 폴백을 얹는다:
- hot에서 부족하면 context_patch_archives로 해당 세션 객체 경로를 찾고,
  Storage에서 받아 메모리 캐시(LRU, 세션당 1객체)에 두고 병합.
- fork(sessions.ts)는 hot+cold 전량을 합쳐 복제하되, 복제본 cold 객체는 새로 생성(원본 객체 공유 금지 —
  session_id가 키에 박혀 있어 공유하면 소유권 혼입).
- API 응답에는 hot/cold 구분 없이 동일 스키마로 합쳐 반환(프론트 무변경).

### 3.5 수명주기/복구

- Storage Lifecycle: cold 객체 기본 무기한 보존. 파기 정책은 Phase 3(규정 검토 후)에서
 Retention 테이블과 함께 결정 — config.retention.rawTranscriptDays와 동일한 선언만 선비치.
- 복구 절차: 세션 단위 "restore session X" → 인덱스 행 조회 → 객체 다운로드 → checksum/행수
  재검증 → hot 테이블 재INSERT(id는 BIGSERIAL 재발급, 원 id는 payload에 보존). restore는
  역추적 감사 대상(로그 남김).

## 4. 대안 기각

- pg_partman/파티션: 001~005의 평범한 인라인 DDL 절차(김비서 supabase db push 관례)와
  맞지 않고, 파티션 유지보수 권한이 managed Supabase에서 제한적. 행 감소 목표는 Storage
  이관이 더 강함.
- 테이블 유지 + created_at 인덱스만 추가: 읽기 비용은 완화되나 storage 무한 증가(A6의 본질) 미해결.
- delta를 jsonb 그대로 타 테이블로 이동: "cold도 DB"라 총량 문제가 남는다. Storage가 목적이므로 기각.

## 5. 위험과 완화

| 위험 | 완화 |
|------|------|
| 이관 중 동일 세션 쓰기 레이스 | SAFETY_LAG 24h + 세션 단위 배치 (hot는 항상 최신 윈도우라 데이터 정합성 창 없음) |
| Storage 유실 | sha256 read-back + verified_at 전까지 원본 삭제 금지. Supabase Storage 자체 S3 중복 보존 |
| 객체 수 폭발(세션×월) | 월 단위 묶음 기준 추정: DAU 1천·세션 1만/월 → 월 객체 ≤1만, Lifecycle 사전 정리 가능 |
| fork 시 cold 합치기 지연 | 세션당 객체 1개 스트리밍 + LRU 캐시. fork 자체는 저빈도 |
| 고아 객체(세션 삭제 후) | 인덱스 CASCADE로 목록은 남지 않음: 주 1회 "미인용 객체" 리스트 잡 → 김비서 승인 후 정리 (자동 삭제 없음) |

## 6. 관측 지표 (잡에 계측 포함)

- moved_rows_total / verify_failed_total / restore_total 카운터,
- hot 테이블 최대 세션 패치 수 (p99), Storage 월 비용(객체×평균 bytes).

## 7. 구현 분할 제안 (승인 시 카드화)

1. 백개발: 007 마이그레이션(archives 테이블+RLS) + 이관/검증 잡 스켈레톤 + NDJSON 코덱 (단위 테스트).
2. 백개발: contextSync/fork 투명 페치 + 읽기 회귀 테스트 (devstore에 cold 스텁은 넣지 않는다 — 006 감사에서 확인된 devstore/live divergence 재발 방지: cold는 live 전용 기능, devstore는 hot 단일 존 유지).
3. 김비서: 실DB apply(002~006 관례 동일) + 첫 배치 수동 승인 + DELETE 예외 조항 승인.
4. (Phase 3 별도) 파기/retention 크론, raw_transcripts 확장.

## 8. 참고

- supabase/migrations/001_initial_schema.sql §17 (context_patches 정의)
- src/lib/contextSync.ts (쓰기·조회 지점), src/routes/sessions.ts fork 경로
- docs/setup/frontend-backend-agent-guide.md, 실패로그 A6 (9/26)
- 006_prod_seed.sql 감사 메모: devstore 기본 시드 불일치(스킬 3종) — cold 존 devstore 미구현 근거와 동일 계열
