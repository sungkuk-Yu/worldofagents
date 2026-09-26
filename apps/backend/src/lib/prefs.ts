/**
 * users.preferences 딥 머지 (t_d75ca81c).
 *
 * 배경: PATCH /me가 preferences 컬럼을 통째 replace해서, 모바일(조이스틱 맵)과
 * PC 웹(PTT 키맵)이 서로의 키를 지웠다 — 08:12 카드 t_ced38e19가 프론트에서
 * read-modify-write로 우회했지만 경쟁(Race)이 남고 구버전 클라이언트는 여전히 유실.
 * 서버에서 키 단위 병합을 보장하면 클라이언트 순서/버전과 무관하게 안전하다.
 *
 * 규칙:
 *  - 객체 vs 객체 → 키별 재귀 병합. 배열/프리미티브는 새 값으로 교체 (머지 not concat).
 *  - null 값은 "그 키 삭제" (JSON Merge Patch RFC 7386 준용).
 *  - depth 상한 8 — 순환/악의적 중첩 방지.
 */

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const PREFERENCES_MAX_DEPTH = 8;

export function deepMergePreferences(
  base: unknown,
  patch: unknown,
  depth = 0
): Plain {
  const result: Plain = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(patch)) return result;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
      continue;
    }
    if (depth < PREFERENCES_MAX_DEPTH && isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMergePreferences(result[key], value, depth + 1);
    } else if (depth < PREFERENCES_MAX_DEPTH && isPlainObject(value)) {
      result[key] = deepMergePreferences({}, value, depth + 1);
    } else {
      // depth 초과 시 중첩 객체는 통째 교체로 폴백 (무한 재귀 금지).
      result[key] = value;
    }
  }
  return result;
}
