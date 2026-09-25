# 에이전트톡 뉴런(Neuron) 구조 기술 설계 문서

> **작성일:** 2026-09-25
> **문서 유형:** 기술 설계서 (Technical Design Document)
> **기반 문서:** worldofagents-whitepaper.md (백서 3.3절·4.6절), agenttalk-modern-ux-plan.md
> **기술 스택:** LangGraph, Temporal.io, Supabase (Postgres), Stream Chat SDK, Whisper v3 Turbo
> **상태:** 초안 (Draft) — 구현 전 대표님 재확인 필요 영역 표시

---

## 목차

1. [개요 및 설계 목표](#1-개요-및-설계-목표)
2. [뉴런 유형 체계](#2-뉴런-유형-체계)
3. [동적 연결/해제 프로토콜](#3-동적-연결해제-프로토콜)
4. [통합 페르소나 유지 메커니즘](#4-통합-페르소나-유지-메커니즘)
5. [LangGraph + Temporal.io 오케스트레이션](#5-langgraph--temporalio-오케스트레이션)
6. [뉴런 간 컨텍스트 동기화](#6-뉴런-간-컨텍스트-동기화)
7. [확장 가능한 뉴런 유형 (Custom 뉴런)](#7-확장-가능한-뉴런-유형-custom-뉴런)
8. [기술 스택 통합 설계](#8-기술-스택-통합-설계)
9. [데이터 모델](#9-데이터-모델)
10. [장애 처리 및 회복](#10-장애-처리-및-회복)
11. [성능 목표 및 측정 지표](#11-성능-목표-및-측정-지표)
12. [구현 로드맵](#12-구현-로드맵)

---

## 1. 개요 및 설계 목표

### 1.1 뉴런 구조란

뉴런 구조는 하나의 에이전트(그림자 에이전트) 내부를 여러 역할별 하위 유닛으로 분할하는 아키텍처다. 백서에서는 이 하위 단위를 "에이전트"가 아닌 **"에이뉴런(Artificial Neuron)"**이라고 부른다 — 뇌 하나 안에서 함께 일하는 뉴런들의 은유다.

핵심 제약은 하나: **내부에 뉴런이 몇 개가 있든, 사용자에게는 항상 하나의 인격으로 보여야 한다.**

### 1.2 설계 목표

| 목표 | 정의 | 측정 기준 |
|------|------|-----------|
| 단일 페르소나 | 어떤 뉴런이 응답하든 같은 이름·목소리·말투 | 사용자 설문 "여러 명이 답하는 것처럼 느꼈는가?" — 아니오 ≥ 95% |
| 동적 연결 | 대화 상황에 맞춰 뉴런이 실시간 활성화/비활성화 | 불필요 뉴런 0 상태로 유지, 필요 시 < 200ms 내 활성화 |
| 끊김 없는 대화 | 답변 생성이 오래 걸려도 대화 흐름이 멈추지 않음 | 사용자 추가 입력 후 첫 응답 < 500ms (공감 에이뉴런) |
| 확장성 | Custom 뉴런을 스킬 마켓 통해 추가 가능 | 뉴런 등록 → 활성화 < 5분 (보안 검사 통과 후) |

### 1.3 백서 원칙과의 대응

| 백서 절 | 원칙 | 이 문서의 구현 |
|---------|------|----------------|
| 3.3절 | 여러 프로세스, 하나의 인격 | §4 통합 페르소나 메커니즘 |
| 3.3절 | 에이뉴런 4종 (초기 가설) | §2 뉴런 유형 체계 |
| 3.3절 | 동적 연결, 실측 기반 튜닝 | §3 동적 연결/해제 프로토콜 |
| 4.6절 | 비동기 지속 처리 | §5 오케스트레이션 설계 |
| 4.0절 | 관계 기반 세션 라우팅 | §6 컨텍스트 동기화 |
| 1.3절 | 스킬 마켓 생태계 | §7 Custom 뉴런 |

---

## 2. 뉴런 유형 체계

### 2.1 기본 뉴런 4종 (초기 가설)

백서 3.3절에서 정의한 4종을 그대로 따른다. 단, 이는 **고정값이 아닌 초기 가설**이며 실측 후 통합/축소 가능하다.

#### ① 공감 에이뉴런 (Empathy Neuron)

| 항목 | 내용 |
|------|------|
| **역할** | 사용자 입력을 즉시 인지하고 공감 반응을 생성 |
| **트리거** | 사용자 메시지 수신 즉시 (STT 완료 시점) |
| **응답 시간** | < 500ms (STT 완료 후) |
| **모델** | 경량 LLM (예: GPT-4o-mini 또는 동급, 토큰 비용 최적화) |
| **출력** | 복명복창 + 공감 문장 ("~라고 말씀하신 걸 보면…") |
| **페르소나 톤** | MBTI F(감정형) — 따뜻하고 수용적인 어조 |
| **상태** | 상시 활성 (항상 깨어 있는 유일한 뉴런) |

**핵심 동작:**
```
사용자: "내일 회의 자료 좀 정리해줘, 특히 Q3 매출 관련해서"

공감 에이뉴런 (즉시):
"Q3 매출 자료 정리하시는구나, 내일 회의 준비하셔야겠어요. 바로 정리해드릴게요."
```

공감 에이뉴런은 실제 답변을 만들지 않는다. "받았다"는 신호를 보내고, 답변생성 에이뉴런에 작업을 위임한다.

#### ② 답변생성 에이뉴런 (Answer-Prep Neuron)

| 항목 | 내용 |
|------|------|
| **역할** | 사용자 요청에 대한 실질적 답변 생성 |
| **트리거** | 공감 에이뉴런으로부터 작업 위임 수신 |
| **응답 시간** | 첫 토큰 < 2s, 전체 완료는 요청 복잡도에 따라 |
| **모델** | 고성능 LLM (예: GPT-4o, Claude Sonnet, 상황에 따라 라우팅) |
| **출력** | 스트리밍 텍스트 + 구조화된 데이터 |
| **페르소나 톤** | 통합 페르소나 설정 따름 (§4) |
| **상태** | 필요 시 활성화, 작업 완료 후 유휴 |

**스트리밍 선공개:** 답변이 길어질 경우, 시간순으로 완성된 부분을 공감 에이뉴런이 중간 전달한다.

**조기 위임:** 표·인포그래픽이 필요하다고 판단되는 순간, 답변 전체 완성을 기다리지 않고 즉시 비주얼 에이뉴런에 위임한다.

```python
# 답변생성 에이뉴런 내부 의사코드
async def generate_answer(context: DialogContext) -> AsyncGenerator:
    plan = await plan_response(context)

    if plan.needs_visual:
        # 조기 위임: 비주얼 에이뉴런에 즉시 작업 할당
        await neuron_bus.dispatch(
            target="visual",
            task=VisualTask(type=plan.visual_type, data=plan.partial_data),
            priority="high"
        )

    async for chunk in stream_response(plan):
        yield chunk
        # 완성된 부분을 공감 에이뉴런이 중간 전달할 수 있도록 이벤트 발행
        await neuron_bus.emit("answer_chunk", chunk)
```

#### ③ 큐 에이뉴런 (Queue & De-escalation Neuron)

| 항목 | 내용 |
|------|------|
| **역할** | 끼어든 입력의 성격 판별 → 병합 or 큐잉 |
| **트리거** | 기존 답변 생성 중 사용자 추가 입력 수신 |
| **응답 시간** | 판별 < 300ms |
| **모델** | 경량 분류 모델 + LLM (이중 구조) |
| **출력** | 병합 결정 / 큐 순서 조정 / 사용자 진정 메시지 |
| **페르소나 톤** | 통합 페르소나 설정 따름 |
| **상태** | 다른 뉴런 활성 중일 때 대기 상태로 활성화 |

**이중 판별 구조:**

```
사용자 추가 입력 수신
    │
    ▼
[1단계: 경량 분류기] (< 100ms)
    │
    ├── 관련 추가/수정 → [2단계: 병합 판별]
    │       │
    │       └── 답변생성 에이뉴런 진행 중 작업에 patch
    │
    └── 별개 토픽 / 긴급 건 → 큐에 순서대로 적재
            │
            └── 사용자 진정 메시지 생성
                ("이전 질문 답변 중이에요, 이어서 처리해드릴게요")
```

**patch 병합 의사코드:**
```python
async def handle_interruption(
    current_task: AnswerTask,
    new_input: UserMessage
) -> InterruptionResult:
    # 1단계: 경량 분류 (semantic similarity + intent classifier)
    classification = await lightweight_classifier.classify(
        current_topic=current_task.topic,
        new_input=new_input.text
    )

    if classification.is_related:
        # 2단계: 병합 가능 여부 판단
        merge_plan = await llm.judge_merge(
            current_progress=current_task.progress,
            new_request=new_input.text
        )
        if merge_plan.feasible:
            # 진행 중인 생성 작업에 실시간 patch
            await current_task.patch(merge_plan.instructions)
            return InterruptionResult(action="merged", message=None)

    # 별개 토픽: 큐에 적재
    await queue.enqueue(new_input, priority=classification.urgency)
    return InterruptionResult(
        action="queued",
        message="이전 답변 먼저 마무리하고 바로 이어서 처리해드릴게요."
    )
```

#### ④ 비주얼 에이뉴런 (Visual/Infographic Neuron)

| 항목 | 내용 |
|------|------|
| **역할** | 표, 차트, 인포그래픽 등 시각 산출물 생성 |
| **트리거** | 답변생성 에이뉴런의 조기 위임 / 사용자 직접 요청 |
| **응답 시간** | 첫 프리뷰 < 3s, 최종 완료 < 15s |
| **모델** | 코드 생성 LLM + 렌더링 파이프라인 (HTML/SVG → 이미지) |
| **출력** | 스트리밍 이미지/컴포넌트 |
| **페르소나 톤** | 산출물 자체는 페르소나 중립, 안내 문구는 통합 페르소나 |
| **상태** | 필요 시 활성화 |

**진행 안내:** 비주얼 생성 중일 때 "이미지 준비 중이니 조금만 기다려주세요" 같은 중간 안내를 담당한다. 이 안내 문구도 통합 페르소나의 말투를 따른다.

### 2.2 뉴런 상태 머신

모든 뉴런은 다음 상태를 가진다:

```
         activate()
  ┌─────┐ ──────────► ┌────────┐
  │ IDLE │             │ ACTIVE │
  └─────┘ ◄────────── └───┬────┘
    ▲        deactivate() │
    │                     │ start_processing()
    │                     ▼
    │              ┌────────────┐
    │   complete() │ PROCESSING │
    └──────────────└────────────┘
                         │
                         │ error
                         ▼
                    ┌─────────┐
                    │ DEGRADED │
                    └─────────┘
```

| 상태 | 의미 | 전환 조건 |
|------|------|-----------|
| `IDLE` | 비활성, 리소스 미할당 | 초기 상태 / deactivate() 호출 |
| `ACTIVE` | 활성, 입력 대기 | activate() 호출 |
| `PROCESSING` | 작업 처리 중 | 입력 수신 / 작업 위임 |
| `DEGRADED` | 오류 발생, 폴백 동작 중 | 처리 실패 / 타임아웃 |

---

## 3. 동적 연결/해제 프로토콜

### 3.1 설계 원칙

백서의 핵심 방향: **"3~4개의 고정된 에이전트 역할"이 아니라, 필요에 따라 유동적으로 연결/해제되는 구조.**

- 기본 4종은 **상시 활성이 아니라 필요 시에만 활성화**
- 공감 에이뉴런만 예외적으로 상시 활성 (사용자 입력을 가장 먼저 받는 진입점)
- 뉴런 활성화/비활성화 판단은 **오케스트레이터가 자동 수행**

### 3.2 연결 라이프사이클

```
┌──────────────────────────────────────────────────────────┐
│                 뉴런 연결 라이프사이클                       │
│                                                          │
│  1. DISCOVER  → 필요한 뉴런 유형 식별                       │
│  2. ACTIVATE  → 뉴런 인스턴스 생성/할당                     │
│  3. CONNECT   → 뉴런 버스(Neuron Bus)에 등록               │
│  4. OPERATE   → 메시지 송수신, 컨텍스트 공유                 │
│  5. DISCONNECT → 연결 해제, 상태 정리                       │
│  6. DEACTIVATE → 리소스 반환                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 3.3 활성화 판단 로직 (Router)

오케스트레이터 내의 **Router**가 사용자 입력을 분석해 필요한 뉴런 조합을 결정한다.

```python
class NeuronRouter:
    """사용자 입력을 분석해 필요한 뉴런 조합을 결정하는 라우터."""

    # 뉴런 활성화 규칙 (규칙 기반 + LLM 폴백)
    RULES = [
        # 모든 대화: 공감 에이뉴런은 항상 활성
        Rule(always_active=["empathy"]),

        # 질문/요청 감지 시: 답변생성 에이뉴런 활성화
        Rule(
            trigger=lambda msg: msg.has_question or msg.has_request,
            activate=["answer"]
        ),

        # 시각적 산출물 필요 시: 비주얼 에이뉴런 활성화
        Rule(
            trigger=lambda msg: msg.needs_visual_output,
            activate=["visual"]
        ),

        # 기존 작업 진행 중 추가 입력: 큐 에이뉴런 활성화
        Rule(
            trigger=lambda msg, ctx: ctx.has_active_task and msg.is_interruption,
            activate=["queue"]
        ),
    ]

    async def route(self, message: UserMessage, context: DialogContext) -> NeuronActivationPlan:
        """메시지와 컨텍스트를 분석해 활성화할 뉴런 목록을 반환."""
        plan = NeuronActivationPlan()

        # 규칙 기반 판별
        for rule in self.RULES:
            if rule.matches(message, context):
                plan.activate.extend(rule.activate)

        # 규칙으로 판단 안 되는 경우는 LLM으로 판별
        if plan.is_empty():
            plan = await self.llm_classify(message, context)

        # 커스텀 뉴런 검사 (§7)
        plan.activate.extend(await self.check_custom_neurons(message, context))

        return plan.deduplicate()
```

### 3.4 연결/해제 프로토콜 메시지

뉴런 간 통신은 **Neuron Bus**를 통해 이루어진다. 메시지는 이벤트 기반으로 발행/구독된다.

```typescript
// 뉴런 버스 이벤트 유형
type NeuronEvent =
  | { type: "neuron.activate";   neuronId: string; config: NeuronConfig }
  | { type: "neuron.deactivate"; neuronId: string; reason: string }
  | { type: "neuron.connect";    sourceId: string; targetId: string; channel: string }
  | { type: "neuron.disconnect"; sourceId: string; targetId: string }
  | { type: "neuron.message";    from: string; to: string; payload: any }
  | { type: "neuron.context";    neuronId: string; update: ContextDelta }
  | { type: "neuron.error";      neuronId: string; error: NeuronError }
  | { type: "neuron.status";     neuronId: string; status: NeuronStatus };

// 연결 프로토콜 시퀀스
interface ConnectionHandshake {
  // 1. 오케스트레이터 → 뉴런: 활성화 요청
  activateRequest: {
    neuronId: string;
    personaId: string;       // 통합 페르소나 ID
    sessionKey: string;      // (user_id, agent_id) 세션 키
    initialContext: Partial<DialogContext>;
  };

  // 2. 뉴런 → 오케스트레이터: 준비 완료
  readyAck: {
    neuronId: string;
    capabilities: string[];  // 이 뉴런이 처리 가능한 작업 유형
    estimatedLatency: number; // 예상 응답 시간 (ms)
  };

  // 3. 오케스트레이터 → Neuron Bus: 연결 등록
  registration: {
    neuronId: string;
    subscriptions: string[]; // 구독할 이벤트 채널
    publishChannels: string[]; // 발행할 이벤트 채널
  };
}
```

### 3.5 비활성화 조건

| 조건 | 트리거 | 동작 |
|------|--------|------|
| 작업 완료 | 뉴런의 현재 작업 완료 + 후속 작업 없음 | 30초 대기 후 IDLE 전환 |
| 타임아웃 | 활성화 후 N초 내 입력 없음 | 설정된 idle_timeout 후 IDLE |
| 리소스 압박 | 시스템 메모리/CPU 임계치 초과 | 우선순위 낮은 뉴런부터 순차 비활성화 |
| 명시적 해제 | 오케스트레이터 판단 또는 사용자 요청 | 즉시 DISCONNECT → DEACTIVATE |
| 오류 연속 | 동일 뉴런 3회 연속 실패 | DEGRADED → 관리자에게 알림 |

### 3.6 동적 연결 예시: 전체 시나리오

```
시나리오: "Q3 매출 정리해줘, 표로 만들어줘" → 중간에 "아, 그리고 어제 보낸 이메일 답장도 써줘"

[T=0ms]   사용자 음성 입력 시작
[T=1200ms] Whisper v3 Turbo STT 완료 → 텍스트 변환
[T=1250ms] Router 판별: 공감 + 답변 + 비주얼 활성화
[T=1260ms] 공감 에이뉴런 (상시 활성): "Q3 매출 표로 정리하시는구나, 바로 해드릴게요."
[T=1300ms] 답변생성 에이뉴런 ACTIVATED → Q3 매출 데이터 수집 시작
[T=1500ms] 비주얼 에이뉴런 ACTIVATED → 조기 위임 수신, 표 생성 시작
[T=3000ms] 비주얼: 표 프리뷰 스트리밍 시작
[T=5000ms] 사용자 추가 입력: "아, 그리고 어제 보낸 이메일 답장도 써줘"
[T=5050ms] Router 판별: 큐 에이뉴런 활성화
[T=5100ms] 큐 에이뉴런: 별개 토픽 판별 → 큐에 적재
           "메일 답장은 매출 정리 끝나고 바로 이어서 할게요."
[T=8000ms] 비주얼: 표 완성 → 사용자에게 전달
[T=8100ms] 답변생성: 이메일 답장 생성 시작 (큐에서 꺼냄)
[T=8200ms] 큐 에이뉴런 DEACTIVATED (할 일 완료)
[T=12000ms] 이메일 답장 완료
[T=12100ms] 비주얼 에이뉴런 IDLE 전환 (30초 후 비활성화 대기)
```

---

## 4. 통합 페르소나 유지 메커니즘

### 4.1 핵심 문제

여러 뉴런이 각각 응답을 생성하면, 같은 사람이 말하는 것처럼 느껴야 하는데 톤·어조·표현이 달라질 수 있다. **사용자는 하나의 인격과 대화한다고 느껴야 한다** — 이건 타협 불가능한 제약이다 (백서 3.3절).

### 4.2 페르소나 레이어 아키텍처

```
┌─────────────────────────────────────────────────┐
│              Unified Persona Layer               │
│                                                 │
│  ┌─────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ Voice Config │ │ Tone Rules │ │ Style Guide│ │
│  │ (목소리 톤)  │ │ (말투 규칙) │ │ (표현 가이드)│ │
│  └──────┬──────┘ └─────┬──────┘ └─────┬──────┘ │
│         └──────────────┼──────────────┘         │
│                        │                        │
│              ┌─────────┴─────────┐              │
│              │  Persona Context  │              │
│              │   (통합 컨텍스트)  │              │
│              └─────────┬─────────┘              │
└────────────────────────┼────────────────────────┘
                         │ 주입
         ┌───────────────┼───────────────────┐
         │               │                   │
    ┌────┴────┐    ┌─────┴─────┐       ┌────┴────┐
    │ 공감     │    │ 답변생성   │  ...  │ 비주얼   │
    │ 에이뉴런 │    │ 에이뉴런   │       │ 에이뉴런 │
    └─────────┘    └───────────┘       └─────────┘
```

### 4.3 페르소나 컨텍스트 구조

```python
@dataclass
class PersonaConfig:
    """하나의 에이전트에 대한 통합 페르소나 설정."""

    # 기본 정보
    persona_id: str
    name: str                       # 에이전트 이름 (사용자에게 보이는)
    avatar_url: str

    # 목소리 설정 (TTS용)
    voice: VoiceConfig
    # voice_id, speed, pitch, language

    # 말투 규칙 (LLM 프롬프트에 주입)
    tone: ToneConfig
    # formality: "formal" | "casual" | "friendly"
    # emoji_usage: "never" | "rare" | "frequent"
    # sentence_length: "short" | "medium" | "long"
    # honorific_level: 0-5 (한국어 존댓말 단계)

    # 스타일 가이드 (few-shot 예시 포함)
    style_guide: StyleGuide
    # example_responses: List[ExampleResponse]
    # forbidden_expressions: List[str]
    # preferred_expressions: List[str]
    # personality_traits: List[str]  (MBTI, 특성 등)

    # 동적 컨텍스트
    relationship_context: RelationshipContext
    # user_relationship: str (친구, 비서, 동료 등)
    # conversation_history_summary: str
    # recent_mood: str

    # 뉴런별 오버라이드 (제한적)
    neuron_overrides: Dict[str, NeuronToneOverride]
    # 공감 뉴런: warmth +20%
    # 답변 뉴런: precision +10%
    # 단, 오버라이드는 "정도"만 조절, 기본 말투를 바꾸진 않음


@dataclass
class NeuronToneOverride:
    """특정 뉴런의 톤을 미세 조정 (페르소나 변경 아님)."""
    warmth_delta: float      # -1.0 ~ 1.0
    formality_delta: float   # -1.0 ~ 1.0
    verbosity_delta: float   # -1.0 ~ 1.0
    allowed_prefixes: List[str]  # 이 뉴런이 사용할 수 있는 시작 표현
```

### 4.4 페르소나 주입 방식

모든 뉴런은 응답 생성 시 **동일한 페르소나 시스템 프롬프트**를 받는다. 차이점은 뉴런별 오버라이드뿐이다.

```python
def build_persona_prompt(config: PersonaConfig, neuron_type: str) -> str:
    """뉴런 유형에 맞는 페르소나 시스템 프롬프트를 생성."""

    base_prompt = f"""
당신은 "{config.name}"입니다.

[말투 규칙]
- 격식: {config.tone.formality}
- 이모지: {config.tone.emoji_usage}
- 문장 길이: {config.tone.sentence_length}
- 존댓말 수준: {config.tone.honorific_level}

[성격]
{chr(10).join(f"- {t}" for t in config.style_guide.personality_traits)}

[사용하면 좋은 표현]
{chr(10).join(f"- {e}" for e in config.style_guide.preferred_expressions)}

[사용 금지 표현]
{chr(10).join(f"- {e}" for e in config.style_guide.forbidden_expressions)}

[사용자와의 관계]
{config.relationship_context.user_relationship}
"""

    # 뉴런별 오버라이드 적용
    override = config.neuron_overrides.get(neuron_type)
    if override:
        base_prompt += f"""
[현재 역할 조정]
- 따뜻함: {override.warmth_delta:+.1f}
- 정밀함: 기본 유지
- 허용 시작 표현: {', '.join(override.allowed_prefixes)}
"""

    # few-shot 예시 추가
    for example in config.style_guide.example_responses[:3]:
        base_prompt += f"""
[예시]
사용자: {example.user_input}
{config.name}: {example.agent_response}
"""

    return base_prompt
```

### 4.5 응답 후 검증 (Persona Guard)

생성된 응답이 페르소나에 맞는지 자동 검증하는 사후 검사 단계를 둔다.

```python
class PersonaGuard:
    """뉴런이 생성한 응답이 통합 페르소나에 맞는지 검증."""

    async def validate(
        self, response: str, config: PersonaConfig, neuron_type: str
    ) -> GuardResult:
        checks = []

        # 1. 금지 표현 검사 (규칙 기반, 빠름)
        for forbidden in config.style_guide.forbidden_expressions:
            if forbidden in response:
                checks.append(GuardCheck(
                    passed=False,
                    reason=f"금지 표현 감지: '{forbidden}'",
                    fix="replace"
                ))

        # 2. 다른 뉴런 응답과 톤 일관성 검사 (LLM 기반, 선택적)
        recent_responses = await self.get_recent_responses(config.persona_id, n=5)
        consistency = await self.check_tone_consistency(
            response, recent_responses
        )
        if consistency.score < 0.7:
            checks.append(GuardCheck(
                passed=False,
                reason=f"톤 일관성 부족 (점수: {consistency.score:.2f})",
                fix="rewrite"
            ))

        # 3. 이름 일관성 (다른 이름으로 자기소개하지 않는지)
        if self.contains_wrong_self_reference(response, config.name):
            checks.append(GuardCheck(
                passed=False,
                reason="잘못된 자기 참조",
                fix="replace"
            ))

        passed = all(c.passed for c in checks)
        if not passed:
            response = await self.auto_fix(response, checks, config)

        return GuardResult(passed=passed, response=response, checks=checks)
```

### 4.6 실측 기반 튜닝

페르소나 품질은 다음 지표로 지속 측정한다 (백서 실측 기반 튜닝 원칙):

| 지표 | 측정 방법 | 목표 |
|------|-----------|------|
| 톤 일관성 점수 | 최근 N개 응답 간 코사인 유사도 | ≥ 0.85 |
| "여러 명 같은" 체감 | 사용자 피드백 (무작위 샘플링) | "아니오" ≥ 95% |
| 페르소나 가드 수정률 | 전체 응답 중 Guard가 수정한 비율 | ≤ 5% (초기 15% 허용) |
| 뉴런별 톤 편차 | 뉴런별 응답 톤 벡터 분산 | σ < 0.15 |

---

## 5. LangGraph + Temporal.io 오케스트레이션

### 5.1 역할 분담

| 계층 | 기술 | 책임 |
|------|------|------|
| **에이전트 그래프** | LangGraph | 뉴런 간 메시지 흐름, 상태 전이, 조건부 라우팅 |
| **워크플로우 엔진** | Temporal.io | 작업 지속성, 재시도, 타임아웃, 크론 스케줄링 |
| **실시간 통신** | Stream Chat | 사용자 ↔ 에이전트 메시지 전송, 타이핑 인디케이터 |

**왜 두 개를 같이 쓰는가:**
- LangGraph: LLM 기반 의사결정(라우팅, 병합 판단 등)에 최적화된 상태 그래프. 노드/엣지 기반으로 뉴런 흐름을 선언적으로 정의 가능.
- Temporal.io: 장기 실행 워크플로우(시간이 걸리는 답변 생성, 비주얼 렌더링 등)의 지속성·재시도·오류 복구를 보장. 서버가 죽어도 워크플로우는 중단되지 않음.

### 5.2 LangGraph 그래프 설계

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated, Literal

# ── 그래프 상태 ──────────────────────────────────
class NeuronState(TypedDict):
    """LangGraph 그래프의 전역 상태."""
    # 세션 정보
    session_key: str                    # (user_id, agent_id)
    persona_config: PersonaConfig

    # 현재 턴 정보
    user_message: str
    stt_metadata: dict                  # Whisper v3 Turbo 메타데이터

    # 뉴런 상태
    active_neurons: dict[str, NeuronStatus]
    neuron_outputs: dict[str, any]

    # 큐 상태
    pending_queue: list[QueuedMessage]
    current_task: Optional[AnswerTask]

    # 응답 조합
    empathy_response: Optional[str]
    answer_chunks: list[str]
    visual_artifacts: list[VisualArtifact]

    # 통합 결과
    final_response: Optional[UnifiedResponse]

# ── 그래프 노드 (각 뉴런에 대응) ────────────────
def empathy_node(state: NeuronState) -> NeuronState:
    """공감 에이뉴런: 사용자 입력을 복명복창하며 공감대 형성."""
    prompt = build_persona_prompt(state["persona_config"], "empathy")
    response = llm.generate(
        system=prompt,
        messages=[{"role": "user", "content": state["user_message"]}],
        max_tokens=100,  # 짧고 빠르게
        model="gpt-4o-mini"  # 경량 모델
    )
    state["empathy_response"] = response.content
    state["active_neurons"]["empathy"] = NeuronStatus.PROCESSING
    # 공감 응답을 즉시 사용자에게 전송 (Stream Chat)
    stream_chat.send_message(state["session_key"], response.content)
    return state


def router_node(state: NeuronState) -> NeuronState:
    """Router: 필요한 뉴런 조합을 판별."""
    plan = neuron_router.route(state["user_message"], state)
    state["activation_plan"] = plan
    return state


def answer_node(state: NeuronState) -> NeuronState:
    """답변생성 에이뉴런: 실질적 답변 생성 (스트리밍)."""
    prompt = build_persona_prompt(state["persona_config"], "answer")
    chunks = []
    for chunk in llm.stream(
        system=prompt,
        messages=build_conversation_history(state),
        model="gpt-4o"
    ):
        chunks.append(chunk)
        # 완성된 부분을 Stream Chat으로 스트리밍
        stream_chat.update_streaming_message(state["session_key"], "".join(chunks))

    state["answer_chunks"] = chunks
    state["active_neurons"]["answer"] = NeuronStatus.IDLE
    return state


def queue_node(state: NeuronState) -> NeuronState:
    """큐 에이뉴런: 끼어든 입력 판별 및 병합/큐잉."""
    # 현재 진행 중인 작업이 있는지 확인
    if state["current_task"] is None:
        return state  # 진행 중인 작업 없으면 패스

    result = handle_interruption(state["current_task"], state["user_message"])
    if result.action == "merged":
        # 답변생성 노드를 다시 트리거하기 위해 상태 업데이트
        state["current_task"].update(result.merge_instructions)
        state["needs_regeneration"] = True
    else:
        state["pending_queue"].append(QueuedMessage(
            content=state["user_message"],
            priority=result.priority
        ))
        # 진정 메시지 전송
        stream_chat.send_message(state["session_key"], result.message)

    state["active_neurons"]["queue"] = NeuronStatus.IDLE
    return state


def visual_node(state: NeuronState) -> NeuronState:
    """비주얼 에이뉴런: 표/차트/인포그래픽 생성."""
    visual_tasks = state.get("visual_tasks", [])
    artifacts = []

    for task in visual_tasks:
        # 진행 안내 메시지 전송
        stream_chat.send_message(
            state["session_key"],
            f"{state['persona_config'].name}가 자료를 정리하고 있어요..."
        )

        # HTML/SVG 생성 → 렌더링
        html = await generate_visual_html(task, state["persona_config"])
        rendered = await render_to_image(html)
        artifacts.append(VisualArtifact(
            type=task.type,
            image_url=rendered.url,
            html_source=html
        ))

        # 완성된 이미지 Stream Chat으로 전송
        stream_chat.send_image(state["session_key"], rendered.url)

    state["visual_artifacts"] = artifacts
    state["active_neurons"]["visual"] = NeuronStatus.IDLE
    return state


def compose_node(state: NeuronState) -> NeuronState:
    """최종 응답 조합: 모든 뉴런 결과를 하나의 응답으로 통합."""
    response = UnifiedResponse(
        empathy=state.get("empathy_response"),
        answer="".join(state.get("answer_chunks", [])),
        visuals=state.get("visual_artifacts", []),
        queued_messages=state.get("pending_queue", [])
    )
    state["final_response"] = response
    return state

# ── 조건부 라우팅 ──────────────────────────────
def should_activate_visual(state: NeuronState) -> Literal["visual", "compose"]:
    """답변에 시각적 산출물이 필요한지 판단."""
    if state.get("visual_tasks"):
        return "visual"
    return "compose"


def should_activate_queue(state: NeuronState) -> Literal["queue", "answer"]:
    """끼어든 입력이 있는지 판단."""
    if state.get("current_task") and state.get("is_interruption"):
        return "queue"
    return "answer"


def has_pending_queue(state: NeuronState) -> Literal["router", END]:
    """대기열에 다음 작업이 있는지 확인."""
    if state.get("pending_queue"):
        next_msg = state["pending_queue"].pop(0)
        state["user_message"] = next_msg.content
        return "router"
    return END


# ── 그래프 구성 ────────────────────────────────
graph = StateGraph(NeuronState)

graph.add_node("empathy", empathy_node)
graph.add_node("router", router_node)
graph.add_node("answer", answer_node)
graph.add_node("queue", queue_node)
graph.add_node("visual", visual_node)
graph.add_node("compose", compose_node)

graph.set_entry_point("empathy")

graph.add_edge("empathy", "router")
graph.add_conditional_edges("router", should_activate_queue)
graph.add_edge("answer", should_activate_visual)
graph.add_edge("visual", "compose")
graph.add_edge("compose", has_pending_queue)

neuron_graph = graph.compile()
```

### 5.3 Temporal.io 워크플로우 통합

LangGraph가 "한 턴"의 그래프를 관리한다면, Temporal.io는 **여러 턴에 걸친 장기 실행 작업**을 관리한다.

```python
from temporalio import workflow, activity
from datetime import timedelta

@workflow.defn
class NeuronOrchestrationWorkflow:
    """
    Temporal 워크플로우: 하나의 대화 세션에 대한 장기 실행 오케스트레이션.
    서버가 죽어도 워크플로우는 Temporal 서버에서 지속됨.
    """

    def __init__(self):
        self._session_key: str = ""
        self._active_neurons: dict = {}
        self._pending_signals: list = []

    @workflow.run
    async def run(self, session_key: str, persona_config: dict) -> None:
        self._session_key = session_key

        # 세션이 살아있는 동안 계속 실행
        while True:
            # 사용자 메시지 신호 대기
            message = await workflow.wait_condition(
                lambda: len(self._pending_signals) > 0,
                timeout=timedelta(hours=24)  # 24시간 무입력 시 세션 종료
            )

            user_message = self._pending_signals.pop(0)

            # LangGraph 실행 (Activity로 래핑)
            result = await workflow.execute_activity(
                run_neuron_graph,
                args=[session_key, persona_config, user_message],
                start_to_close_timeout=timedelta(seconds=120),
                retry_policy=RetryPolicy(
                    maximum_attempts=3,
                    initial_interval=timedelta(seconds=1)
                )
            )

            # 큐에 남은 작업이 있으면 자동 처리
            while result.get("pending_queue"):
                next_message = result["pending_queue"].pop(0)
                result = await workflow.execute_activity(
                    run_neuron_graph,
                    args=[session_key, persona_config, next_message["content"]],
                    start_to_close_timeout=timedelta(seconds=120)
                )

    @workflow.signal
    async def user_message(self, message: str) -> None:
        """사용자 메시지 수신 시그널."""
        self._pending_signals.append(message)

    @workflow.signal
    async def user_interrupt(self, message: str) -> None:
        """사용자 끼어들기 시그널 — 높은 우선순위로 처리."""
        self._pending_signals.insert(0, message)

    @workflow.signal
    async def user_stop(self) -> None:
        """사용자 중단 시그널 ("잠깐만 멈춰봐")."""
        # 모든 활성 뉴런에 중단 명령
        await workflow.execute_activity(
            stop_all_neurons,
            args=[self._session_key],
            start_to_close_timeout=timedelta(seconds=5)
        )


@activity.defn
async def run_neuron_graph(
    session_key: str, persona_config: dict, user_message: str
) -> dict:
    """LangGraph 그래프를 Temporal Activity로 실행."""
    state = NeuronState(
        session_key=session_key,
        persona_config=PersonaConfig.from_dict(persona_config),
        user_message=user_message,
        active_neurons={},
        neuron_outputs={},
        pending_queue=[],
        current_task=None,
        empathy_response=None,
        answer_chunks=[],
        visual_artifacts=[],
        final_response=None
    )

    result = await neuron_graph.ainvoke(state)
    return result


@activity.defn
async def stop_all_neurons(session_key: str) -> None:
    """모든 활성 뉴런 즉시 중단 — 백서 3.3절 '전사 잠깐만 멈춰봐' 프로토콜."""
    active = await get_active_neurons(session_key)
    for neuron_id in active:
        await deactivate_neuron(neuron_id)
    await stream_chat.send_message(
        session_key, "네, 멈췄어요. 필요할 때 말씀해주세요."
    )
```

### 5.4 STT → 그래프 실행 파이프라인

```
음성 입력
    │
    ▼
┌──────────────────────────┐
│  Whisper v3 Turbo (STT)  │  ← 실시간 스트리밍 STT
│  - 청크 단위 전송         │
│  - 최종 문장 확정 시점     │
└────────────┬─────────────┘
             │ text + metadata
             ▼
┌──────────────────────────┐
│  Stream Chat Hook        │  ← 실시간 트랜스크립트 표시
│  - 사용자에게 텍스트 피드백 │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  Temporal Signal         │  ← user_message 신호 전송
│  - 워크플로우에 메시지 전달 │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  LangGraph Execution     │  ← 뉴런 그래프 실행
│  - 공감 → Router → ...   │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  Stream Chat Output      │  ← 사용자에게 응답 전송
│  - 텍스트/이미지/카드     │
└──────────────────────────┘
```

---

## 6. 뉴런 간 컨텍스트 동기화

### 6.1 핵심 원칙

백서 4.0절: **세션은 (user_id, agent_id) 관계 단위로 식별된다.** 모든 뉴런은 같은 세션의 같은 컨텍스트를 공유해야 한다.

### 6.2 컨텍스트 저장소 구조

```
┌────────────────────────────────────────────────────────┐
│                Context Store (Supabase)                 │
│                                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Session Context (per user_id + agent_id)        │   │
│  │                                                 │   │
│  │  ┌───────────┐ ┌──────────────┐ ┌────────────┐ │   │
│  │  │ Short-term │ │ Long-term    │ │ Persona    │ │   │
│  │  │ Memory     │ │ Memory       │ │ State      │ │   │
│  │  │ (최근 대화) │ │ (압축 요약)   │ │ (페르소나) │ │   │
│  │  └───────────┘ └──────────────┘ └────────────┘ │   │
│  │                                                 │   │
│  │  ┌───────────┐ ┌──────────────┐ ┌────────────┐ │   │
│  │  │ Task State │ │ Visual Cache │ │ Queue      │ │   │
│  │  │ (작업 상태) │ │ (시각 산출물) │ │ State     │ │   │
│  │  └───────────┘ └──────────────┘ └────────────┘ │   │
│  └─────────────────────────────────────────────────┘   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 6.3 실시간 동기화 메커니즘

뉴런이 컨텍스트를 업데이트하면, 다른 활성 뉴런이 즉시 그 변경을 볼 수 있어야 한다.

```python
class ContextSync:
    """뉴런 간 실시간 컨텍스트 동기화."""

    def __init__(self, session_key: str, supabase_client):
        self.session_key = session_key
        self.supabase = supabase_client
        self.listeners: dict[str, list[Callable]] = {}

    async def update(self, key: str, delta: ContextDelta) -> None:
        """
        컨텍스트 업데이트.
        - Supabase에 append-only 패치로 기록 (감사 추적)
        - 활성 뉴런에게 이벤트 발행
        """
        # 1. Supabase에 기록
        await self.supabase.table("context_patches").insert({
            "session_key": self.session_key,
            "key": key,
            "delta": delta.to_dict(),
            "source_neuron": delta.source_neuron_id,
            "created_at": datetime.utcnow().isoformat()
        }).execute()

        # 2. 활성 뉴런에게 전파
        event = ContextUpdateEvent(
            key=key,
            delta=delta,
            timestamp=datetime.utcnow()
        )
        await self._broadcast(event)

    async def read(self, key: str) -> any:
        """현재 컨텍스트 값 읽기 (캐시 우선, 없으면 DB)."""
        cached = await self._cache_get(key)
        if cached is not None:
            return cached

        # DB에서 최신 패치들을 읽어 재구성
        patches = await self.supabase.table("context_patches") \
            .select("*") \
            .eq("session_key", self.session_key) \
            .eq("key", key) \
            .order("created_at", desc=True) \
            .limit(100) \
            .execute()

        value = apply_patches(patches.data)
        await self._cache_set(key, value)
        return value

    async def subscribe(self, key_pattern: str, callback: Callable) -> None:
        """컨텍스트 변경 구독 (뉴런이 특정 키의 변경을 감지)."""
        if key_pattern not in self.listeners:
            self.listeners[key_pattern] = []
        self.listeners[key_pattern].append(callback)
```

### 6.4 컨텍스트 키 체계

| 키 | 유형 | 설명 | 갱신 주체 |
|----|------|------|-----------|
| `conversation.recent` | List[Message] | 최근 N개 대화 (원본) | 공감/답변 뉴런 |
| `conversation.summary` | str | 장기 기억 압축 요약 | 백그라운드 압축 작업 |
| `task.current` | TaskState | 현재 진행 중인 작업 | 답변생성 뉴런 |
| `task.queue` | List[QueuedMessage] | 대기열 | 큐 뉴런 |
| `visual.artifacts` | List[Artifact] | 생성된 시각 산출물 | 비주얼 뉴런 |
| `persona.state` | PersonaConfig | 현재 페르소나 설정 | 오케스트레이터 |
| `session.metadata` | dict | 세션 메타 (디바이스, 채널) | 시스템 |
| `user.preferences` | dict | 사용자 선호도 | 학습 파이프라인 |

### 6.5 기억 압축과의 연동 (백서 4.5절)

```python
class MemoryCompaction:
    """
    백서 4.5절의 2단계 메모리 구조 구현.
    - 1단계: 원본 트랜스크립트 보존
    - 2단계: 주기적 압축 요약
    """

    async def maybe_compact(self, session_key: str) -> None:
        """최근 대화량이 임계치를 넘으면 압축 수행."""
        recent_count = await self.context_sync.read("conversation.recent_count")

        if recent_count > COMPACTION_THRESHOLD:  # 예: 100턴
            # 원본은 보존 (1단계)
            raw_log = await self.context_sync.read("conversation.recent")
            await self.supabase.table("raw_transcripts").insert({
                "session_key": session_key,
                "content": raw_log,
                "compacted_at": None  # 원본임을 표시
            }).execute()

            # 압축 요약 생성 (2단계)
            summary = await llm.summarize(
                raw_log,
                criteria=["핵심 결정사항", "사용자 선호도", "미완료 작업", "중요 맥락"]
            )

            # 압축 결과를 컨텍스트에 반영
            await self.context_sync.update(
                "conversation.summary",
                ContextDelta(
                    operation="append",
                    value=summary,
                    source_neuron_id="system.compaction"
                )
            )

            # 최근 대화 초기화 (압축된 것만 남김)
            await self.context_sync.update(
                "conversation.recent",
                ContextDelta(operation="replace", value=[])
            )
```

---

## 7. 확장 가능한 뉴런 유형 (Custom 뉴런)

### 7.1 설계 원칙

백서 1.3절의 스킬 마켓 생태계와 동일한 패턴: **커스텀 뉴런을 스킬 마켓을 통해 배포·공유할 수 있어야 한다.**

- 뉴런은 인터페이스만 맞추면 누구나 만들 수 있다
- 보안 검사는 예외 없이 필수 (백서 1.3절)
- 커스텀 뉴런도 통합 페르소나를 따라야 한다 (단일 인격 제약)

### 7.2 뉴런 인터페이스 (Neuron Interface)

모든 뉴런 (기본 4종 + 커스텀)은 이 인터페이스를 구현해야 한다.

```python
from abc import ABC, abstractmethod
from typing import AsyncGenerator

class NeuronInterface(ABC):
    """모든 뉴런이 구현해야 하는 표준 인터페이스."""

    @abstractmethod
    def metadata(self) -> NeuronMetadata:
        """뉴런 메타데이터 반환."""
        # name, description, version, author, capabilities, resource_requirements
        ...

    @abstractmethod
    async def activate(self, config: NeuronActivationConfig) -> None:
        """뉴런 활성화. 리소스 할당 및 초기화."""
        ...

    @abstractmethod
    async def process(
        self,
        message: UserMessage,
        context: ContextView,
        persona: PersonaConfig
    ) -> AsyncGenerator[NeuronOutput, None]:
        """
        메시지 처리. 스트리밍 출력을 생성.
        - persona 파라미터를 반드시 받아 통합 페르소나를 따라야 함
        - context는 읽기 전용 뷰 (쓰기는 ContextSync 통해)
        """
        ...

    @abstractmethod
    async def deactivate(self) -> None:
        """뉴런 비활성화. 리소스 정리."""
        ...

    @abstractmethod
    async def health_check(self) -> HealthStatus:
        """헬스체크. DEGRADED 상태 감지용."""
        ...


class NeuronMetadata(TypedDict):
    name: str                          # "번역 에이뉴런"
    description: str                   # "다국어 실시간 번역을 담당"
    version: str                       # "1.0.0"
    author: str                        # 개발자/팀 이름
    capabilities: list[str]            # ["translation", "language_detection"]
    trigger_conditions: list[str]      # ["multilingual_input", "translation_request"]
    resource_requirements: ResourceReq # cpu, memory, gpu, model_requirements
    dependencies: list[str]            # 다른 뉴런 또는 스킬 의존성
    persona_compatible: bool           # 통합 페르소나 준수 여부 (must be True)
```

### 7.3 커스텀 뉴런 등록 프로세스

```
개발자 → 뉴런 패키지 제출
    │
    ▼
┌──────────────────────────────┐
│ 1. 자동 보안 스캔             │  ← 해킹 소스·악성 코드 검사
│    - 정적 분석 (SAST)         │
│    - 의존성 취약점 검사       │
│    - 샌드박스 실행 테스트     │
└──────────────┬───────────────┘
               │ 통과
               ▼
┌──────────────────────────────┐
│ 2. 인터페이스 적합성 검사     │  ← NeuronInterface 구현 확인
│    - 메타데이터 완전성        │
│    - activate/process/       │
│      deactivate 구현         │
│    - persona 파라미터 사용    │
│    - 출력 형식 준수           │
└──────────────┬───────────────┘
               │ 통과
               ▼
┌──────────────────────────────┐
│ 3. 페르소나 호환성 테스트     │  ← 통합 페르소나를 따르는지 검증
│    - 샘플 대화에서 톤 일관성  │
│    - 금지 표현 미사용 확인    │
└──────────────┬───────────────┘
               │ 통과
               ▼
┌──────────────────────────────┐
│ 4. 관리자 승인 (필요시)       │  ← 민감한 권한 요구 시
│    - 파일 접근, 외부 API 등   │
└──────────────┬───────────────┘
               │ 승인
               ▼
┌──────────────────────────────┐
│ 5. 스킬 마켓 등록             │
│    - 뉴런 검색/설치 가능      │
│    - 사용량 트래킹 시작       │
└──────────────────────────────┘
```

### 7.4 커스텀 뉴런 예시

```python
class TranslationNeuron(NeuronInterface):
    """커스텀 뉴런 예시: 다국어 실시간 번역."""

    def metadata(self) -> NeuronMetadata:
        return {
            "name": "번역 에이뉴런",
            "description": "다국어 입력 감지 시 실시간 번역 제공",
            "version": "1.0.0",
            "author": "agenttalk-official",
            "capabilities": ["translation", "language_detection"],
            "trigger_conditions": ["multilingual_input", "explicit_translation_request"],
            "resource_requirements": {
                "cpu": "0.5",
                "memory": "256MB",
                "gpu": False,
                "model": "nllb-200-distilled-600M"
            },
            "dependencies": [],
            "persona_compatible": True
        }

    async def activate(self, config: NeuronActivationConfig) -> None:
        self.model = load_model("nllb-200-distilled-600M")
        self.target_language = config.persona_config.language

    async def process(
        self,
        message: UserMessage,
        context: ContextView,
        persona: PersonaConfig
    ) -> AsyncGenerator[NeuronOutput, None]:
        detected_lang = detect_language(message.text)

        if detected_lang != self.target_language:
            translated = await self.model.translate(
                message.text,
                source=detected_lang,
                target=self.target_language
            )
            yield NeuronOutput(
                type="translation",
                content=translated,
                metadata={"source_language": detected_lang}
            )

    async def deactivate(self) -> None:
        del self.model

    async def health_check(self) -> HealthStatus:
        return HealthStatus(healthy=self.model is not None)
```

### 7.5 뉴런 유형 레지스트리

```python
class NeuronRegistry:
    """등록된 모든 뉴런 유형의 레지스트리."""

    def __init__(self, supabase_client):
        self.supabase = supabase_client
        self._cache: dict[str, NeuronInterface] = {}

    async def register(self, neuron: NeuronInterface) -> None:
        """뉴런 유형 등록 (보안 검사 통과 후)."""
        meta = neuron.metadata()
        await self.supabase.table("neuron_types").upsert({
            "name": meta["name"],
            "description": meta["description"],
            "version": meta["version"],
            "author": meta["author"],
            "capabilities": meta["capabilities"],
            "trigger_conditions": meta["trigger_conditions"],
            "status": "active",
            "usage_count": 0,
            "satisfaction_score": None,
            "success_rate": None
        }).execute()

    async def discover(
        self, trigger_context: dict
    ) -> list[NeuronInterface]:
        """현재 상황에 적합한 커스텀 뉴런 탐색."""
        # trigger_conditions 매칭
        matching = await self.supabase.table("neuron_types") \
            .select("*") \
            .filter("trigger_conditions", "cs", trigger_context.keys()) \
            .eq("status", "active") \
            .execute()

        return [self._load(n["name"]) for n in matching.data]

    async def get_ranking(self) -> list[dict]:
        """
        백서 1.3절의 다신호 랭킹 적용:
        사용빈도 + 만족도 + 성공률
        """
        return await self.supabase.rpc("neuron_ranking").execute()
```

---

## 8. 기술 스택 통합 설계

### 8.1 전체 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (React Native)                    │
│  ┌──────────┐ ┌──────────────┐ ┌────────────┐ ┌─────────────┐ │
│  │ 조이스틱  │ │ 실시간       │ │ 결과       │ │ 카드        │ │
│  │ 마이크    │ │ 트랜스크립트 │ │ 캔버스     │ │ 스레드      │ │
│  └──────────┘ └──────────────┘ └────────────┘ └─────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket (Stream Chat SDK)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API Gateway / Edge                          │
│              (인증, 라우팅, Rate Limiting)                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│  Stream Chat   │ │  Temporal.io   │ │  Whisper v3    │
│  Server        │ │  Server        │ │  Turbo (STT)   │
│                │ │                │ │                │
│  - 실시간      │ │  - 워크플로우  │ │  - 음성→텍스트 │
│    메시지      │ │    오케스트    │ │  - 스트리밍    │
│  - 타이핑      │ │  - 재시도      │ │    변환        │
│    인디케이터  │ │  - 지속성      │ │                │
└────────┬───────┘ └────────┬───────┘ └────────┬───────┘
         │                  │                   │
         └──────────────────┼───────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LangGraph Worker Pool                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Neuron Orchestration Graph                  │   │
│  │                                                          │   │
│  │  [공감] → [Router] → [답변생성] → [비주얼] → [Compose]  │   │
│  │                 │         │                              │   │
│  │                 ▼         ▼                              │   │
│  │              [큐]    [Custom 뉴런...]                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Supabase                                   │
│                                                                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌─────────────┐ │
│  │ Postgres   │ │ Realtime   │ │ Storage    │ │ Edge        │ │
│  │            │ │            │ │            │ │ Functions   │ │
│  │ - 세션     │ │ - 컨텍스트 │ │ - 파일     │ │ - 경량      │ │
│  │ - 컨텍스트 │ │   동기화   │ │ - 이미지   │ │   API       │ │
│  │ - 뉴런     │ │ - 뉴런     │ │ - 음성     │ │   엔드포인트│ │
│  │   레지스트리│ │   이벤트   │ │            │ │             │ │
│  └────────────┘ └────────────┘ └────────────┘ └─────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 기술별 역할 상세

#### Stream Chat SDK

| 역할 | 구현 방식 |
|------|-----------|
| 사용자 ↔ 에이전트 메시지 | Stream Chat 채널 = 세션 단위 (user_id, agent_id) |
| 실시간 트랜스크립트 | 음성 입력 중 partial 텍스트를 커스텀 이벤트로 전송 |
| 타이핑/처리 중 인디케이터 | Stream의 `typing.start/stop` + 커스텀 이벤트 |
| 뉴런 상태 표시 | 커스텀 이벤트 `neuron.status` (사용자에게는 단순화된 형태만 노출) |
| 파일/이미지 전송 | Stream Chat의 attachment 기능 활용 |

```typescript
// Stream Chat 커스텀 이벤트 정의
interface StreamCustomEvents {
  // 클라이언트 → 서버
  "neuron:stt_partial": { text: string; isFinal: boolean };
  "neuron:user_stop": {};

  // 서버 → 클라이언트
  "neuron:empathy_response": { text: string };
  "neuron:answer_chunk": { text: string; progress: number };
  "neuron:visual_preview": { imageUrl: string; status: "preview" | "final" };
  "neuron:processing_status": {
    stage: "thinking" | "organizing" | "finalizing";
    quip: string;  // 캐릭터 말투의 짧은 문구
  };
  "neuron:queue_update": {
    pendingCount: number;
    currentTask: string;
  };
}
```

#### Whisper v3 Turbo (STT)

| 항목 | 내용 |
|------|------|
| **모델** | Whisper v3 Turbo (속도 최적화 버전) |
| **배치** | 별도 STT 서비스 (GPU 인스턴스) |
| **입력** | 실시간 오디오 스트림 (WebSocket) |
| **출력** | 부분 텍스트(partial) + 최종 확정 텍스트(final) |
| **지연시간** | partial < 300ms, final < 1200ms |
| **부가 기능** | 언어 감지, 음성 활동 감지(VAD), 화자 분리(옵션) |

```python
class WhisperSTTService:
    """Whisper v3 Turbo 기반 실시간 STT 서비스."""

    async def transcribe_stream(
        self, audio_stream: AsyncIterator[bytes]
    ) -> AsyncGenerator[STTResult, None]:
        """오디오 스트림을 실시간으로 텍스트 변환."""
        buffer = AudioBuffer(chunk_size_ms=500)

        async for audio_chunk in audio_stream:
            buffer.append(audio_chunk)

            # VAD: 음성 활동 감지
            if not buffer.has_voice_activity():
                continue

            # 부분 결과 (low latency)
            partial = await self.model.transcribe(
                buffer.get_recent(ms=3000),
                task="transcribe",
                language=None  # 자동 감지
            )
            yield STTResult(
                text=partial.text,
                is_final=False,
                confidence=partial.confidence,
                language=partial.language
            )

            # 문장 경계 감지 시 최종 결과
            if buffer.is_sentence_boundary():
                final = await self.model.transcribe(
                    buffer.get_sentence(),
                    task="transcribe"
                )
                yield STTResult(
                    text=final.text,
                    is_final=True,
                    confidence=final.confidence,
                    language=final.language
                )
                buffer.flush_sentence()
```

#### Supabase (Postgres)

| 테이블 | 용도 | 특징 |
|--------|------|------|
| `sessions` | 세션 마스터 | (user_id, agent_id) 복합 키 |
| `context_patches` | 컨텍스트 변경 이력 | append-only, 시계열 |
| `neuron_types` | 뉴런 유형 레지스트리 | 스킬 마켓 연동 |
| `neuron_instances` | 활성 뉴런 인스턴스 | 상태 추적 |
| `persona_configs` | 페르소나 설정 | 버전 관리 |
| `raw_transcripts` | 원본 대화 로그 | 보존 (압축 후에도 원본 유지) |
| `compacted_memories` | 압축된 장기 기억 | 2단계 메모리 구조 |
| `task_states` | 작업 상태 추적 | 시작/진행/완료/막힘 |

### 8.3 Supabase Realtime 활용

컨텍스트 동기화를 위해 Supabase Realtime의 채널 구독을 활용한다.

```typescript
// 클라이언트 측: 뉴런 이벤트 구독
const channel = supabase.channel(`session:${sessionKey}`);

channel
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'context_patches',
    filter: `session_key=eq.${sessionKey}`
  }, (payload) => {
    // 컨텍스트 업데이트 반영
    updateLocalContext(payload.new);
  })
  .on('broadcast', { event: 'neuron_status' }, ({ payload }) => {
    // 뉴런 상태 표시 (디버그 모드에서만)
    updateNeuronStatusDisplay(payload);
  })
  .subscribe();
```

---

## 9. 데이터 모델

### 9.1 핵심 테이블 스키마

```sql
-- 세션 마스터 (백서 4.0절: 관계 기반 세션 라우팅)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    persona_id UUID NOT NULL REFERENCES persona_configs(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, agent_id)
);

-- 페르소나 설정
CREATE TABLE persona_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    version INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    voice_config JSONB NOT NULL,
    tone_config JSONB NOT NULL,
    style_guide JSONB NOT NULL,
    neuron_overrides JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_id, version)
);

-- 뉴런 유형 레지스트리 (스킬 마켓 연동)
CREATE TABLE neuron_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    version TEXT NOT NULL,
    author TEXT NOT NULL,
    capabilities TEXT[] NOT NULL DEFAULT '{}',
    trigger_conditions TEXT[] NOT NULL DEFAULT '{}',
    resource_requirements JSONB NOT NULL DEFAULT '{}',
    dependencies TEXT[] NOT NULL DEFAULT '{}',
    persona_compatible BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'deprecated', 'blocked')),
    -- 백서 1.3절 다신호 랭킹
    usage_count BIGINT NOT NULL DEFAULT 0,
    success_count BIGINT NOT NULL DEFAULT 0,
    failure_count BIGINT NOT NULL DEFAULT 0,
    satisfaction_sum INTEGER NOT NULL DEFAULT 0,
    satisfaction_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 활성 뉴런 인스턴스
CREATE TABLE neuron_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id),
    neuron_type_id UUID NOT NULL REFERENCES neuron_types(id),
    status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'active', 'processing', 'degraded')),
    config JSONB NOT NULL DEFAULT '{}',
    activated_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 컨텍스트 패치 (append-only, 시계열)
CREATE TABLE context_patches (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id),
    key TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('set', 'append', 'replace', 'delete')),
    delta JSONB NOT NULL,
    source_neuron_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_context_patches_session_key
    ON context_patches (session_id, key, created_at DESC);

-- 원본 대화 로그 (백서 4.5절 1단계)
CREATE TABLE raw_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id),
    turn_index INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
    content TEXT NOT NULL,
    stt_metadata JSONB,
    neuron_source TEXT,  -- 어떤 뉴런이 생성한 응답인지
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, turn_index)
);

