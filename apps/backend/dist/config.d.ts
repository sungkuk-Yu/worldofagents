export declare const config: {
    port: number;
    host: string;
    defaultLocale: "en" | "ko";
    /** 사용자당 에이전트 생성 한도 (api-design.md §6). DEV_MODE에서는 무제한. */
    maxAgentsPerUser: number;
    quipPatienceMs: number;
    answerLeadMs: number;
    /**
     * 사람 타이핑 감각 딜레이 (t_a654c9ac, 대표님 10/4 "바로 대답하면 너무 빠라. 사람이 직접
     * 타이핑 하든거처럼"): 답변 첫 토큰 전 리드는 발화 길이 비율로 0.8~2.0s 랜덤,
     * 스트리밍 출력은 타이핑 속도(구간 랜덤)·버스트 청크·문장부호 pause로 의류 보낸다.
     * 기본 ON, HUMAN_TYPING=false로 OFF(기존 즉시 동작).
     * t_883ff7b3 (대표님 10/11 "답변들이 flash인데도 오래걸린다, 체감 5분"): industry(Claude/
     * Grok/Dot) 출력 체감 120~280자/s 대비 10배 느린 병목 상향 — 기본 12/25→90/140cps,
     * pause 상한 350→150(감성은 유지·크기만 업계 정합), 장문(>600자)은 pacing 완전 bypass.
     * 즉시 롤백은 env 재지정(TYPING_CPS_MIN=12 TYPING_CPS_MAX=25 TYPING_SENTENCE_PAUSE_MS=350
     * TYPING_LONG_BYPASS_CHARS=0) — 코드는 env 경로만 유지한다.
     * 단위 테스트는 HUMAN_TYPING=false로 봉인 — 리듬 검증은 전용 단위 + 실WS 스모크가 담당.
     */
    humanTyping: {
        enabled: boolean;
        /** 답변 첫 토큰 전 사람 리드타임 범위(ms) — 발화 길이 ×50ms 곡선으로 보간, ±15% 지터. */
        leadMinMs: number;
        leadMaxMs: number;
        /** 타이핑 속도 범위(자/초) — t_883ff7b3 industry 하~중간값(12~25→90~140). */
        cpsMin: number;
        cpsMax: number;
        /** 문장부호(.!?。newline) 뒤 미세 pause(ms 상한, 균등 랜덤). t_883ff7b3: 350→150 —
         *  감성 장치는 유지하되 체감 CPS 게이트(front median ≥80자/s)를 침범하지 않는 크기로. */
        sentencePauseMs: number;
        /**
         * 장문 패스 임계(자, t_883ff7b3 대표님 10/11): 스트림 누적 답변이 이 크기를 넘치는
         * 순간 사람 타이핑 연출을 접고 잔여 전량 즉시 flush, 이후 delta는 도착 즉시 전달
         * (LLM 스트림 속도 = 노출 속도). 2,000자 답변의 100초+ 연주가 '즉시 패스'로 사라진다.
         * 0이면 비활성화(전 구간 pacing 유지). 짧은 답변만연출 리듬 유지.
         */
        longBypassChars: number;
        /** 취소·타임아웃 방패: 이 pacing으로 스트리밍이 늘어질 때 답변 전체 추가 지연 상한(ms). */
        maxTotalDelayMs: number;
        /** 재질문 카드가 뜬 턴의 자동예 진행 플로어(ms) — 프론트 예/아니오 칩 창(2.5s) 소진 보장. */
        chipFloorMs: number;
        /** 플로어 위에 얹는 랜덤 지터 상한(ms) — 게이트 계약 '자동예 진행 ≤2.6s' = floor+jitter. */
        chipJitterMs: number;
    };
    /**
     * 공감 재질문 LLM 재해석 (t_a654c9ac, 대표님 10/4 추가 판정): 재질문 문구는 LLM으로
     * 자연스러운 한국어 의문문('궁금하신거죠?' 계열)을 생성하되, 결정성 계약은 '문구 고정'이
     * 아니라 '항상 재질문이 존재' — 실패/타임아웃/비결정 시에만 기존 4템플릿 규칙 폴백.
     */
    empathyRequestLlm: {
        enabled: boolean;
        timeoutMs: number;
    };
    /**
     * 로컬 front desk (t_82cc0d99): 공감/ack 앞단 처리를 로컬 ollama로 우선 수행,
     * 실패/타임아웃 시 cloud LLM으로 폴백. 기본 OFF (ENABLED=true로 활성화).
     */
    localFrontDesk: {
        enabled: boolean;
        baseUrl: string;
        model: string;
        timeoutMs: number;
    };
    /** 후속 예상 질문 2~3개 생성 (t_344e047a ③) — answer 완료 후 비동 보강. 실패 시 조용히 생략. */
    suggestedQuestions: {
        enabled: boolean;
        timeoutMs: number;
    };
    /** 질문 큐 (t_344e047a): 실행 중 끼어든 발화의 유실 방지 — 세션 대기 상한/워커 라운드캡. */
    questionQueue: {
        maxPending: number;
        /** 워커 1라운드에서 순차 처리할 최대 항목 (나머지는 다음 라운드). */
        maxBatch: number;
    };
    retention: {
        rawTranscriptDays: number;
    };
    devMode: boolean;
    /** 대화 유형 판별 (t_56498848) — Stage 2 LLM 분류·Stage 4 REST 엔드 여부. Stage1/3 규칙은 상시.
     *  테스트 토글: vi.spyOn(config.classification, 'llmEnabled', 'get') — config.perplexity 컨벤션 동일. */
    classification: {
        llmEnabled: boolean;
        timeoutMs: number;
        /** 분류 전용 저비용 모델 (미설정 시 chatLlm.model 상속). */
        model: string;
        /** Stage 4 REST 엔드(POST /api/classify) — OFF 시 404. 기본 켬(인증 필요, 무료). */
        endpointEnabled: boolean;
    };
    cors: {
        origin: string[];
    };
    supabase: {
        url: string;
        anonKey: string;
        serviceKey: string;
    };
    streamChat: {
        apiKey: string;
        apiSecret: string;
    };
    openai: {
        apiKey: string;
        whisperModel: string;
        stt: {
            sampleRate: number;
            encoding: "pcm_s16le";
            vadThreshold: number;
            silenceBoundaryMs: number;
            partialIntervalMs: number;
        };
    };
    /**
     * 로컬 faster-whisper large-v3-turbo 사이드카 (t_1c7be18c, 대표님 9/29: "모든 STT = v3 turbo").
     * - url 설정 시 1순위 전사 경로. scripts/stt_sidecar.py(FastAPI, 127.0.0.1:9833)가 raw PCM을 받는다.
     * - 미설정(기본)이면 기존 OpenAI→mock 경로 — 단위 테스트·키 없는 DEV는 동작 불변.
     * - 사이드카 실패 시: 실 OpenAI 키 있으면 폴백, 없으면 STT_SERVICE_UNAVAILABLE.
     *   mock 고정 문장으로 조용히 내려가지 않는다 (같은 문장 반복 사고의 근원 차단).
     */
    sttSidecar: {
        url: string;
        timeoutMs: number;
    };
    /**
     * 볼트 도서관 (t_d469fac3, 대표님 9/30 "Spotify 도서관" 지시) — GET /api/vault/library.
     * 로컬 사이드카(scripts/vault_sidecar.py, 127.0.0.1:9834)의 BM25+임베딩 하이브리드 인덱스를
     * 관리자 토큰(x-vault-key)으로 게이트한다. url·adminToken 미설정(기본) 시 엔드 404 —
     * 단위 테스트·키 없는 DEV는 동작 불변. 볼트는 에이전트 공용 인프라라 앱 사용자 JWT와
     * 레인을 분리한다(vault_notes의 /api/vault/search와 무관).
     */
    vaultLibrary: {
        url: string;
        adminToken: string;
        timeoutMs: number;
    };
    /**
     * 채팅 답변 생성 LLM (DashScope OpenAI 호환 모드).
     * - apiKey: *** 우선, 없으면 DASHSCOPE_API_KEY
     * - baseUrl/model: 환경변수로 오버라이드 가능.
     * - t_20746efa two-speed (대표님 10/10 확정 계약): 기본 모델 = front desk —
     *   항상 가볍게 도는 qwen3.8-flash 무검색 즉시 응대선. 예전 기본 qwen3-max는
     *   평상 답변까지 고모델로 끌어 지연시킨 실측의 주범이라 강등한다.
     * - deepModel: back stage — 라우터가 '깊이 필요'(법률/세무/시사)로 판정한 턴만
     *   이 모델로 승격(빈 값=승격 없음, front 모델 유지). 미지정 모델명 400 방지를
     *   위해 코드 기본값은 없다 — 게이트웨이에서 실증된 모델명만 .env로 주입.
     * - enableThinking: qwen3 하이브리드 모델의 reasoning 모드 (미설정 시 파라미터 전송 안 함).
     *   t_baee5c42: 전역 스위치로 누르면 depth lane까지 thinking OFF — 게이트1 FAIL은
     *   answerNode의 lane별 opts.enableThinking 강제(front=false 강제 전송, deep=미전송
     *   현행 유지)로 교정한다. 이 값은 callChat 미지정 호출(보조 경로)의 기본.
     */
    chatLlm: {
        enabled: boolean;
        apiKey: string;
        baseUrl: string;
        model: string;
        deepModel: string;
        maxTokens: number;
        timeoutMs: number;
        /**
         * t_1b2974b4: front lane 스트리밍 first-token 데드라인(ms) — 첫 SSE delta까지의 상한.
         * 초과 시 abort → retryable → chatCompletion이 비상전원으로 자동 전환.
         * 0/미설정=기본 3000 안팎 권장(10/11 실측 TTFT med 583ms·tf→첫 delta med 1803ms 기준), 0 이하 설정 시 미적용.
         * deep lane(thinking ON, 품질 우선)에는 미적용.
         */
        firstTokenMs: number;
        temperature: number;
        enableThinking: boolean | null;
        historyTurns: number;
    };
    /**
     * Perplexity Sonar 검색 그라운딩 (t_d54bc456) — t_20746efa(대표님 10/10 two-speed 확정):
     * **기본 OFF**. 매 턴 선행검색 영구 폐기 — 평상 답변은 front desk(flash·무검색)가 즉시 답하고,
     * 라우터가 '깊이 필요'(법률/세무/시사)로 판정한 턴만 back stage가 이 엔진으로 근거 초안을 만든다.
     * opt-in: PERPLEXITY_ENABLED=true + 키. 종량제 비용 게이트는 그대로.
     */
    /**
     * LLM 비상전원 (t_67eaf475) — DashScope 장애 시 자동 전환되는 Anthropic 호환 폴백.
     * /v1/chat/completions 규격 공통 엔드포인트라 llm.ts는 프로바이더 분기 없이 풀 순회만 한다.
     * 키: CHAT_LLM_FB_KEY (백엔드 .env). 미설정 시 폴백 미구성 = 기존 동작과 동일.
     * 기본 모델 claude-opus-4-5.
     */
    chatLlmFallback: {
        disabled: boolean;
        apiKey: string;
        baseUrl: string;
        model: string;
        timeoutMs: number;
    };
    perplexity: {
        enabled: boolean;
        apiKey: string;
        baseUrl: string;
        model: string;
        timeoutMs: number;
        searchContextSize: "low" | "medium" | "high";
        maxSources: number;
    };
    /**
     * 나라맞춤법(PNU) 후처리 게이트 (t_45256c7a) — ko 답변 최종 텍스트 교정.
     * 기본 OFF: speller-api는 LICENSE 파일 없음(9/30 GitHub API 확인) — 나라 인포테크 위탁 서비스의 상업 이용 조건 확인 후 deploy.env에서 켠다.
     * URL은 나라 스펠러 신엔드(/api/check, 9/30 실측) 또는 jhaemin/speller-api 이식
     * 서버 어느 쪽이라도 — 파서가 {suggestions:[{start,end,text,candidates[]}}(speller-api)와
     * {errInfo:[{start,end,orgStr,candWord|구분}]}(nara 직접) 두 규격을 모두 흡수한다.
     * 실패 정책: 타임아웃/비200/파싱오류 = 원문 유지(턴 사망 금지, perplexity 컨벤션 동일).
     */
    naraSpeller: {
        enabled: boolean;
        url: string;
        timeoutMs: number;
        strict: boolean;
        /** 봇월 시 http2 폴백 (9/30 실측: nara는 h2만 통과). 단위 테스트는 'false' 봉인. */
        h2: boolean;
        /** t_f5a9b570 — 운영(전역) 고유명사 보호 사전, 콤마 구분. 코드 기본값과 합산된다. */
        protectedTerms: string[];
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    /**
     * 첨부 업로드 (t_401c5bd1, 카드 B안) — POST /api/upload → Storage 버킷 attachments.
     * - maxBytes: 파일당 상한 20MB (multipart fileSizeLimit와 동일 값 — 초과 스트림 413)
     * - maxPerDay: 사용자당 UTC 일일 카운터 (upload_quota_daily 테이블, 라우트 UPSERT)
     * - allowedMimes: allowlist (image/* 프리픽스 매칭 + 정확매칭 PDF)
     */
    upload: {
        maxBytes: number;
        maxPerDay: number;
        bucket: string;
        allowedMimes: string[];
    };
    /**
     * context_patches 콜드 아카이브 잡 (t_848d0c3b, 설계: 볼트 10-01 §3).
     * - enabled: 실DB 쓰기 게이트 — **기본 false**. systemd timer 설치 + env 켬 + 김비서
     *   배치 승인(카드 ④: 첫 배치 DELETE 예외 결재)이 모두 있어야 원본에 손댄다.
     *   꺼져 있으면 잡은 아무것도 하지 않고 종료한다(감사 로그만).
     * - hotWindowDays: 이 창을 지난 패치가 cold 후보 (CONTEXT_PATCH_HOT_DAYS, 설계 기본 90).
     * - safetyLagHours: 어제의 경계도 흔들리지 않게 최신 24h은 무조건 hot (설계 SAFETY_LAG).
     * - bucket: private Storage 버킷명. anon/authenticated 정책 없음 — service_role 전용.
     */
    contextArchive: {
        enabled: boolean;
        hotWindowDays: number;
        safetyLagHours: number;
        bucket: string;
        /** 1회 실행에서 처리할 (session×월) 배치 상한 — 첫 실행 폭주 방지. */
        maxBatchesPerRun: number;
    };
    /**
     * 에이전트 브리지 (t_620d5549→t_d6578eb6, 대표님 10/19 "나중엔 다른 나라로 분리시킬 수 있게")
     *
     * 설계 원칙:
     * - 에이전트↔나라(유저 공간) 소속과 에이전트↔세션 어댑터 분리
     * - 브리지는 어댑터 레이어 — 같은 에이전트가 텔레그램 없이 다른 나라에 재소속 가능
     * - 현행(텔레그램/Hermes A2A 연동)은 유지, 확장만 열어둠
     *
     * agents: 에이전트 이름 → Hermes 프로필 매핑. ENV로 오버라이드 가능.
     *   AGENT_BRIDGES="김비서:kimsecretary:9902,내보좌관:leejungjae:9901,내변호사:hammurabi:9900"
     *   형식: "표시이름:프로필:포트,..." (쉼표 구분). 미설정 시 기본 세 에이전트 매핑.
     * timeoutMs: 에이전트 응답 대기 상한.
     * maxTurns: A2A 컨텍스트당 소프트 자전 임계 (서버 안티루프 하드캡 20보다 낮게).
     *
     * 하위호환: SECRETARY_BRIDGE_ENDPOINT가 설정되면 김비서 단독 구버전 모드 동작.
     */
    agentBridges: {
        agents: Record<string, {
            profile: string;
            port: number;
            endpoint: string;
            adapter: "hermes-a2a";
        }>;
        timeoutMs: number;
        maxTurns: number;
    };
    readonly secretaryBridge: {
        endpoint: string;
        timeoutMs: number;
        maxTurns: number;
    };
    /**
     * 메시지 프로토콜 (t_3486b1d7, 대표님 9/29 텔레그램标准 이식 + 김비서 4턴 A2A 확정 필드 계약).
     * 롤백 게이트: 각 기능 env 플래그로 독립 온/오프 — off 시 484eec2f 베이스 동작과 1:1 동일.
     * - idempotency (DELTA… 생략, MESSAGE_IDEMPOTENCY_DISABLED): send 프레임 client_req_id 멱등
     *   (random_id 상당). 013 미적용 실DB는 래치로 컬럼 생략 폴백 (008/011 관례).
     * - userCardFirst (USER_CARD_FIRST=false로 off): user 카드(message.new)가 run.started보다 먼저,
     *   run.started에 user_message_id·persona line(run.progress)에 source_message_id 태움.
     * - deltaBatchMs/deltaBatchChars (DELTA_BATCH_MS, DELTA_BATCH_CHARS): answer.delta 백프레셔 —
     *   whichever-first 배칭. MS=0이면 비배칭(구동작).
     * - seqDiffSync (EVENT_SYNC_DISABLED=true로 off): GET /:id/events?after_seq (getDifferences 상당)
     *   + subscribed/events의 seq_epoch (서버 재기동 시 버퍼 에포크 교체 → 클라이언트 전량 캐치업 신호).
     */
    protocol: {
        idempotency: boolean;
        userCardFirst: boolean;
        empathyEarly: boolean;
        frontDeskFirstTokenMs: number;
        frontDeskTtftBudgetMs: number;
        deltaBatchMs: number;
        deltaBatchChars: number;
        seqDiffSync: boolean;
    };
    /**
     * 뉴런 오케스트레이션 엔진 선택:
     * - 'langgraph': LangGraph StateGraph 기반 (설치/런타임 정상 시)
     * - 'simple'   : 동일 노드 로직을 순차 파이프라인으로 실행 (폴백)
     */
    neuronEngine: string;
    /**
     * 내구성 실행 (t_7182aa8f, 자비스 오케스트레이션 [4]) — LangGraph 체크포인터 + 런 저널.
     * - LANGGRAPH_CHECKPOINT=true: run 단위 스레드(thread_id=run_id)로 슈퍼스텝마다 상태를
     *   graph_checkpoints에 직렬화하고, graph_runs 레시피로 재시작 후 미완 run을 resume한다.
     * - 기본 false: 현행 무영속 경로와 1:1 동일 (롤백 게이트 — 대표님 9/29 전보드 지시).
     * 014 미적용 실DB는 첫 조회 실패(PGRST205)에서 래치되어 조용히 꺼진다 (008 관례).
     */
    runCheckpoint: {
        enabled: boolean;
        /** 부팅 resume 스캔 캡 — 한 번에 되살릴 최대 미완 run ( 폭주 방패 ). */
        maxResumePerBoot: number;
        /** resume 대상 최소 경과(ms) — 크래시로 막 죽은 run만 대상 (정상 진행과의 레이스 회피). */
        resumeMinAgeMs: number;
    };
    ws: {
        pingIntervalMs: number;
        pongTimeoutMs: number;
        maxAudioBufferMs: number;
    };
    /**
     * Push-to-Talk (t_d75ca81c) — PTT는 기존 audio.start/end 캐리어 위 상태머신.
     * 릴리스 이벤트가 도달하지 않는 runaway 세션의 서버측 안전망 두 개:
     *  - silenceTimeoutMs: 이 시간 동안 무음이면 세그먼트 종료 판단 (기본 30s)
     *  - maxHoldMs: 홀드 상한. buffer 순환과 무관하게 세그먼트를 강제 종료 (기본 5분)
     */
    pushToTalk: {
        silenceTimeoutMs: number;
        maxHoldMs: number;
    };
};
/** 운영 필수 설정 누락 시 서버 기동을 중단한다. */
export declare function validateConfig(): void;
//# sourceMappingURL=config.d.ts.map