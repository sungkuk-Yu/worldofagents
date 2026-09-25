# 프론트개발/백개발 에이전트 설정 가이드

## 1. SSH 키 설정

### 키 생성
```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
# Enter 키로 기본 경로 사용 (~/.ssh/id_ed25519)
```

### GitHub에 등록
1. 공개키 복사:
```bash
cat ~/.ssh/id_ed25519.pub
```

2. GitHub SSH 키 등록 페이지 접속:
   👉 **https://github.com/settings/ssh/new**

3. 붙여넣기:
   - Title: "Frontend Agent" 또는 "Backend Agent"
   - Key type: Authentication Key
   - Key: 복사한 공개키 붙여넣기
   - "Add SSH key" 클릭

4. 연결 테스트:
```bash
ssh -T git@github.com
# "Hi sungkuk-Yu! You've successfully authenticated" 나오면 성공
```

## 2. 레포 클론

```bash
git clone git@github.com:sungkuk-Yu/worldofagents.git
cd worldofagents
```

## 3. 작업 환경

### 프론트개발
- 위치: `/apps/mobile/` (React Native Expo)
- 관련 문서: `/docs/design/ui-interaction-spec.md`
- 주요 컴포넌트:
  - `src/components/JoystickMic.tsx`
  - `src/components/dialogs/*`
  - `src/screens/*`

### 백개발
- 위치: `/apps/backend/`
- 관련 문서: `/docs/design/neuron-architecture-spec.md`
- 주요 작업:
  - `supabase/migrations/`
  - API 엔드포인트
  - WebSocket 프로토콜

## 4. 칸반 카드 확인

작업 배정은 칸반 보드를 통해 이루어집니다. 본인의 assignee로 배정된 카드를 확인하고 진행하세요.

## 5. 커밋 규칙

- 작업 완료 후 즉시 커밋
- 의미 있는 커밋 메시지 작성
- push 전에 반드시 로컬에서 테스트

## 6. 질문/이슈

김비서(🗂️)에게 A2A로 문의하세요.