-- 압축된 장기 기억 (백서 4.5절 2단계)
CREATE TABLE compacted_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id),
    summary TEXT NOT NULL,
    source_turn_range INT4RANGE NOT NULL,  -- 원본 턴 범위
    importance_score REAL NOT NULL DEFAULT 0.5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 작업 상태 (백서 3.9절)
CREATE TABLE task_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id),
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
    assigned_neuron_id TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 9.2 뉴런 랭킹 뷰 (다신호 검증)

```sql
-- 백서 1.3절: 사용빈도 + 만족도 + 성공률 3신호 랭킹
CREATE OR REPLACE VIEW neuron_ranking AS
SELECT
    id,
    name,
    description,
    -- 성공 완료 vs 실패 재시도 구분
    CASE WHEN (success_count + failure_count) > 0
        THEN success_count::REAL / (success_count + failure_count)
        ELSE 0
    END AS success_rate,
    -- 만족도 (좋아요/싫어요 비율)
    CASE WHEN satisfaction_count > 0
        THEN satisfaction_sum::REAL / satisfaction_count
        ELSE 0
    END AS satisfaction_score,
    -- 사용빈도 (정규화)
    usage_count,
    -- 종합 점수 (가중치: 성공률 40%, 만족도 35%, 사용빈도 25%)
    (
        CASE WHEN (success_count + failure_count) > 0
            THEN success_count::REAL / (success_count + failure_count)
            ELSE 0
        END * 0.4 +
        CASE WHEN satisfaction_count > 0
            THEN satisfaction_sum::REAL / satisfaction_count / 5.0
            ELSE 0
        END * 0.35 +
        LEAST(usage_count::REAL / 1000.0, 1.0) * 0.25
    ) AS composite_score
FROM neuron_types
WHERE status = 'active'
ORDER BY composite_score DESC;
```

