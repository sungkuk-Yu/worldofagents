/**
 * empathyRequest 로컬 ollama + cloud 폴백 테스트 (t_82cc0d99)
 * 모킹은 vi.mock 모듈 패턴 사용 — ESM namespace spy는 인터셉트가 불안정 (10/19 실측)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/ollama', () => ({
  ollamaChat: vi.fn(),
  OllamaError: class OllamaError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('../../src/lib/llm', () => ({
  chatCompletion: vi.fn(),
  isLlmConfigured: vi.fn(),
  LlmError: class LlmError extends Error {
    code?: string;
  },
}));

import { generateEmpathyRequest, parseEmpathyRequest } from '../../src/lib/empathyRequest';
import { ollamaChat } from '../../src/lib/ollama';
import { chatCompletion, isLlmConfigured } from '../../src/lib/llm';
import { config } from '../../src/config';

const mockOllamaChat = vi.mocked(ollamaChat);
const mockChatCompletion = vi.mocked(chatCompletion);
const mockIsLlmConfigured = vi.mocked(isLlmConfigured);

const CLOUD_RESULT = {
  text: '제가 지금 누구랑 연결되어 있는지 궁금하신거죠?',
  model: 'qwen-flash',
  usage: { total_tokens: 20 },
  streamed: false,
  durationMs: 100,
  provider: 'primary',
  fallback: false,
};

describe('generateEmpathyRequest - 로컬 우선 + cloud 폴백', () => {
  const origEmpathyLlm = { ...config.empathyRequestLlm };

  beforeEach(() => {
    vi.resetAllMocks();
    config.empathyRequestLlm.enabled = true; // 상단 게이트 통과 필수
    config.empathyRequestLlm.timeoutMs = 4000;
  });

  afterEach(() => {
    config.localFrontDesk.enabled = false;
    Object.assign(config.empathyRequestLlm, origEmpathyLlm);
  });

  it('로컬 ollama 성공 시 cloud 호출 안함', async () => {
    config.localFrontDesk.enabled = true;
    mockOllamaChat.mockResolvedValue({
      text: '제가 지금 누구랑 연결되어 있는지 궁금하신거죠?',
      durationMs: 150,
    });

    const result = await generateEmpathyRequest('내가 너 지금 누구랑 연결되어 있어?', 'eq_confirm', 'ko');

    expect(mockOllamaChat).toHaveBeenCalledOnce();
    expect(mockChatCompletion).not.toHaveBeenCalled();
    expect(result).toBe('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
  });

  it('로컬 ollama 실패 시 cloud 폴백', async () => {
    config.localFrontDesk.enabled = true;
    mockIsLlmConfigured.mockReturnValue(true);
    mockOllamaChat.mockRejectedValue(Object.assign(new Error('ollama timeout'), { code: 'TIMEOUT' }));
    mockChatCompletion.mockResolvedValue(CLOUD_RESULT);

    const result = await generateEmpathyRequest('내가 너 지금 누구랑 연결되어 있어?', 'eq_confirm', 'ko');

    expect(mockOllamaChat).toHaveBeenCalledOnce();
    expect(mockChatCompletion).toHaveBeenCalledOnce();
    expect(result).toBe('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
  });

  it('로컬 ollama 형식 실패 시 cloud 폴백', async () => {
    config.localFrontDesk.enabled = true;
    mockIsLlmConfigured.mockReturnValue(true);
    mockOllamaChat.mockResolvedValue({
      text: '이거 맞죠?', // 금지된 복창형
      durationMs: 100,
    });
    mockChatCompletion.mockResolvedValue(CLOUD_RESULT);

    const result = await generateEmpathyRequest('내가 너 지금 누구랑 연결되어 있어?', 'eq_confirm', 'ko');

    expect(mockOllamaChat).toHaveBeenCalledOnce();
    expect(mockChatCompletion).toHaveBeenCalledOnce();
    expect(result).toBe('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
  });

  it('로컬 비활성화 시 cloud만 호출', async () => {
    config.localFrontDesk.enabled = false;
    mockIsLlmConfigured.mockReturnValue(true);
    mockChatCompletion.mockResolvedValue(CLOUD_RESULT);

    const result = await generateEmpathyRequest('내가 너 지금 누구랑 연결되어 있어?', 'eq_confirm', 'ko');

    expect(mockOllamaChat).not.toHaveBeenCalled();
    expect(mockChatCompletion).toHaveBeenCalledOnce();
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
