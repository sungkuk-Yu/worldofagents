// 사용자 선호 저장 — 조이스틱 맵의 계정 영속화 (카드 t_ced38e19 요구 2)
// 저장 계약: PATCH /api/auth/me { preferences: { ...기존, joystickMap } } — 서버 users.preferences JSONB.
// 정책: 낙관적 로컬 우선(secureStorage) → 서버 병합 저장 시도 → 서버 미로거인/실패 시 로컬 폴백 유지.
//        하이드레이션은 서버 우선(계정 영속·기기 변경 유지), 서버 값 없으면 로컬 유지.
// 백엔드 PATCH /me는 preferences 컬럼을 통째로 replace하므로 반드시 기존 키(read-modify-write) 병합 후 보낸다.
import type { JoystickMap } from './joystickMapping';
import { encodeJoystickMap, normalizeJoystickMap } from './joystickMapping';
import type { JoystickMode } from './joystickMode';
import { normalizeJoystickMode } from './joystickMode';
import { normalizePttKey, normalizePttMode, PttMode } from './pttLogic';
import { api } from './api';
import { secureStorage } from './secureStorage';

const PREFS_STORAGE_KEY = ['at', 'prefs', 'v1'].join('-');

let cache: JoystickMap | null = null;
let modeCache: JoystickMode | null = null; // 카드 t_5de18a91 — 입력 모드(조이스틱/매직패드/하이브리드)
// 카드 t_eded715c — PC 웹 PTT(푸시투톡): 키 code + 홀드/토글 모드. 서버 preferences 딥머지(t_d75ca81c)로
// joystickMap과 상호 유실 없이 공존 — 패치에는 자기 키만 넣는다(read-modify-write 불요).
let pttKeyCache: string | null = null;
let pttModeCache: PttMode | null = null;
let writeQueue: Promise<void> = Promise.resolve(); // 쓰기 직렬화 — hydrate/set 교차 경쟁 방지
let hydrated = false;

// 저장 변경 통지 — 화면별 useJoystickMap 인스턴스 간 동기화 (설정에서 모드/맵 변경 → 음성 홈 즉시 반영)
const listeners = new Set<() => void>();
export function subscribePrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function emit() { listeners.forEach((fn) => { try { fn(); } catch { /* 한 구독자 오류는 다른 구독자 격리 */ } }); }

export interface UserPreferences {
  joystickMap: JoystickMap;
}

function writeLocalState(): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (cache) payload.joystickMap = encodeJoystickMap(cache);
  if (modeCache) payload.joystickMode = modeCache;
  if (pttKeyCache) payload.pttKey = pttKeyCache;
  if (pttModeCache) payload.pttMode = pttModeCache;
  const task = writeQueue.catch(() => {}).then(() =>
    secureStorage.set(PREFS_STORAGE_KEY, JSON.stringify(payload))
  ).catch(() => { /* 저장소 부재(웹 private mode 등) — 메모리 캐시로 세션은 지속 */ });
  writeQueue = task;
  return task;
}

function mapFromPreferences(preferences: unknown): JoystickMap | null {
  if (typeof preferences !== 'object' || preferences === null) return null;
  return normalizeJoystickMap((preferences as { joystickMap?: unknown }).joystickMap);
}

/** 앱 첫 사용 시 1회 — 서버(계정) → 없으면 로컬 순으로 복원. 네이티브 안전: 실패 던지지 않음. */
export async function hydratePrefs(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  await writeQueue.catch(() => {}); // 진행 중인 낙관적 쓰기 완료 대기
  let local: JoystickMap | null = null;
  let localMode: JoystickMode | null = null;
  let localPttKey: string | null = null;
  let localPttMode: PttMode | null = null;
  try {
    const raw = await secureStorage.get(PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      local = mapFromPreferences(parsed);
      localMode = normalizeJoystickMode(parsed?.joystickMode);
      localPttKey = typeof parsed?.pttKey === 'string' ? normalizePttKey(parsed.pttKey) : null;
      localPttMode = parsed?.pttMode === 'hold' || parsed?.pttMode === 'toggle' ? normalizePttMode(parsed.pttMode) : null;
    }
  } catch { local = null; localMode = null; localPttKey = null; localPttMode = null; }
  if (local) cache = local;
  if (localMode) modeCache = localMode;
  if (localPttKey) pttKeyCache = localPttKey;
  if (localPttMode) pttModeCache = localPttMode;
  try {
    const env = await api.getMe();
    const remote = mapFromPreferences(env.data?.preferences);
    if (remote) cache = remote; // 계정 값이 우선 (동기화)
    const remoteMode = normalizeJoystickMode(
      typeof env.data?.preferences === 'object' && env.data?.preferences !== null
        ? (env.data.preferences as { joystickMode?: unknown }).joystickMode : undefined);
    if (remoteMode) modeCache = remoteMode;
    const prefsObj = (typeof env.data?.preferences === 'object' && env.data?.preferences !== null)
      ? env.data.preferences as { pttKey?: unknown; pttMode?: unknown } : null;
    if (typeof prefsObj?.pttKey === 'string' && prefsObj.pttKey) pttKeyCache = normalizePttKey(prefsObj.pttKey);
    if (prefsObj?.pttMode === 'hold' || prefsObj?.pttMode === 'toggle') pttModeCache = normalizePttMode(prefsObj.pttMode);
  } catch { /* 미로그인/오프라인 — 로컬 폴백 유지 (요구 2) */ }
  if (cache || modeCache || pttKeyCache || pttModeCache) await writeLocalState();
}

