/**
 * 공감 재질문 규칙 폴백 (t_44f8896c 원본, t_a654c9ac 분리)
 *
 * "단순 복창이 아니고, 좀 다채롭게 이거 맞냐는 식으로 재 질문" — LLM 재해석
 * (lib/empathyRequest.ts)이 실패/타임아웃할 때만 이 규칙이 최후 폴백으로 발동한다.
 * 회전·연속금지 시드 규칙의 단일 소스이며, 결정적(순수 함수)이라 어떤 실행 경로에서도
 * '항상 재질문이 존재' 계약을 보장한다. graph.ts가 테스트 하위호환을 위해 재수출한다.
 */
import type { Locale } from './locale';

type EmpathyTemplate = { id: string; ko: string; en: string };

/** pool 인덱스 = 회전 순서. template_id는 프론트 버튼 문구 결정 키로도 쓰인다.
 *  ⚠ 대표님 10/10 판정 (t_51f9fd01): eq_confirm 원문 '"이거 맞죠? {요약}"'는 폐기 지시 —
 *  "대답이 뭐 이거 맞죠야. 니가 분석해서 ~하는 거죠? 이렇게 보내". 전 템플릿은 분석형
 *  재해석 의문문이어야 하고, 어떤 ko/en 문구도 '이거 맞' 복창 접두로 시작하지 않는다.
 *  (id·pool 순서·회전 계약은 프론트 바인딩 불변 — 문자열만 교체.)
 *  ⚠ 대표님 10/19 판정 (t_500b674d): 복명복창 1차 가공 전환 — "이렇게 이해했습니다: …"
 *  형태로 뉘앙스·의도 해석이 드러난 재진술 + 예/아니오만 판단받는 구조. */
export const EMPATHY_REQUESTION_TEMPLATES: EmpathyTemplate[] = [
  { id: 'eq_confirm', ko: '이렇게 이해했어요: {요약}. 맞으시면 바로 진행할게요.', en: 'Here\'s my understanding: {요약}. Let me know if I got it right.' },
  { id: 'eq_proceed', ko: '{요약}(으)로 이해하고 진행해볼까요? 아니면 다시 말씀해주세요.', en: 'I read this as {요약}. Shall I proceed, or would you like to clarify?' },
  { id: 'eq_understand', ko: '제가 파악한 건 {요약}인데요 — 맞게 잡았을까요?', en: 'I\'m reading this as {요약} — did I get it?' },
  { id: 'eq_align', ko: '{요약} 방향으로 이해했어요. 맞나요?', en: 'I understand this as {요약}. Is that right?' },
];

/** 발화 → {요약} 키워드 압축 (규칙 기반): 문두 불요 소거 + 구두점 제거 + 24자 절단.
 *  ⚠ LLM 경로(t_a654c9ac)가 기본이고 이건 폴백 전용 — 대표님 10/4 판정: 기계 절단 문장이
 *  번역투·반말 섞임의 실원인이었다. 폴백 외 경로(EMPATHY_REQUEST_LLM=false 롤백)만 탄다. */
export function empathyKeywordSummary(message: string): string {
  const cleaned = message
    .replace(/^(안녕하세요|반갑습니다|그럼|그래서|근데|그런데|있잖아|있죠|저희|우리)\s*[,!?]?\s*/i, '')
    .replace(/[。．.，,、!！?？~〜'"\\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const head = cleaned || message.trim();
  return head.length > 24 ? head.slice(0, 24).trimEnd() + '…' : head;
}

/**
 * 규칙 재질문 — 시드(lastTemplateId)로 회전: 같은 세션에서 직전 template_id 연속 재사용 금지.
 * 시드 미지원(pool 밖 id/동일 id)은 pool 인덱스 해시로 폴백(결정적, 세션 일관).
 */
export function buildEmpathyRequestion(
  message: string,
  lastTemplateId: string | null | undefined,
  locale: Locale,
): { text: string; templateId: string } {
  const pool = EMPATHY_REQUESTION_TEMPLATES;
  const summary = empathyKeywordSummary(message);
  const prev = lastTemplateId ? pool.findIndex(t => t.id === lastTemplateId) : -1;
  let idx: number;
  if (prev >= 0) {
    idx = (prev + 1) % pool.length; // 연속 재사용 금지 확정 회전
  } else {
    // 시드 없음: 발화 해시로 골랐더라도 prev와 겹치면 다음으로 민다.
    let h = 0;
    for (const ch of message) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
    idx = h % pool.length;
    if (idx === prev) idx = (idx + 1) % pool.length;
  }
  const t = pool[idx];
  const raw = locale === 'en' ? t.en : t.ko;
  return { text: raw.split('{요약}').join(summary), templateId: t.id };
}