---

## 10. 장애 처리 및 회복

### 10.1 뉴런 수준 장애 처리

```python
class NeuronFaultTolerance:
    """뉴런 단위 장애 처리."""

    async def handle_failure(
        self, neuron_id: str, error: Exception, context: DialogContext
    ) -> FaultResolution:
        # 1. 동일 뉴런 재시도 (최대 3회)
        for attempt in range(3):
            try:
                result = await self.retry_neuron(neuron_id, context)
                return FaultResolution(action="retried", result=result)
            except Exception:
                await asyncio.sleep(2 ** attempt)  # 지수 백오프

        # 2. 폴백 뉴런으로 전환
        fallback = await self.get_fallback_neuron(neuron_id)
        if fallback:
            result = await fallback.process(context)
            return FaultResolution(action="fallback", result=result)

        # 3. 폴백도 실패: 사용자에게 솔직하게 안내
        return FaultResolution(
            action="user_notification",
            message="잠시 문제가 생겼어요. 다시 시도해볼까요?"
        )
```

### 10.2 Temporal.io 기반 워크플로우 회복

Temporal.io의 핵심 강점은 **서버가 죽어도 워크플로우가 지속**된다는 것이다.

| 시나리오 | Temporal 동작 |
|----------|--------------|
| LangGraph 워커 크래시 | Activity 재시도 (설정된 정책대로) |
| 전체 서버 다운 | Temporal 서버가 다른 워커에서 워크플로우 재개 |
| 뉴런 응답 타임아웃 | Activity 타임아웃 → 재시도 or 폴백 |
| DB 연결 끊김 | Supabase 재연결 시까지 Activity 일시 중지 |

