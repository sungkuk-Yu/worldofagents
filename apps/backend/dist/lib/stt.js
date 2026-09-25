"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioStreamBuffer = void 0;
exports.pcm16Rms = pcm16Rms;
exports.hasVoiceActivity = hasVoiceActivity;
exports.findLastVoiceSample = findLastVoiceSample;
exports.transcribeAudio = transcribeAudio;
exports.splitSentences = splitSentences;
/**
 * Whisper v3 Turbo STT 파이프라인 (neuron-architecture-spec §5.4)
 * - PCM 16kHz s16le 오디오 청크 버퍼링
 * - VAD(음성 활동 감지): RMS 임계값 기반
 * - 무음 경계 기반 문장 분리 → 부분(partial)/최종(final) 트랜스크립트
 * - 실 트랜스크립션: OpenAI Whisper API (whisper-1 = v3 Turbo 노출명)
 * - DEV_MODE: API 키 없이 동작하는 mock (프로토콜/플로우 검증용)
 */
const config_1 = require("../config");
/** PCM16 부분을 RMS로 변환 — 음성 활동 감지용 */
function pcm16Rms(samples) {
    if (samples.length === 0)
        return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        const v = samples[i] / 32768;
        sum += v * v;
    }
    return Math.sqrt(sum / samples.length);
}
/** 실제 음성(진폭) 감지 */
function hasVoiceActivity(data, threshold = config_1.config.openai.stt.vadThreshold) {
    if (data.length < 2)
        return false;
    const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));
    return pcm16Rms(samples) >= threshold;
}
/** 무음 후 마지막 포인트 탐색 (문장 경계 후보) */
function findLastVoiceSample(data, threshold = config_1.config.openai.stt.vadThreshold) {
    const sampleCount = Math.floor(data.length / 2);
    if (sampleCount === 0)
        return -1;
    const samples = new Int16Array(data.buffer, data.byteOffset, sampleCount);
    for (let i = sampleCount - 1; i >= 0; i--) {
        if (Math.abs(samples[i] / 32768) >= threshold)
            return i;
    }
    return -1;
}
/**
 * 오디오 스트림 버퍼 — 청크 누적, VAD/문장 경계 판단.
 * 16kHz 16bit 모노 = 16000 samples/s = 32000 byte/s
 */
class AudioStreamBuffer {
    maxMs;
    silenceBoundaryMs;
    chunks = [];
    byteLength = 0;
    constructor(maxMs = config_1.config.ws.maxAudioBufferMs, silenceBoundaryMs = config_1.config.openai.stt.silenceBoundaryMs) {
        this.maxMs = maxMs;
        this.silenceBoundaryMs = silenceBoundaryMs;
    }
    get byteRate() {
        return config_1.config.openai.stt.sampleRate * 2;
    }
    push(chunk) {
        this.chunks.push(chunk);
        this.byteLength += chunk.length;
        const maxBytes = (this.maxMs / 1000) * this.byteRate;
        while (this.byteLength > maxBytes && this.chunks.length > 1) {
            this.byteLength -= this.chunks[0].length;
            this.chunks.shift();
        }
    }
    get bundle() {
        return Buffer.concat(this.chunks);
    }
    get durationMs() {
        return (this.byteLength / this.byteRate) * 1000;
    }
    get hasSignal() {
        return hasVoiceActivity(this.bundle);
    }
    clear() {
        this.chunks = [];
        this.byteLength = 0;
    }
    /** 무음 구간이 문장 경계 기준을 넘었는지 (후속 트랜스크립트 트리거) */
    hasSilenceBoundary(data) {
        const lastVoice = findLastVoiceSample(data);
        if (lastVoice < 0)
            return false;
        const bytesFromEnd = (data.length / 2 - lastVoice) * 2;
        const silenceMs = (bytesFromEnd / this.byteRate) * 1000;
        return silenceMs >= this.silenceBoundaryMs;
    }
}
exports.AudioStreamBuffer = AudioStreamBuffer;
let openaiClient = null;
function getOpenAI() {
    if (!config_1.config.openai.apiKey)
        return null;
    if (!openaiClient) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { OpenAI } = require('openai');
        openaiClient = new OpenAI({ apiKey: config_1.config.openai.apiKey });
    }
    return openaiClient;
}
/**
 * PCM 버퍼를 텍스트로 변환.
 * - 실서비스: OpenAI Whisper API 호출
 * - DEV_MODE: mock 응답 (음성 신호 존재 여부 기준)
 */
async function transcribeAudio(data) {
    const durationMs = (data.length / (config_1.config.openai.stt.sampleRate * 2)) * 1000;
    const client = getOpenAI();
    if (!client) {
        const signal = hasVoiceActivity(data);
        return {
            text: signal ? '안녕하세요, 오늘 할 일을 정리해 주세요.' : '',
            confidence: signal ? 0.92 : 0,
            language: 'ko',
            durationMs,
            service: 'mock',
        };
    }
    try {
        const response = await client.audio.transcriptions.create({
            model: config_1.config.openai.whisperModel,
            file: { name: 'audio.pcm', data, type: 'audio/pcm' },
            response_format: 'json',
        });
        return {
            text: String(response.text || '').trim(),
            confidence: 0.95,
            language: 'ko',
            durationMs,
            service: 'openai',
        };
    }
    catch (err) {
        // STT 장애 시 빈 결과 + 명시적 예외 코드는 호출부에서 처리
        throw Object.assign(new Error(`Whisper transcription failed: ${err?.message || err}`), {
            code: 'STT_SERVICE_UNAVAILABLE',
        });
    }
}
/** 문장 경계 분리 — partial/final 트랜스크립트 분할용 */
function splitSentences(text) {
    return text
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
}
//# sourceMappingURL=stt.js.map