/** 동기 읽기 — 하이드레이션 전이면 null (호출자는 프리셋 폴백) */
export function getPrefs(): UserPreferences | null {
  return cache ? { joystickMap: cache } : null;
}

/** 입력 모드 동기 읽기 — 미저장 시 null (호출자는 DEFAULT_MODE 폴백) */
export function getJoystickMode(): JoystickMode | null {
  return modeCache;
}

/** 조이스틱 맵 갱신 — 낙관적 로컬 반영(완료 대기는 호출자 await에 보장) 후 서버 병합 저장;
 *  서버 실패 시에도 로컬은 유지 (오프라인 편집 가능, 다음 하이드레이션까지 이 기기 전용) */
export async function setJoystickMap(map: JoystickMap): Promise<void> {
  cache = { ...map };
  hydrated = true;
  await writeLocalState();
  emit();
  await patchPreferences({ joystickMap: encodeJoystickMap(map) });
}

/** 입력 모드 갱신 (t_5de18a91 요구 2) — 맵과 동일 정책: 낙관적 로컬 → 서버 preferences.joystickMode */
export async function setJoystickMode(mode: JoystickMode): Promise<void> {
  modeCache = mode;
  hydrated = true;
  await writeLocalState();
  emit();
  await patchPreferences({ joystickMode: mode });
}

/** 서버 preferences에 키 병합 저장 (read-modify-write) — 실패 삼킴(로컬 폴백 유지) */
async function patchPreferences(patch: Record<string, unknown>): Promise<void> {
  try {
    const env = await api.getMe();
    const existing = typeof env.data?.preferences === 'object' && env.data.preferences !== null
      ? env.data.preferences as Record<string, unknown> : {};
    await api.patchMe({ preferences: { ...existing, ...patch } });
  } catch { /* 서버 미로그인/실패 — 로컬 폴백 */ }
}

// ── PTT (t_eded715c) — 읽기/쓰기. 서버는 딥머지(t_d75ca81c)라 read-modify-write 없이 키만 보낸다.
//    patchPreferences의 통째-replace 우회 병합은 하위 호환 유지용으로 그대로 둔다(합쳐도 손해 없음).

/** PTT 키(e.code) 동기 읽기 — 미저장 시 null(호출자는 PTT_DEFAULT_KEY 폴백) */
export function getPttKey(): string | null {
  return pttKeyCache;
}

/** PTT 모드 동기 읽기 — 미저장 시 null(호출자는 hold 폴백) */
export function getPttMode(): PttMode | null {
  return pttModeCache;
}

/** PTT 키 갱신 — 낙관적 로컬 → 서버 preferences.pttKey */
export async function setPttKey(code: string): Promise<void> {
  pttKeyCache = normalizePttKey(code);
  hydrated = true;
  await writeLocalState();
  emit();
  await patchPreferences({ pttKey: pttKeyCache });
}

/** PTT 모드 갱신 (hold|toggle) */
export async function setPttMode(mode: PttMode): Promise<void> {
  pttModeCache = normalizePttMode(mode);
  hydrated = true;
  await writeLocalState();
  emit();
  await patchPreferences({ pttMode: pttModeCache });
}

// 테스트/로그아웃 대응용 리셋 훅
export function __resetPrefsForTests(): void {
  cache = null;
  modeCache = null;
  pttKeyCache = null;
  pttModeCache = null;
  hydrated = false;
  writeQueue = Promise.resolve();
}
