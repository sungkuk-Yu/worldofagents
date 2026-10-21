export interface STTChunk {
    text: string;
    isFinal: boolean;
    confidence: number;
    language: string;
}
/** PCM16 부분을 RMS로 변환 — 음성 활동 감지용 */
export declare function pcm16Rms(samples: Int16Array): number;
/** 실제 음성(진폭) 감지 */
export declare function hasVoiceActivity(data: Buffer, threshold?: number): boolean;
/** 무음 후 마지막 포인트 탐색 (문장 경계 후보) */
export declare function findLastVoiceSample(data: Buffer, threshold?: number): number;
/**
 * 오디오 스트림 버퍼 — 청크 누적, VAD/문장 경계 판단.
 * 16kHz 16bit 모노 = 16000 samples/s = 32000 byte/s
 */
export declare class AudioStreamBuffer {
    private maxMs;
    private silenceBoundaryMs;
    private chunks;
    private byteLength;
    constructor(maxMs?: number, silenceBoundaryMs?: number);
    get byteRate(): number;
    push(chunk: Buffer): void;
    get bundle(): Buffer;
    get durationMs(): number;
    get hasSignal(): boolean;
    clear(): void;
    /** 무음 구간이 문장 경계 기준을 넘었는지 (후속 트랜스크립트 트리거) */
    hasSilenceBoundary(data: Buffer): boolean;
}
export interface TranscribeResult {
    text: string;
    confidence: number;
    language: string;
    durationMs: number;
    service: 'openai' | 'mock' | 'local';
}
/** DEV/mock 전사 고정 문장 (키·사이드카 부재 폴백). 실DB 오염 감사의 단일 식별 키 —
 *  t_5cba9ebb 3항: user 행 content=이 문장 & stt_metadata.service='mock' → 메타 교정 대상.
 *  스크립트가 문자열 재하드코딩 대신 여기서 import한다 (드리프트 방지). */
export declare const MOCK_STT_PHRASE = "\uC548\uB155\uD558\uC138\uC694, \uC624\uB298 \uD560 \uC77C\uC744 \uC815\uB9AC\uD574 \uC8FC\uC138\uC694.";
/**
 * Whisper 유효 언어 코드 정규화 (t_827dcbcc 'is' 오전사):
 * client config.language는 'auto'·'ko-KR'류 태그·임의 문자열 가능 — BCP47 1차 서브태그를
 * 취해 ISO-like 2~3자만 통과시킨다(그 외엔 undefined=자동감지 유지, 하위호환).
 * 'auto'를 그대로 넘기면 faster-whisper가 ValueError(500)를 던진다(실측).
 * 우선순위(카드 계약#1): client 명시 힌트 > 세션/요청 locale > config.defaultLocale(기본 ko).
 */
export declare function normalizeSttLanguageHint(language: string | null | undefined): string | undefined;
/**
 * PCM 버퍼를 텍스트로 변환.
 * - 1순위: 로컬 faster-whisper v3-turbo 사이드카 (STT_SIDECAR_URL 설정 시, t_1c7be18c)
 * - 2순위: OpenAI Whisper API (실 키 보유 시)
 * - 키 없고 사이드카도 없는 DEV/mock: 음성 신호 여부 기반 mock 응답 (플로우 검증용)
 * - 사이드카 설정 후 실패 시: mock 고정 문장으로 조용히 대체하지 않고 STT_SERVICE_UNAVAILABLE.
 * language(t_827dcbcc): 언어 힌트(client config.language > 세션 locale). undefined/'auto'는
 * 자동감지 유지(하위호환) — 유효 코드는 사이드카 ?language=로 전달해 'is'류 오감지를 차단한다.
 */
export declare function transcribeAudio(data: Buffer, language?: string): Promise<TranscribeResult>;
/** 문장 경계 분리 — partial/final 트랜스크립트 분할용 */
export declare function splitSentences(text: string): string[];
//# sourceMappingURL=stt.d.ts.map