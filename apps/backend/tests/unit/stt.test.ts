import { describe, it, expect } from 'vitest';
import {
  pcm16Rms,
  hasVoiceActivity,
  findLastVoiceSample,
  AudioStreamBuffer,
  splitSentences,
  transcribeAudio,
} from '../../src/lib/stt';

/**
 * n 초 분량의 무음 PCM 버퍼 (16kHz 16bit)
 * 주의: Buffer.from(Int16Array)는 원소를 1바이트로 줄이므로(16bit 유실),
 * 원본 ArrayBuffer 바이트를 복사해 2바이트 LE PCM을 보존해야 한다.
 */
function silenceBuffer(seconds: number): Buffer {
  const samples = new Int16Array(moments(seconds));
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

/** n 초분 샘플 수 */
function moments(seconds: number): number {
  return Math.floor(16000 * seconds);
}

/** 진폭을 지정한 PCM 버퍼 (0.0~1.0) */
function toneBuffer(seconds: number, amplitude = 0.5): Buffer {
  const samples = new Int16Array(moments(seconds));
  const value = Math.round(amplitude * 32767);
  for (let i = 0; i < samples.length; i++) samples[i] = value;
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

describe('STT 유틸', () => {
  it('pcm16Rms — 무음은 0, 신호는 임계값 이상', () => {
    expect(pcm16Rms(new Int16Array(moments(0.1)))).toBe(0);
    const rms = pcm16Rms(new Int16Array(toneBuffer(0.1, 0.5).buffer));
    expect(rms).toBeGreaterThan(0.4);
    expect(rms).toBeLessThanOrEqual(0.6);
  });

  it('hasVoiceActivity — 무음 false / 신호 true / 짧은 버퍼 false', () => {
    expect(hasVoiceActivity(Buffer.alloc(0))).toBe(false);
    expect(hasVoiceActivity(Buffer.alloc(10))).toBe(false);
    expect(hasVoiceActivity(silenceBuffer(0.5))).toBe(false);
    expect(hasVoiceActivity(toneBuffer(0.3, 0.3))).toBe(true);
    expect(hasVoiceActivity(toneBuffer(0.3, 0.001))).toBe(false);
  });

  it('findLastVoiceSample — 마지막 유효 음성 샘플 위치', () => {
    expect(findLastVoiceSample(silenceBuffer(0.1))).toBe(-1);
    const buf = toneBuffer(0.2, 0.5);
    const last = findLastVoiceSample(buf);
    expect(last).toBeGreaterThanOrEqual(buf.length / 2 - 10);
  });

  it('AudioStreamBuffer — 누적/길이/bundle/한도', () => {
    const buf = new AudioStreamBuffer();
    expect(buf.durationMs).toBe(0);
    buf.push(toneBuffer(0.5, 0.5));
    expect(buf.durationMs).toBeCloseTo(500, 0);
    expect(buf.hasSignal).toBe(true);
    expect(buf.bundle.length).toBe(16000); // 0.5s * 32000 B/s
    // maxMs(10s) 초과 시 오래된 청크 버림
    for (let i = 0; i < 25; i++) buf.push(toneBuffer(0.5, 0.5));
    expect(buf.durationMs).toBeLessThanOrEqual(10000);
    buf.clear();
    expect(buf.durationMs).toBe(0);
  });

  it('AudioStreamBuffer — 무음 청크만 쌓으면 hasSignal false', () => {
    const buf = new AudioStreamBuffer();
    buf.push(silenceBuffer(1));
    buf.push(silenceBuffer(1));
    expect(buf.hasSignal).toBe(false);
    expect(buf.bundle.length).toBe(64000);
  });

  it('splitSentences — 문장 분리', () => {
    expect(splitSentences('안녕하세요. 반갑습니다!오늘은 좋은 날이네요?')).toEqual([
      '안녕하세요.',
      '반갑습니다!오늘은 좋은 날이네요?',
    ]);
    expect(splitSentences('  한 줄  ')).toEqual(['한 줄']);
  });

  it('transcribeAudio — API 키 없음(mock): 신호 있으면 텍스트, 무음이면 빈 텍스트', async () => {
    const voiced = await transcribeAudio(toneBuffer(1, 0.5));
    expect(voiced.service).toBe('mock');
    expect(voiced.text.length).toBeGreaterThan(0);
    expect(voiced.confidence).toBeGreaterThan(0);

    const silent = await transcribeAudio(silenceBuffer(1));
    expect(silent.text).toBe('');
    expect(silent.confidence).toBe(0);
  });
});