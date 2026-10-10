// 스트리밍 렌더 hardening 기능 플래그 (t_5c559e85, 대표님 9/29 롤백 게이트)
// 각 기능은 독립 커밋 + 이 플래그로 온/오프 — 이상 시 커밋 revert 또는 env로 기능만 차단(베이스 484eec2f 재빌드 불요 경로).
// 기본값 true(적용). EXPO_PUBLIC_RENDER_FLAGS 예: "streamIdPatch=0,sendTicks=0" 로 배포 시점 개별 차단 가능.
// (EXPO_PUBLIC_* 는 빌드 시점 베이크 — 런타임 토글이 아니라 재빌드 없는 긴급 무効화 스위치.)

function parseEnvFlags(): Record<string, boolean> {
  const raw = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_RENDER_FLAGS) || '';
  const out: Record<string, boolean> = {};
  for (const pair of String(raw).split(',')) {
    const [k, v] = pair.split('=');
    if (k && v !== undefined) out[k.trim()] = v.trim() !== '0' && v.trim().toLowerCase() !== 'false';
  }
  return out;
}

const envFlags = parseEnvFlags();

export const renderFlags = {
  /** ① 스트리밍 = single card ID patch: delta를 리스트 내 같은 스트림 카드 content 갱신으로 렌더,
   *  확정 message.new에서 ID merge(Telegram updateMessageID 상당) — footer 임시 카드 이중 렌더 폐지 */
  streamIdPatch: envFlags.streamIdPatch ?? true,
  /** ② contain:layout — 스트리밍 카드 컨테이너에 재레이아웃 상위 전파 차단 (Open WebUI 픽스 1단계, 웹 전용 CSS) */
  streamContain: envFlags.streamContain ?? true,
  /** ③ rAF 배칭 flush + 첫 토큰 전 placeholder row (run.* 이벤트 수신 시 0프레이드로 자리 확보) */
  streamRafBatch: envFlags.streamRafBatch ?? true,
  /** ④ room별 미전송 입력 draft localStorage 복원 + 발송 시 원자적 clear (core.telegram.org/api/drafts) */
  inputDraftPersist: envFlags.inputDraftPersist ?? true,
  /** ⑤ 전송 ticks: 시계(pending)→체크(sent=서버 ID)→(!)+탭 재전송(failed), 조용한 삭제 금지 */
  sendTicks: envFlags.sendTicks ?? true,
  /** ⑥ (t_da4f8623 → t_4c266653 3차 개정) 사람 타이핑 리빌: 답변 스트림을 문장 경계(컷점)까지
   *  서버 스트림 속도 그대로 노출(30자/s 지터 연출 폐기·재질문 통째 즉시 표시). '입력 중…' dots는
   *  첫 문장 노출 전까지 리드. OFF 시 기존 즉시 렌더 1:1 복귀 (prefers-reduced-motion과 동일 폴백 경로) */
  typewriterReveal: envFlags.typewriterReveal ?? true,
} as const;

export type RenderFlagName = keyof typeof renderFlags;
