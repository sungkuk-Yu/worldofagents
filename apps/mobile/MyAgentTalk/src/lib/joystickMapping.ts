// 조이스틱 자유매핑 — 순수 로직 (테스트 가능, 화면/저장과 독립)
// 카드 t_ced38e19 요구: 8방향 × 동작 할당 / 프리셋(기본·한손) / 직렬화·역직렬화 / 좌우반전.
// 탭/롱프레스는 근본 입력이라 녹음 고정(요구 5) — 맵 대상은 8방향만.
// 엔진(JoystickMic)은 기호 코드(DIR_LEFT 등)만 emit하고 의미는 여기서 결정 — 분리 계약 유지.
import { JoystickGesture } from '../types';

// 매핑 가능한 8방향 (TAP/LONG 제외)
export const DIRECTION_KEYS = [
  'DIR_UP', 'DIR_UPRIGHT', 'DIR_RIGHT', 'DIR_DOWNRIGHT',
  'DIR_DOWN', 'DIR_DOWNLEFT', 'DIR_LEFT', 'DIR_UPLEFT',
] as const;
export type JoystickDirectionKey = (typeof DIRECTION_KEYS)[number];

// 동작 풀 — 라벨은 i18n joystick.actions.<id>, 아이콘은 표시용 메타
export const ACTION_IDS = [
  'none', 'yes', 'no', 'cancel', 'keyboard',
  'record_stop', 'continuous_record', 'open_thread', 'favorites', 'send',
  'prev_segment', 'next_segment',
] as const;
export type JoystickActionId = (typeof ACTION_IDS)[number];

export interface ActionMeta {
  icon: string;
  /** 화면 컨텍스트(VoiceHome)에서 동작 가능 여부 — 미지원 화면이면_assignment 시 none으로 폴백 */
  available: boolean;
}

export const ACTION_META: Record<JoystickActionId, ActionMeta> = {
  none: { icon: '—', available: true },
  yes: { icon: '✓', available: true },
  no: { icon: '✗', available: true },
  cancel: { icon: '✕', available: true },
  keyboard: { icon: '⌨', available: true },
  record_stop: { icon: '⏹', available: true },
  continuous_record: { icon: '🔁', available: true },
  open_thread: { icon: '💬', available: true },
  favorites: { icon: '⭐', available: true },
  send: { icon: '➤', available: true },
  prev_segment: { icon: '‹', available: true },
  next_segment: { icon: '›', available: true },
};

export type JoystickMap = Record<JoystickDirectionKey, JoystickActionId>;
export type JoystickPresetId = 'default' | 'onehand' | 'custom';

// 기본 프리셋 — 기존 예/아니오/취소 + 대표님 지시(↑=키보드 열기)
export const DEFAULT_MAP: JoystickMap = {
  DIR_UP: 'keyboard',
  DIR_UPRIGHT: 'none',
  DIR_RIGHT: 'no',
  DIR_DOWNRIGHT: 'none',
  DIR_DOWN: 'cancel',
  DIR_DOWNLEFT: 'none',
  DIR_LEFT: 'yes',
  DIR_UPLEFT: 'none',
};

// 좌우 반전(한손 preset = 기본의 미러). 축/대각 모두 x 성분 반전.
const H_FLIP: Record<JoystickDirectionKey, JoystickDirectionKey> = {
  DIR_UP: 'DIR_UP',
  DIR_UPRIGHT: 'DIR_UPLEFT',
  DIR_RIGHT: 'DIR_LEFT',
  DIR_DOWNRIGHT: 'DIR_DOWNLEFT',
  DIR_DOWN: 'DIR_DOWN',
  DIR_DOWNLEFT: 'DIR_DOWNRIGHT',
  DIR_LEFT: 'DIR_RIGHT',
  DIR_UPLEFT: 'DIR_UPRIGHT',
};

export function flipHorizontal(map: JoystickMap): JoystickMap {
  const next = {} as JoystickMap;
  for (const key of DIRECTION_KEYS) next[H_FLIP[key]] = map[key];
  return next;
}

// 한손 = 기본 미러(예=→, 아니오=←)
export const ONE_HAND_MAP: JoystickMap = flipHorizontal(DEFAULT_MAP);

export const PRESETS: { id: JoystickPresetId; labelKey: string; resolve: () => JoystickMap }[] = [
  { id: 'default', labelKey: 'joystick.presetDefault', resolve: () => ({ ...DEFAULT_MAP }) },
  { id: 'onehand', labelKey: 'joystick.presetOneHand', resolve: () => ({ ...ONE_HAND_MAP }) },
];

/**역직렬화 — 서버 preferences.joystickMap / 로컬 JSON 어떤 형태든 방어적으로 JoystickMap으로.
 * - 알 수 없는 방향/동작 키는 그 칸만 기본값으로 폴백
 * - 객체가 아니거나 전부 손상되면 null (호출자가 preset 폴백 결정) */
export function normalizeJoystickMap(raw: unknown): JoystickMap | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  let touched = false;
  const out = {} as JoystickMap;
  for (const key of DIRECTION_KEYS) {
    const value = src[key];
    if (typeof value === 'string' && (ACTION_IDS as readonly string[]).includes(value)) {
      out[key] = value as JoystickActionId;
      touched = true;
    } else {
      out[key] = DEFAULT_MAP[key];
    }
  }
  return touched ? out : null;
}

/** 직렬화 — preferences.joystick.map 에 얹을 평판 JSON (순환/여분 키 없음) */
export function encodeJoystickMap(map: JoystickMap): Record<JoystickDirectionKey, JoystickActionId> {
  const out = {} as JoystickMap;
  for (const key of DIRECTION_KEYS) out[key] = map[key];
  return out;
}

/** 방향 → 매핑된 동작 (매핑에 없는 코드/none → null = 화면 기본 동작 없음) */
export function actionForGesture(map: JoystickMap, gesture: JoystickGesture): JoystickActionId | null {
  if (gesture === 'TAP_CENTER' || gesture === 'LONG_CENTER') return null; // 녹음 고정
  const action = map[gesture as JoystickDirectionKey] ?? 'none';
  return action === 'none' ? null : action;
}

/** 커스텀 판별 — 기본/한손과 다른 키가 하나라도 있으면 custom */
export function presetOf(map: JoystickMap): JoystickPresetId {
  const base = PRESETS.find((p) => p.id !== 'custom' && DIRECTION_KEYS.every((k) => p.resolve()[k] === map[k]));
  return base?.id ?? 'custom';
}
