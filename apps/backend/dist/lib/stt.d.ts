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
    service: 'openai' | 'mock';
}
/**
 * PCM 버퍼를 텍스트로 변환.
 * - 실서비스: OpenAI Whisper API 호출
 * - DEV_MODE: mock 응답 (음성 신호 존재 여부 기준)
 */
export declare function transcribeAudio(data: Buffer): Promise<TranscribeResult>;
/** 문장 경계 분리 — partial/final 트랜스크립트 분할용 */
export declare function splitSentences(text: string): string[];
//# sourceMappingURL=stt.d.ts.map