### 10.3 우아한 성능 저하 (Graceful Degradation)

```python
DEGRADATION_CHAIN = {
    # 뉴런 장애 시 폴백 체인
    "answer": [
        "answer_lightweight",     # 경량 모델로 대체
        "empathy_with_promise",   # 공감 뉴런이 "잠시 후 답변" 약속
    ],
    "visual": [
        "text_description",       # 표 대신 텍스트 설명
    ],
    "queue": [
        "simple_fifo",            # 판단 없이 FIFO 큐
    ],
    "stt": [
        "text_input_fallback",    # 텍스트 입력 모드 전환 안내
    ]
}
```

---

## 11. 성능 목표 및 측정 지표

### 11.1 응답 시간 목표

| 단계 | 목표 | 측정 방법 |
|------|------|-----------|
| STT 완료 (Whisper v3 Turbo) | < 1.2s | 오디오 종료 → 최종 텍스트 수신 |
| 공감 응답 전송 | < 500ms (STT 이후) | 공감 노드 시작 → Stream Chat 전송 |
| 답변 첫 토큰 | < 2s (STT 이후) | 답변 노드 시작 → 첫 청크 |
| 비주얼 프리뷰 | < 5s (위임 이후) | 비주얼 노드 시작 → 첫 이미지 |
| 전체 응답 완료 | < 15s (단순 질문) | 사용자 입력 → 최종 응답 |

