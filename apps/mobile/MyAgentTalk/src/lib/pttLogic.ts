// PTT(누르기-말하기) 입력 규칙 — 순수 로직 (카드 t_eded715c; 단위테스트 대상)
// 키보드 캡처 화이트리스트/표시 라벨/포커스 예외 판정. 실제 addEventListener는 훅에서.
export type PttMode = 'hold' | 'toggle';

/** 기본 키: V (Discord/게임 PTT 관습 — 좌손 홈링 근처, 타이핑과 충돌 적음) */
export const PTT_DEFAULT_KEY = 'KeyV';

/** 단독 PTT 키로 금지되는 물리 키 — 브라우저/OS 필수 단축키·탐색·변경 불가 안전키 */
const FORBIDDEN_KEYS = new Set([
  'Escape', 'Tab', 'Enter', 'Space',
  'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight',
  'CapsLock', 'ContextMenu',
  // Cmd/Ctrl+W Q 등 문자와 조합되는 것 키 자체는 허용(수정자 무시하므로)하되 기능키 대거 금지
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'PrintScreen', 'ScrollLock', 'Pause', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
]);

/** 저장된 값 정규화 — 금지/유령 키는 기본값으로 폴백. 문자열/code면 코드 그대로 신뢰(물리 키). */
export function normalizePttKey(raw: unknown): string {
  if (typeof raw !== 'string') return PTT_DEFAULT_KEY;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 24 || FORBIDDEN_KEYS.has(trimmed)) return PTT_DEFAULT_KEY;
  return trimmed;
}

export function normalizePttMode(raw: unknown): PttMode {
  return raw === 'toggle' ? 'toggle' : 'hold';
}

/** 표시 라벨 — e.code(Korean 레이아웃과 무관한 물리 키) → 사람이 읽는 라벨 */
const LABEL_FIX: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
  Quote: "'", Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};
export function pttKeyLabel(code: string): string {
  if (LABEL_FIX[code]) return LABEL_FIX[code];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return numpad[1];
  return code;
}

/** 캡처 후보 키 이벤트 → 저장 가능한 code or null (수정자 단독/금지는 반려) */
export function capturePttKey(e: { code?: string; key?: string; ctrlKey: boolean; metaKey: boolean }): string | null {
  if (!e.code) return null;
  if (e.ctrlKey || e.metaKey) return null; // 브라우저 단축키 예약 영역 침범 금지
  if (FORBIDDEN_KEYS.has(e.code)) return null;
  if (e.code.startsWith('Shift') || e.code === 'CapsLock') return null;
  return e.code;
}

/**
 * 입력 포커스 예외 (확정 ③): 텍스트 입력 중에는 PTT 키가 타이핑이어야 한다.
 * activeElement 정보(태그/롤/편집가능)만 순수하게 판정 — DOM 접근은 훅에서.
 */
export function isEditableFocus(el: {
  tagName?: string | null; isContentEditable?: boolean | null; role?: string | null; type?: string | null;
} | null): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  const role = (el.role || '').toLowerCase();
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}
