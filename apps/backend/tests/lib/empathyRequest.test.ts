/**
 * empathyRequest 로컬 ollama + cloud 폴백 테스트 (t_82cc0d99)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateEmpathyRequest, parseEmpathyRequest } from './empathyRequest';
import * as ollama from './ollama';
import * as llm from './llm';
import { config } from '../config';

describe('empathyRequest - local ollama + cloud fallback', () => {
  const originalLocalFrontDesk = { ...config.localFrontDesk };
  const originalIsLlmConfigured = llm.isLlmConfigured;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.assign(config.localFrontDesk, originalLocalFrontDesk);
    (llm as any).isLlmConfigured = originalIsLlmConfigured;
  });

  it('로컬 ollama 성공 시 cloud 호출 안함', async () => {
    config.localFrontDesk.enabled = true;
    const ollamaChatSpy = vi.spyOn(ollama, 'ollamaChat').mockResolvedValue({
      text: '제가 지금 누구랑 연결되어 있는지 궁금하신거죠?',
      durationMs: 150,
    });
    const chatCompletionSpy = vi.spyOn(llm, 'chatCompletion');

    const result = await generateEmpathyRequest('내가 너 지금 누구랑 연결되어 있어?', 'eq_confirm', 'ko');

    expect(ollamaChatSpy).toHaveBeenCalledOnce();
    expect(chatCompletionSpy).not.toHaveBeenCalled();
    expect(result).toBe('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
  });

  it('로컬 ollama 실패 시 cloud 폴백', async () => {
    config.localFrontDesk.enabled = true;
    vi.spyOn(llm, 'isLlmConfigured').mockReturnValue(true);
    const ollamaChatSpy = vi.spyOn(ollama, 'ollamaChat').mockRejectedValue({
      code: 'TIMEOUT',
      message: 'ollama timeout',
    } as ollama.OllamaError);
    const chatCompletionSpy = vi.spyOn(llm, 'chatCompletion').mockResolvedValue({
      text: '제가 지금 누구랑 연결되어 있는지 궁금하신거죠?',
      model: 'qwen-flash',
      usage: { total_tokens: 20 },
      streamed: false,
      durationMs: 100,
      provider: 'primary',
      fallback: false,
    });

    const result = await generateEmpathyRequest('내가 너 지금 누구랑 연결되어 있어?', 'eq_confirm', 'ko');

    expect(ollamaChatSpy).toHaveBeenCalledOnce();
    expect(chatCompletionSpy).toHaveBeenCalledOnce();
    expect(result).toBe('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
  });

  it('로컬 ollama 형식 실패 시 cloud 폴백', async () => {
    config.localFrontDesk.enabled = true;
    vi.spyOn(llm, 'isLlmConfigured').mockReturnValue(true);
    const ollamaChatSpy = vi.spyOn(ollama, 'ollamaChat').mockResolvedValue({
      text: '이거 맞죠?', // 금지된 복창형
      durationMs: 100,
    });
    const chatCompletionSpy = vi.spyOn(llm, 'chatCompletion').mockResolvedValue({
      text: '제가 지금 누구랑 연결되어 있는지 궁금하신거죠?',
      model: 'qwen-flash',
      usage: { total_tokens: 20 },
      streamed: false,
      durationMs: 100,
      provider: 'primary',
      fallback: false,
    });

    const result = await generateEmpathyRequest('내가 너 지금 누구랑 연결되어 있어?', 'eq_confirm', 'ko');

    expect(ollamaChatSpy).toHaveBeenCalledOnce();
    expect(chatCompletionSpy).toHaveBeenCalledOnce();
    expect(result).toBe('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
  });

  it('로컬 비활성화 시 cloud만 호출', async () => {
    config.localFrontDesk.enabled = false;
    vi.spyOn(llm, 'isLlmConfigured').mockReturnValue(true);
    const ollamaChatSpy = vi.spyOn(ollama, 'ollamaChat');
    const chatCompletionSpy = vi.spyOn(llm, 'chatCompletion').mockResolvedValue({
      text: '제가 지금 누구랑 연결되어 있는지 궁금하신거죠?',
      model: 'qwen-flash',
      usage: { total_tokens: 20 },
      streamed: false,
      durationMs: 100,
      provider: 'primary',
      fallback: false,
    });

    const result = await generateEmpathyRequest('내가 너 지금 누구랑 연결되어 있어?', 'eq_confirm', 'ko');

    expect(ollamaChatSpy).not.toHaveBeenCalled();
    expect(chatCompletionSpy).toHaveBeenCalledOnce();
    expect(result).toBe('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
  });
});

describe('parseEmpathyRequest - 계약 검수', () => {
  it('의문문 형식 허용 (? 끝)', () => {
    expect(parseEmpathyRequest('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?')).toBe(
      '제가 지금 누구랑 연결되어 있는지 궁금하신거죠?'
    );
  });

  it('해석 진술형 허용 (. 끝)', () => {
    expect(parseEmpathyRequest('이렇게 이해했어요: 해당 작업을 진행해달라는 요청.')).toBe(
      '이렇게 이해했어요: 해당 작업을 진행해달라는 요청?'
    );
  });

  it('복창형 차단: 이거 맞 패턴', () => {
    expect(parseEmpathyRequest('이거 맞죠?')).toBeNull();
    expect(parseEmpathyRequest('그러니까 이거맞나요?')).toBeNull();
  });

  it('너무 짧은 출력 차단 (<8자 본문)', () => {
    expect(parseEmpathyRequest('맞나요?')).toBeNull();
  });

  it('너무 긴 출력 차단 (>120자)', () => {
    const long = '가'.repeat(121) + '?';
    expect(parseEmpathyRequest(long)).toBeNull();
  });

  it('원문 에코 차단: textSimilarity ≥ 0.8', () => {
    const userMsg = '내가 너 지금 누구랑 연결되어 있어?';
    const echo = '내가 너 지금 누구랑 연결되어 있어?'; // 동일
    expect(parseEmpathyRequest(echo, userMsg)).toBeNull();
  });
});