### 11.2 뉴런 효율성 지표 (실측 기반 튜닝)

백서의 핵심 원칙: **"이 역할이 정말 값어치를 하는지"를 측정해 필요 없으면 통합.**

```python
class NeuronEfficiencyMetrics:
    """뉴런별 효율성 측정 — 실측 기반 통합/축소 판단 재료."""

    async def compute(self, neuron_type: str, period: str = "7d") -> dict:
        return {
            # 활성화 대비 실제 사용 비율
            "activation_utilization": await self.activation_utilization(neuron_type, period),

            # 이 뉴런이 없을 때와 있을 때 사용자 만족도 차이
            "marginal_satisfaction": await self.marginal_satisfaction(neuron_type, period),

            # 이 뉴런의 응답이 최종 출력에 기여한 비율
            "output_contribution": await self.output_contribution(neuron_type, period),

            # 이 뉴런을 다른 뉴런에 흡수해도 품질에 영향 없는지
            "merge_feasibility_score": await self.merge_feasibility(neuron_type, period),

            # 리소스 사용량 대비 가치
            "resource_efficiency": await self.resource_efficiency(neuron_type, period),
        }
```

**통합 판단 기준:**
- `activation_utilization` < 20%: 거의 안 쓰임 → 통합 후보
- `marginal_satisfaction` < 0.05: 있어도 만족도 변화 없음 → 통합 후보
- `output_contribution` < 10%: 최종 출력에 거의 기여 안 함 → 통합 후보
- 위 세 조건 중 2개 이상 충족 시: **뉴런 통합 검토 시작**

