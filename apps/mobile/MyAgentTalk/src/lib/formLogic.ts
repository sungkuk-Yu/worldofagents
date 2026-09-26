// form 카드 순수 로직 — Wave 1 #1 (체크 버튼 활성화)
// payload 검증/기본값/필수 검증/제출 payload 생성. UI(FormCard)는 이 함수들만 tüket한다.
// 필드 type: checkbox | radio | select | text | textarea | toggle | multi (multi=옵션 복수 선택)
import type { StructuredPayload } from '../types';

export type FormFieldType = 'checkbox' | 'radio' | 'select' | 'text' | 'textarea' | 'toggle' | 'multi';
export const FORM_FIELD_TYPES: readonly FormFieldType[] = ['checkbox', 'radio', 'select', 'text', 'textarea', 'toggle', 'multi'];

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  options: string[];
  required: boolean;
  /** 초기값 — boolean(체크/토글) | 문자열(라디오/셀렉트/텍스트) | 문자열 배열(multi) */
  def: string | boolean | string[];
}
export interface FormSpec { title: string; fields: FormField[] }
export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** 서버 JSONB → FormSpec. 필드 1개 이상 + id 유일 + 옵션 무결. 실패 시 null → FallbackCard. */
export function parseFormSpec(payload: StructuredPayload | undefined): FormSpec | null {
  if (!payload || !Array.isArray(payload.fields)) return null;
  const fields: FormField[] = [];
  const seen = new Set<string>();
  for (const raw of payload.fields) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = str(item.id);
    const type = FORM_FIELD_TYPES.includes(item.type as FormFieldType) ? (item.type as FormFieldType) : null;
    const label = str(item.label);
    if (!id || !type || !label || seen.has(id)) continue;
    seen.add(id);
    const options = Array.isArray(item.options) ? item.options.map(str).filter(Boolean) : [];
    const required = item.required === true;
    let def: string | boolean | string[];
    if (type === 'checkbox' || type === 'toggle') def = item.default === true;
    else if (type === 'multi') def = Array.isArray(item.default) ? item.default.map(str).filter((o) => options.includes(o)) : [];
    else {
      def = str(item.default);
      if ((type === 'radio' || type === 'select') && def && !options.includes(def)) def = '';
    }
    fields.push({ id, type, label, options, required, def });
  }
  if (!fields.length) return null;
  return { title: str(payload.title), fields };
}

export function initialFormValues(spec: FormSpec): FormValues {
  const out: FormValues = {};
  for (const field of spec.fields) out[field.id] = Array.isArray(field.def) ? [...field.def] : field.def;
  return out;
}

const isEmpty = (value: FormValue | undefined): boolean =>
  value === undefined || value === '' || value === false || (Array.isArray(value) && value.length === 0);

/** required 필드 누락 id 목록 (제출 전 가드). */
export function validateFormValues(spec: FormSpec, values: FormValues): string[] {
  return spec.fields.filter((field) => field.required && isEmpty(values[field.id])).map((field) => field.id);
}

/** 제출 wire 포맷 — 카드 지시 계약: {type:'form_response', form_id, values} */
export function buildFormResponsePayload(formId: string, values: FormValues) {
  const clean: FormValues = {};
  for (const [id, value] of Object.entries(values)) if (!isEmpty(value)) clean[id] = value;
  return { type: 'form_response' as const, form_id: formId, values: clean };
}