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
      // t_20746efa two-speed — 실 .env의 백스테이지 고모델 승격값이 단위 테스트에 새지 않게 봉인
      // (필요 테스트가 config.chatLlm.deepModel을 getter 스파이로 켠다).
      CHAT_LLM_DEEP_MODEL: '',
      // 김비서 브리지(t_620d5549) — 실 .env에 SECRETARY_BRIDGE_ENDPOINT가 운영 반영돼 있어도
      // 단위 테스트는 OFF 상태로 돌게 봉인 (재발방지 관례: 새 외부 키=봉인 항목 동시 갱신).
      SECRETARY_BRIDGE_ENDPOINT: '',
      // 로컬 STT 사이드카(t_1c7be18c) — 단위 테스트는 로컬 9833을 절대 타지 않게 봉인.
      // 필요한 테스트가 config.sttSidecar.url을 켜고 fetch를 모킹한다.
      STT_SIDECAR_URL: '',
      // 볼트 도서관(t_d469fac3) — 실서비스 deploy.env 설정과 무관하게 단위 테스트는 404 게이트 기본.
      // 필요한 테스트가 config.vaultLibrary.url/adminToken을 스파이로 켜고 fetch를 모킹한다.
      VAULT_SIDECAR_URL: '',
      VAULT_ADMIN_TOKEN: '',
      // t_344e047a: 3초 리드 지연·후속 질문 LLM은 타이밍/호출수 민감 테스트를 깨뜨리므로 봉인.
      // 필요한 테스트가 config.answerLeadMs / config.suggestedQuestions.enabled를 켠다.
      ANSWER_LEAD_MS: '0',
      SUGGEST_QUESTIONS_DISABLED: 'true',
      // t_3486b1d7 ④: delta 배칭 지연을 단위 테스트에서 해제 — 즉시 emit 모드로 기존 계약 유지.
      DELTA_BATCH_MS: '0',
      // t_a654c9ac: 사람 타이핑 감각(리드 플로어+스트림 의류)과 공감 재질문 LLM 재해석은
      // 타이밍/호출수 민감 기존 테스트를 깨뜨리므로 봉인. 필요한 테스트가 spyOn으로 켠다.
      HUMAN_TYPING: 'false',
      EMPATHY_REQUEST_LLM: 'false',
      // t_45256c7a: 나라맞춤법(PNU) 후처리 — 단위 테스트는 실서비스 엔드를 절대 타지 않게 봉인.
      // 필요한 테스트가 config.naraSpeller.enabled/url을 스파이로 켜고 fetch를 모킹한다.
      NARA_SPELLER_ENABLED: '',
      NARA_SPELLER_H2: 'false', // fetch 모킹 실패 경로가 실네트워크 http2 폴백을 타지 않게
      // t_848d0c3b: 콜드 아카이브 잡 — 실 .env에 CONTEXT_ARCHIVE_ENABLED가 켜져 있어도
      // 단위 테스트는 절대 원본 DELETE를 타지 않게 봉인(필요 테스트가 spyOn으로 켠다).
      // 창 값도 고정 — .env 드리프트가 cutoff 결정론 테스트를 흔들지 못하게.
      CONTEXT_ARCHIVE_ENABLED: '',
      CONTEXT_PATCH_HOT_DAYS: '90',
      CONTEXT_ARCHIVE_SAFETY_LAG_HOURS: '24',
      CONTEXT_ARCHIVE_MAX_BATCHES: '50',
    },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