### 11.3 모니터링 대시보드

```
┌─────────────────────────────────────────────────────────┐
│              Neuron Operations Dashboard                │
│                                                         │
│  활성 세션: 1,234     활성 뉴런: 3,891                 │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 뉴런별 활성 분포 (실시간)                       │    │
│  │ 공감:  100% (상시 활성)                         │    │
│  │ 답변:  78%  ████████░░                          │    │
│  │ 큐:    12%  █░░░░░░░░░                          │    │
│  │ 비주얼: 23% ██░░░░░░░░                          │    │
│  │ 커스텀:  5% ░░░░░░░░░░                          │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 응답 시간 분포 (P50 / P95 / P99)              │    │
│  │ 공감:   120ms / 340ms / 480ms                  │    │
│  │ 답변:   1.2s  / 4.5s  / 12s                    │    │
│  │ 비주얼: 3.1s  / 8.2s  / 18s                    │    │
│  │ 큐 판별: 80ms / 200ms / 350ms                  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  페르소나 가드 수정률: 3.2% (목표 ≤ 5%)               │
│  뉴런 오류율: 0.8%                                      │
│  사용자 "여러 명" 체감: 2.1% (목표 ≤ 5%)              │
└─────────────────────────────────────────────────────────┘
```

---

## 12. 구현 로드맵

