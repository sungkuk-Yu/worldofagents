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

/**
 * Int16Array 정렬 가드 (t_3a91fc08 크래시 수정).
 * WS 수신 Buffer는 공유 ArrayBuffer의 홀수 byteOffset을 가질 수 있고(서버는
 * `Buffer.from(raw as ArrayBuffer)`로 슬라이스 뷰를 얻는다 — @fastify/websocket
 * 스택이 2정렬 버퍼를 재활용하면 홀수 오프셋 발생), 청크 길이가 홀수 byte일 수도
 * 있다. 둘 다 `new Int16Array(buffer, offset, n)`에서 RangeError를 던진다.
 * 홀수 오프셋 → 홀수 길이까지 겹치면 바이트 1개를 잃으므로 **slice 복사본**을
 * 쓴다(버퍼 뷰는 shared ArrayBuffer이므로 mutation 없이 복사 안전, 청크 ≤64KB).
 */
function alignedInt16(data: Buffer): Int16Array {
  let view = data;
  if (view.byteOffset % 2 !== 0 || view.byteLength % 2 !== 0) {
    view = Buffer.from(view); // 독립 2정렬 버퍼(사본)로 정규화
    if (view.byteLength % 2 !== 0) view = view.subarray(0, view.byteLength - 1); // 홀수 길이 절단
  }
  return new Int16Array(view.buffer, view.byteOffset, Math.floor(view.byteLength / 2));
}

/** 실제 음성(진폭) 감지 */
export function hasVoiceActivity(data: Buffer, threshold = config.openai.stt.vadThreshold): boolean {
  if (data.length < 2) return false;
  return pcm16Rms(alignedInt16(data)) >= threshold;
}

/** 무음 후 마지막 포인트 탐색 (문장 경계 후보) */
export function findLastVoiceSample(data: Buffer, threshold = config.openai.stt.vadThreshold): number {
  if (data.length < 2) return -1;
  const samples = alignedInt16(data);
  const sampleCount = samples.length;
  if (sampleCount === 0) return -1;
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
 * Whisper 유효 언어 코드 정규화 (t_827dcbcc 'is' 오전사):
 * client config.language는 'auto'·'ko-KR'류 태그·임의 문자열 가능 — BCP47 1차 서브태그를
 * 취해 ISO-like 2~3자만 통과시킨다(그 외엔 undefined=자동감지 유지, 하위호환).
 * 'auto'를 그대로 넘기면 faster-whisper가 ValueError(500)를 던진다(실측).
 * 우선순위(카드 계약#1): client 명시 힌트 > 세션/요청 locale > config.defaultLocale(기본 ko).
 */
export function normalizeSttLanguageHint(language: string | null | undefined): string | undefined {
  const v = (language || '').trim().toLowerCase().split('-')[0];
  return /^[a-z]{2,3}$/.test(v) && v !== 'auto' ? v : undefined;
}

/**
 * 로컬 faster-whisper large-v3-turbo 사이드카 전사 (t_1c7be18c).
 * raw PCM s16le 버퍼를 그대로 POST — 사이드카가 16k mono로 해석한다.
 * 비2xx/네트워크 실패는 STT_SERVICE_UNAVAILABLE로 던진다 (mock 조용 폴백 금지).
 * languageHint(t_827dcbcc): ?language= 쿼리로 Whisper에 언어 확정 — 미전달은 자동감지(구거동).
 */
async function transcribeViaSidecar(data: Buffer, languageHint?: string): Promise<TranscribeResult> {
  const url = config.sttSidecar.url; // 호출부에서 설정 확인 후 호출
  // 세션 locale/client 힌트 전파 — 미전달 시 Whisper 자동감지는 짧은 한국어 발화를
  // 아이슬란드어('is', p=0.92) 등으로 오인한다 (10/10 08:43 실측, message 435f61c3 화면 도달).
  const endpoint = languageHint ? `${url}/transcribe?language=${languageHint}` : `${url}/transcribe`;
  try {
    const res = await fetch(endpoint, {
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
 * language(t_827dcbcc): 언어 힌트(client config.language > 세션 locale). undefined/'auto'는
 * 자동감지 유지(하위호환) — 유효 코드는 사이드카 ?language=로 전달해 'is'류 오감지를 차단한다.
 */
export async function transcribeAudio(data: Buffer, language?: string): Promise<TranscribeResult> {
  const durationMs = (data.length / (config.openai.stt.sampleRate * 2)) * 1000;
  const client = getOpenAI();
  const hint = normalizeSttLanguageHint(language);

  // 1순위: 로컬 v3-turbo 사이드카. 실패는 고정 문장 mock으로 조용히 대체하지 않는다.
  if (config.sttSidecar.url) {
    try {
      return await transcribeViaSidecar(data, hint);
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
      // t_827dcbcc: 사이드카와 동일 힌트 정책 — 유효 코드일 때만 language 확정(미지정=자동감지 구거동).
      ...(hint ? { language: hint } : {}),
    });
    return {
      text: String(response.text || '').trim(),
      confidence: 0.95,
      language: hint || 'ko',
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