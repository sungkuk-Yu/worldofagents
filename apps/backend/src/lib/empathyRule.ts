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

/** pool 인덱스 = 회전 순서. template_id는 프론트 버튼 문구 결정 키로도 쓰인다. */
export const EMPATHY_REQUESTION_TEMPLATES: EmpathyTemplate[] = [
  { id: 'eq_confirm', ko: '이거 맞죠? {요약}', en: 'Quick check — "{요약}", right?' },
  { id: 'eq_proceed', ko: '{요약} — 맞으면 계속 진행할게요', en: '"{요약}" — if that\'s right, I\'ll keep going' },
  { id: 'eq_understand', ko: '제 이해가 맞다면 {요약}', en: 'If I read you right, it\'s about "{요약}"' },
  { id: 'eq_align', ko: '맞나요? {요약} 쪽으로 받아들이면 돼요', en: 'Sound good? I\'ll take it as "{요약}"' },
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