### Phase 1: 기반 구축 (4~6주)

| 작업 | 산출물 |
|------|--------|
| Supabase 스키마 생성 | 마이그레이션 파일 |
| Stream Chat 채널 설계 | 채널/이벤트 정의서 |
| LangGraph 기본 그래프 (공감 + 답변) | `neuron_graph.py` |
| Whisper v3 Turbo STT 파이프라인 | `stt_service.py` |
| 기본 페르소나 주입 + Persona Guard | `persona.py` |

### Phase 2: 뉴런 확장 (4~6주)

| 작업 | 산출물 |
|------|--------|
| 큐 에이뉴런 구현 (분류 + 병합) | `queue_neuron.py` |
| 비주얼 에이뉴런 구현 | `visual_neuron.py` |
| Temporal.io 워크플로우 통합 | `workflow.py` |
| 동적 연결/해제 프로토콜 | `neuron_bus.py` |
| 컨텍스트 동기화 구현 | `context_sync.py` |

### Phase 3: 고도화 (4~6주)

| 작업 | 산출물 |
|------|--------|
| Custom 뉴런 인터페이스 + 레지스트리 | `neuron_registry.py` |
| 스킬 마켓 연동 (뉴런 등록/발견) | API 엔드포인트 |
| 기억 압축 구현 | `memory_compaction.py` |
| 페르소나 튜닝 파이프라인 | `persona_tuning.py` |
| 효율성 측정 + 대시보드 | 모니터링 시스템 |

