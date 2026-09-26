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
      CHAT_LLM_FB_KEY: '',   // LLM 비상전원(t_67eaf475)도 단위 테스트에서 봉인
      CLASSIFY_LLM_DISABLED: 'true',  // Stage 2 분류 LLM(t_56498848)도 봉인 — chatCompletion 모킹 테스트 간섭 방지, 필요한 테스트가 config.classification.llmEnabled를 켠다
      PERPLEXITY_API_KEY: '',
    },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
