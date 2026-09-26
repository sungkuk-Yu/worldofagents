# MyAgentTalk (마이에이전트톡) — 내 에이전트와 대화하는 앱

> 개명 이력: 2026-09-26 대표님 확정으로 `AgentTalk(에이전트톡)` → **MyAgentTalk(마이에이전트톡)**. 구 디렉토리 `apps/mobile/AgentTalk`는 git mv로 이관되었다.

사용자가 자기 에이전트를 "내 변호사", "내 비서"처럼 소유감 있게 부르는 채팅 앱. Expo(React Native) + 웹 퍼스트(PWA) 구성이며, 백엔드는 `apps/backend`를 참조한다.

## 실행

```bash
npm install
npm run web          # 웹 개발 서버
npm run typecheck    # tsc --noEmit
npm run lint         # expo lint
npm run test         # 단위 테스트 (node --test)
```

## 브랜딩 표기 규칙

- 사용자 노출 문자열: i18n 키 `common.app` — ko `마이에이전트톡` / en `MyAgentTalk` (`src/i18n/locales/`)
- 패키지/설정 이름: `myagenttalk` (mobile), `myagenttalk-backend` (backend)
- 번들 식별자·딥링크 scheme(`com.worldofagents.agenttalk`, `agenttalk://`)과 이미 적용된 DB 마이그레이션/시드의 `author='agenttalk'` 값은 기존 배포·데이터 계약이므로 개명 대상에서 제외했다.
- `docs/design/agenttalk-figma/`·`docs/reviews/`·`public/wireframes/`의 옛 이름은 역사 기록으로 보존한다.