### Phase 4: 최적화 (지속)

| 작업 | 판단 기준 |
|------|-----------|
| 뉴런 통합/축소 | §11.2 효율성 지표 |
| 모델 라우팅 최적화 | 비용 대비 품질 |
| 캐싱 전략 고도화 | 히트율 |
| 글로벌 배포 (다중 리전) | 백서 4.4절 클러스터링 |

---

## 부록 A: 결정 기록 (Decision Log)

| # | 결정 | 근거 | 대안 |
|---|------|------|------|
| D1 | LangGraph + Temporal 이중 구조 | LangGraph: LLM 그래프에 최적화, Temporal: 장기 실행 지속성 | LangGraph 단독 (재시도 부족), Temporal 단독 (LLM 그래프 표현력 부족) |
| D2 | 공감 뉴런 상시 활성 | 사용자 입력 즉시 응답이 핵심 체감 | Router 먼저 돌리기 (지연시간 +200ms) |
| D3 | Supabase Realtime for 컨텍스트 | 이미 DB로 사용 중, 추가 인프라 불필요 | Redis Pub/Sub (더 빠르지만 인프라 추가) |
| D4 | append-only 컨텍스트 패치 | 감사 추적, 시계열 분석 가능 | in-place 업데이트 (히스토리 손실) |
| D5 | 뉴런별 모델 분리 | 비용 최적화 (공감=경량, 답변=고성능) | 단일 모델 (비용 비효율) |

## 부록 B: 미결정 항목 (Open Questions)

| # | 항목 | 필요 조치 | 우선순위 |
|---|------|-----------|----------|
| O1 | 4종 뉴런이 최적인지 여부 | Phase 2 완료 후 실측 데이터로 판단 | High |
| O2 | 커스텀 뉴런 간 직접 통신 허용 여부 | 보안 리스크 검토 필요 | Medium |
| O3 | 페르소나 가드 LLM 검사의 비용 대비 효과 | A/B 테스트 필요 | Medium |
| O4 | Whisper v3 Turbo vs 대안 STT (Deepgram 등) | 벤치마크 비교 필요 | Low (현재 선택 유지) |
| O5 | Temporal.io vs alternatives (Inngest, Hatchet) | 운영 복잡도 비교 | Low (현재 선택 유지) |

---

*이 문서는 살아있는 문서로, 구현 과정에서 발견되는 사항에 따라 갱신된다. 특히 부록 B의 미결정 항목들은 해당 Phase 진입 시점에 반드시 재검토한다.*
