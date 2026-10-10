/**
 * 문자 2-gram Dice 계수 (0~1) — t_51f9fd01에서 graph.ts(t_c31e3f45 원 구현)에서 이동·공용화.
 * 사용처: ① 답변 재귀 생성 판정(graph.ts, 임계 0.8) ② 공감 재질문 복창 차단
 * (empathyRequest.ts, 동일 임계). lib→neurons 역참조 순환 회피를 위해 공용 lib에 둔다.
 * 규칙 불변: 소문자화·공백 접기 후 문자 2-gram 집합 교차 비율 (2·|A∩B| / |A|+|B|).
 */
export function textSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(norm(a));
  const gb = grams(norm(b));
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}
