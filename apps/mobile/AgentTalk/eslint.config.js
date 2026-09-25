// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // React Native PanResponder/Animated 공식 패턴은 렌더 중 ref 초기화(PanResponder.create)를 사용한다.
    // React 19의 react-hooks/refs·purity 규칙은 이를 에러로 잡아 표준 RN 코드와 충돌하므로 경고로 낮춘다.
    // (실행 문제가 아니라 정적 분석 규칙 충돌 — tsc 타입체크로 실제 오류는 별도 검증)
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);