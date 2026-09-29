import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  defaultLocale: process.env.DEFAULT_LOCALE === 'en' ? 'en' as const : 'ko' as const,
  // 처리 지연이 이 시간을 넘으면 단계 진행도 quip을 이어 붙인다 (t_b2b86cd6).
  quipPatienceMs: parseInt(process.env.QUIP_PATIENCE_MS || '15000', 10),
  // 공감 확인음 노출 후 답변 스트리밍 시작 전 체감 공백 (t_344e047a, 대표님 9/28). 0이면 즉시 시작.
  answerLeadMs: parseInt(process.env.ANSWER_LEAD_MS || '3000', 10),
  /** 후속 예상 질문 2~3개 생성 (t_344e047a ③) — answer 완료 후 비동 보강. 실패 시 조용히 생략. */
  suggestedQuestions: {
    enabled: process.env.SUGGEST_QUESTIONS_DISABLED !== 'true',
    timeoutMs: parseInt(process.env.SUGGEST_QUESTIONS_TIMEOUT_MS || '6000', 10),
  },
  /** 질문 큐 (t_344e047a): 실행 중 끼어든 발화의 유실 방지 — 세션 대기 상한/워커 라운드캡. */
  questionQueue: {
    maxPending: parseInt(process.env.QUEUE_MAX_PENDING || '20', 10),
    /** 워커 1라운드에서 순차 처리할 최대 항목 (나머지는 다음 라운드). */
    maxBatch: parseInt(process.env.QUEUE_MAX_BATCH || '5', 10),
  },
  // MVP는 보존 정책만 선언한다. 자동 삭제 크론은 Phase 3, 탈퇴 시에는 즉시 파기한다.
  retention: { rawTranscriptDays: Number(process.env.RAW_TRANSCRIPT_RETENTION_DAYS || 180) },
  devMode: process.env.DEV_MODE === 'true',

  /** 대화 유형 판별 (t_56498848) — Stage 2 LLM 분류·Stage 4 REST 엔드 여부. Stage1/3 규칙은 상시.
   *  테스트 토글: vi.spyOn(config.classification, 'llmEnabled', 'get') — config.perplexity 컨벤션 동일. */
  classification: {
    llmEnabled: process.env.CLASSIFY_LLM_DISABLED !== 'true',
    timeoutMs: parseInt(process.env.CLASSIFY_LLM_TIMEOUT_MS || '1500', 10),
    /** 분류 전용 저비용 모델 (미설정 시 chatLlm.model 상속). */
    model: process.env.CLASSIFY_LLM_MODEL || '',
    /** Stage 4 REST 엔드(POST /api/classify) — OFF 시 404. 기본 켬(인증 필요, 무료). */
    endpointEnabled: process.env.CLASSIFY_ENDPOINT_DISABLED !== 'true',
  },

  cors: {
    // t_d75ca81c: 프로덕션 웹(app.myagenttalk.com)을 기본 허용 — 모바일/PC 웹이 같은 API·DB를 연속 사용.
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:8081', 'http://localhost:5173', 'https://app.myagenttalk.com', 'https://myagenttalk.com', 'https://www.myagenttalk.com'],
  },
  
  supabase: {
    url: process.env.SUPABASE_URL || 'http://localhost:54321',
    anonKey: process.env.SUPABASE_ANON_KEY || 'mock-anon-key',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-key',
  },
  
  streamChat: {
    apiKey: process.env.STREAM_CHAT_API_KEY || '',
    apiSecret: process.env.STREAM_CHAT_API_SECRET || '',
  },
  
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    whisperModel: process.env.WHISPER_MODEL || 'whisper-1', // Whisper v3 Turbo (OpenAI API에서는 whisper-1이 최신)
    // STT 오디오 기본 설정 (클라이언트는 16kHz PCM s16le 전송)
    stt: {
      sampleRate: 16000,
      encoding: 'pcm_s16le' as const,
      vadThreshold: 0.01,
      silenceBoundaryMs: 700,
      partialIntervalMs: 500,
    },
  },

  /**
   * 로컬 faster-whisper large-v3-turbo 사이드카 (t_1c7be18c, 대표님 9/29: "모든 STT = v3 turbo").
   * - url 설정 시 1순위 전사 경로. scripts/stt_sidecar.py(FastAPI, 127.0.0.1:9833)가 raw PCM을 받는다.
   * - 미설정(기본)이면 기존 OpenAI→mock 경로 — 단위 테스트·키 없는 DEV는 동작 불변.
   * - 사이드카 실패 시: 실 OpenAI 키 있으면 폴백, 없으면 STT_SERVICE_UNAVAILABLE.
   *   mock 고정 문장으로 조용히 내려가지 않는다 (같은 문장 반복 사고의 근원 차단).
   */
  sttSidecar: {
    url: (process.env.STT_SIDECAR_URL || '').replace(/\/+$/, ''),
    timeoutMs: parseInt(process.env.STT_SIDECAR_TIMEOUT_MS || '20000', 10),
  },

  /**
   * 볼트 도서관 (t_d469fac3, 대표님 9/30 "Spotify 도서관" 지시) — GET /api/vault/library.
   * 로컬 사이드카(scripts/vault_sidecar.py, 127.0.0.1:9834)의 BM25+임베딩 하이브리드 인덱스를
   * 관리자 토큰(x-vault-key)으로 게이트한다. url·adminToken 미설정(기본) 시 엔드 404 —
   * 단위 테스트·키 없는 DEV는 동작 불변. 볼트는 에이전트 공용 인프라라 앱 사용자 JWT와
   * 레인을 분리한다(vault_notes의 /api/vault/search와 무관).
   */
  vaultLibrary: {
    url: (process.env.VAULT_SIDECAR_URL || '').replace(/\/+$/, ''),
    adminToken: process.env.VAULT_ADMIN_TOKEN || '',
    timeoutMs: parseInt(process.env.VAULT_SIDECAR_TIMEOUT_MS || '8000', 10),
  },

  /**
   * 채팅 답변 생성 LLM (DashScope OpenAI 호환 모드).
   * - apiKey: CHAT_LLM_API_KEY 우선, 없으면 DASHSCOPE_API_KEY
   * - baseUrl/model: 환경변수로 오버라이드 가능 (기본: dashscope-intl + qwen3-max)
   * - enableThinking: qwen3 하이브리드 모델의 reasoning 모드 (미설정 시 파라미터 전송 안 함)
   */
  chatLlm: {
    enabled: process.env.CHAT_LLM_DISABLED !== 'true',
    apiKey: process.env.CHAT_LLM_API_KEY || process.env.DASHSCOPE_API_KEY || '',
    baseUrl: process.env.CHAT_LLM_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: process.env.CHAT_LLM_MODEL || 'qwen3-max',
    maxTokens: parseInt(process.env.CHAT_LLM_MAX_TOKENS || '1024', 10),
    timeoutMs: parseInt(process.env.CHAT_LLM_TIMEOUT_MS || '60000', 10),
    temperature: process.env.CHAT_LLM_TEMPERATURE ? parseFloat(process.env.CHAT_LLM_TEMPERATURE) : 0.8,
    enableThinking: process.env.CHAT_LLM_ENABLE_THINKING === 'true' ? true : process.env.CHAT_LLM_ENABLE_THINKING === 'false' ? false : null,
    historyTurns: parseInt(process.env.CHAT_LLM_HISTORY_TURNS || '20', 10),
  },

  
  /**
   * Perplexity Sonar 검색 그라운딩 (t_d54bc456) — 법률·회계·의료 전문가 카테고리
   * 답변만 호출한다(종량제 비용 제어). 키: .env PERPLEXITY_API_KEY.
   */
  /**
   * LLM 비상전원 (t_67eaf475) — DashScope 장애 시 자동 전환되는 Anthropic 호환 폴백.
   * /v1/chat/completions 규격 공통 엔드포인트라 llm.ts는 프로바이더 분기 없이 풀 순회만 한다.
   * 키: CHAT_LLM_FB_KEY (백엔드 .env). 미설정 시 폴백 미구성 = 기존 동작과 동일.
   * 기본 모델 claude-opus-4-5.
   */
  chatLlmFallback: {
    disabled: process.env.CHAT_LLM_FB_DISABLED === 'true',
    apiKey: process.env.CHAT_LLM_FB_KEY || '',
    baseUrl: process.env.CHAT_LLM_FB_BASE_URL || 'https://api.anthropic.com/v1',
    model: process.env.CHAT_LLM_FB_MODEL || 'claude-opus-4-5',
    timeoutMs: parseInt(process.env.CHAT_LLM_FB_TIMEOUT_MS || '60000', 10),
  },

  perplexity: {
    enabled: process.env.PERPLEXITY_DISABLED !== 'true',
    apiKey: process.env.PERPLEXITY_API_KEY || '',
    baseUrl: process.env.PERPLEXITY_BASE_URL || 'https://api.perplexity.ai',
    model: process.env.PERPLEXITY_MODEL || 'sonar-pro',
    timeoutMs: parseInt(process.env.PERPLEXITY_TIMEOUT_MS || '20000', 10),
    searchContextSize: (process.env.PERPLEXITY_SEARCH_CONTEXT || 'medium') as 'low' | 'medium' | 'high',
    maxSources: parseInt(process.env.PERPLEXITY_MAX_SOURCES || '3', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'agenttalk-dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  /**
   * 첨부 업로드 (t_401c5bd1, 카드 B안) — POST /api/upload → Storage 버킷 attachments.
   * - maxBytes: 파일당 상한 20MB (multipart fileSizeLimit와 동일 값 — 초과 스트림 413)
   * - maxPerDay: 사용자당 UTC 일일 카운터 (upload_quota_daily 테이블, 라우트 UPSERT)
   * - allowedMimes: allowlist (image/* 프리픽스 매칭 + 정확매칭 PDF)
   */
  upload: {
    maxBytes: parseInt(process.env.UPLOAD_MAX_BYTES || String(20 * 1024 * 1024), 10),
    maxPerDay: parseInt(process.env.UPLOAD_MAX_PER_DAY || '50', 10),
    bucket: process.env.UPLOAD_BUCKET || 'attachments',
    allowedMimes: (process.env.UPLOAD_ALLOWED_MIMES || 'image/*,application/pdf')
      .split(',').map(s => s.trim()).filter(Boolean),
  },

  /**
   * 앱 속 실 김비서 브리지 (t_620d5549, 대표님 9/28 "텔레그램 대신 저거로 김비서를 쓸 수 있게")
   * - endpoint: Hermes kimsecretary 게이트웨이의 A2A 수신 URL. 미설정(기본) 시 브리지 OFF —
   *   김비서 room도 기존 로컬 파이프라인과 1:1 동일 동작. skyserver 내부 루프(127.0.0.1)만 허용.
   * - timeoutMs: 김비서 응답 대기 상한. 초과 시 조용한 폴백(원인 문장 답변 + 로컬 흐름 계속).
   * - maxTurns: A2A 컨텍스트당 소프트 자전 임계 (서버 안티루프 하드캡 20보다 낮게).
   */
  secretaryBridge: {
    endpoint: process.env.SECRETARY_BRIDGE_ENDPOINT || '',
    timeoutMs: parseInt(process.env.SECRETARY_BRIDGE_TIMEOUT_MS || '180000', 10),
    maxTurns: parseInt(process.env.SECRETARY_BRIDGE_MAX_TURNS || '15', 10),
  },

  /**
   * 뉴런 오케스트레이션 엔진 선택:
   * - 'langgraph': LangGraph StateGraph 기반 (설치/런타임 정상 시)
   * - 'simple'   : 동일 노드 로직을 순차 파이프라인으로 실행 (폴백)
   */
  neuronEngine: process.env.NEURON_ENGINE || 'langgraph',

  ws: {
    pingIntervalMs: 30000,
    pongTimeoutMs: 60000,
    // 오디오 세션당 최대 청크 버퍼 (10초 ≈ 320KB @16kHz/16bit)
    maxAudioBufferMs: 10000,
  },

  /**
   * Push-to-Talk (t_d75ca81c) — PTT는 기존 audio.start/end 캐리어 위 상태머신.
   * 릴리스 이벤트가 도달하지 않는 runaway 세션의 서버측 안전망 두 개:
   *  - silenceTimeoutMs: 이 시간 동안 무음이면 세그먼트 종료 판단 (기본 30s)
   *  - maxHoldMs: 홀드 상한. buffer 순환과 무관하게 세그먼트를 강제 종료 (기본 5분)
   */
  pushToTalk: {
    silenceTimeoutMs: parseInt(process.env.PTT_SILENCE_TIMEOUT_MS || '30000', 10),
    maxHoldMs: parseInt(process.env.PTT_MAX_HOLD_MS || '300000', 10),
  },
};

/** 운영 필수 설정 누락 시 서버 기동을 중단한다. */
export function validateConfig(): void {
  if (config.devMode) return;
  if (!process.env.SUPABASE_URL?.trim()) throw new Error('SUPABASE_URL이 필요합니다.');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key || key.startsWith('mock')) throw new Error('유효한 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret === 'agenttalk-dev-secret-change-in-production') throw new Error('운영용 JWT_SECRET이 필요합니다.');
}
