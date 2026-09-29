/**
 * Whisper v3 Turbo STT 파이프라인 (neuron-architecture-spec §5.4)
 * - PCM 16kHz s16le 오디오 청크 버퍼링
 * - VAD(음성 활동 감지): RMS 임계값 기반
 * - 무음 경계 기반 문장 분리 → 부분(partial)/최종(final) 트랜스크립트
 * - 실 트랜스크립션: 로컬 faster-whisper v3-turbo 사이드카(1순위, t_1c7be18c) → OpenAI Whisper API(2순위)
 * - DEV_MODE: API 키·사이드카 없이 동작하는 mock (프로토콜/플로우 검증용)
 */
import { config } from '../config';

export interface STTChunk {
  text: string;
  isFinal: boolean;
  confidence: number;
  language: string;
}

/** PCM16 부분을 RMS로 변환 — 음성 활동 감지용 */
export function pcm16Rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** 실제 음성(진폭) 감지 */
export function hasVoiceActivity(data: Buffer, threshold = config.openai.stt.vadThreshold): boolean {
  if (data.length < 2) return false;
  const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));
  return pcm16Rms(samples) >= threshold;
}

/** 무음 후 마지막 포인트 탐색 (문장 경계 후보) */
export function findLastVoiceSample(data: Buffer, threshold = config.openai.stt.vadThreshold): number {
  const sampleCount = Math.floor(data.length / 2);
  if (sampleCount === 0) return -1;
  const samples = new Int16Array(data.buffer, data.byteOffset, sampleCount);
  for (let i = sampleCount - 1; i >= 0; i--) {
    if (Math.abs(samples[i] / 32768) >= threshold) return i;
  }
  return -1;
}

/**
 * 오디오 스트림 버퍼 — 청크 누적, VAD/문장 경계 판단.
 * 16kHz 16bit 모노 = 16000 samples/s = 32000 byte/s
 */
export class AudioStreamBuffer {
  private chunks: Buffer[] = [];
  private byteLength = 0;

  constructor(
    private maxMs = config.ws.maxAudioBufferMs,
    private silenceBoundaryMs = config.openai.stt.silenceBoundaryMs
  ) {}

  get byteRate(): number {
    return config.openai.stt.sampleRate * 2;
  }

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.byteLength += chunk.length;
    const maxBytes = (this.maxMs / 1000) * this.byteRate;
    while (this.byteLength > maxBytes && this.chunks.length > 1) {
      this.byteLength -= this.chunks[0].length;
      this.chunks.shift();
    }
  }

  get bundle(): Buffer {
    return Buffer.concat(this.chunks);
  }

  get durationMs(): number {
    return (this.byteLength / this.byteRate) * 1000;
  }

  get hasSignal(): boolean {
    return hasVoiceActivity(this.bundle);
  }

  clear(): void {
    this.chunks = [];
    this.byteLength = 0;
  }

  /** 무음 구간이 문장 경계 기준을 넘었는지 (후속 트랜스크립트 트리거) */
  hasSilenceBoundary(data: Buffer): boolean {
    const lastVoice = findLastVoiceSample(data);
    if (lastVoice < 0) return false;
    const bytesFromEnd = (data.length / 2 - lastVoice) * 2;
    const silenceMs = (bytesFromEnd / this.byteRate) * 1000;
    return silenceMs >= this.silenceBoundaryMs;
  }
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
export const MOCK_STT_PHRASE = '안녕하세요, 오늘 할 일을 정리해 주세요.';

/**
 * 로컬 faster-whisper large-v3-turbo 사이드카 전사 (t_1c7be18c).
 * raw PCM s16le 버퍼를 그대로 POST — 사이드카가 16k mono로 해석한다.
 * 비2xx/네트워크 실패는 STT_SERVICE_UNAVAILABLE로 던진다 (mock 조용 폴백 금지).
 */
async function transcribeViaSidecar(data: Buffer): Promise<TranscribeResult> {
  const url = config.sttSidecar.url; // 호출부에서 설정 확인 후 호출
  try {
    const res = await fetch(`${url}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      signal: AbortSignal.timeout(config.sttSidecar.timeoutMs),
    });
    if (!res.ok) {
      // 503 MODEL_NOT_LOADED 등 — 준비/가동 문제. 조용한 mock 폴백 대신 호출부로 실패를 알린다.
      throw Object.assign(new Error(`STT sidecar HTTP ${res.status}`), { code: 'STT_SERVICE_UNAVAILABLE' });
    }
    const j = (await res.json()) as { text?: string; language?: string; confidence?: number; duration_ms?: number };
    return {
      text: String(j.text || '').trim(),
      confidence: typeof j.confidence === 'number' ? j.confidence : 0.9,
      language: j.language || config.defaultLocale,
      durationMs: typeof j.duration_ms === 'number' ? j.duration_ms : (data.length / (config.openai.stt.sampleRate * 2)) * 1000,
      service: 'local',
    };
  } catch (err: any) {
    if (err?.code === 'STT_SERVICE_UNAVAILABLE') throw err;
    throw Object.assign(new Error(`STT sidecar failed: ${err?.message || err}`), { code: 'STT_SERVICE_UNAVAILABLE' });
  }
}

let openaiClient: any = null;
function getOpenAI(): any {
  if (!config.openai.apiKey) return null;
  if (!openaiClient) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

/**
 * PCM 버퍼를 텍스트로 변환.
 * - 1순위: 로컬 faster-whisper v3-turbo 사이드카 (STT_SIDECAR_URL 설정 시, t_1c7be18c)
 * - 2순위: OpenAI Whisper API (실 키 보유 시)
 * - 키 없고 사이드카도 없는 DEV/mock: 음성 신호 여부 기반 mock 응답 (플로우 검증용)
 * - 사이드카 설정 후 실패 시: mock 고정 문장으로 조용히 대체하지 않고 STT_SERVICE_UNAVAILABLE.
 */
export async function transcribeAudio(data: Buffer): Promise<TranscribeResult> {
  const durationMs = (data.length / (config.openai.stt.sampleRate * 2)) * 1000;
  const client = getOpenAI();

  // 1순위: 로컬 v3-turbo 사이드카. 실패는 고정 문장 mock으로 조용히 대체하지 않는다.
  if (config.sttSidecar.url) {
    try {
      return await transcribeViaSidecar(data);
    } catch (err: any) {
      if (!client) throw err; // 키 없으면 폴백 없음 — 명시 오류
      // 실 OpenAI 키가 있을 때만 클라우드 폴백
    }
  }

  if (!client) {
    const signal = hasVoiceActivity(data);
    return {
      text: signal ? MOCK_STT_PHRASE : '',
      confidence: signal ? 0.92 : 0,
      language: 'ko',
      durationMs,
      service: 'mock',
    };
  }

  try {
    const response = await client.audio.transcriptions.create({
      model: config.openai.whisperModel,
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
  } catch (err: any) {
    // STT 장애 시 빈 결과 + 명시적 예외 코드는 호출부에서 처리
    throw Object.assign(new Error(`Whisper transcription failed: ${err?.message || err}`), {
      code: 'STT_SERVICE_UNAVAILABLE',
    });
  }
}

/** 문장 경계 분리 — partial/final 트랜스크립트 분할용 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}