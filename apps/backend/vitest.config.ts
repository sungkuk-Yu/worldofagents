import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      DEV_MODE: 'true',
      NEURON_ENGINE: 'simple',
      LOG_LEVEL: 'silent',
      // 단위 테스트는 외부 API(OpenAI STT / DashScope LLM / Perplexity 검색)를 절대 호출하지 않는다.
      // .env에 실 키가 있어도 dotenv는 기존 env를 덮어쓰지 않으므로 여기서 강제 차단.
      OPENAI_API_KEY: '',
      CHAT_LLM_DISABLED: 'true',
      CHAT_LLM_API_KEY: '',
      DASHSCOPE_API_KEY: '',
      PERPLEXITY_API_KEY: '',
    },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
