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
// 카드 t_43297d90 요구 1 — 복명복창(답변 전 되물음) 선호. 계약: preferences.echoMode: 'on'|'off', 기본 'on'.
// 백엔드 게이트(t_d1dcd850)와 무관하게 프론트는 키 저장/복원만 함 — scalar 키라 딥머지(t_d75ca81c)로 다른 선호와 공존.
export type EchoMode = 'on' | 'off';
export const ECHO_MODE_DEFAULT: EchoMode = 'on';
function normalizeEchoMode(v: unknown): EchoMode | null {
  return v === 'on' || v === 'off' ? v : null;
}

// 카드 t_64914144 요구 2 — 고유명사 보호 사전(백 d2ecf480 계약: users.preferences.protectedTerms =
// 문자열 배열, max 50·최소 2자). 백엔드가 매 턴 읽어 어문 게이트 과교정 차단 + [ORTHOS] 프롬프트 주입.
// 프론트는 저장/복원만 한다 — 교정 판단은 서버 단일 진실(에코 게이트와 동일 원칙). 기본 [] = 저장된 사전 없음.
export const PROTECTED_TERMS_MAX = 50; // 백엔드 normalizeProtectedTerms slice(0,50)과 동일 상한
export const PROTECTED_TERMS_LEN = 50; // 항목당 최대 길이(백엔드 상한 미명시 — 폭주/스토크 방지 자한 상한)

// 카드 t_08d671a8 요구 1 — 그립 손(마이크 패드 좌우 위치). 웹에서 자동감지 불가 → 사용자 선언식.
// 'left': 패드 좌측 25%, 'center': 중앙 50%(기본), 'right': 우측 75%.
export type GripHand = 'left' | 'center' | 'right';
export const GRIP_HAND_DEFAULT: GripHand = 'center';
function normalizeGripHand(v: unknown): GripHand | null {
  return v === 'left' || v === 'center' || v === 'right' ? v : null;
}
/** 정규화: 문자열만, trim, 2~50자(백엔드 1자 마비 방지 규칙 준수), 중복 제거, 50 상한. */
export function normalizeProtectedTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const term = typeof item === 'string' ? item.trim() : '';
    if (term.length < 2 || term.length > PROTECTED_TERMS_LEN) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= PROTECTED_TERMS_MAX) break;
  }
  return out;
}
let echoModeCache: EchoMode | null = null;
let protectedTermsCache: string[] | null = null; // t_64914144 — null(미저장) vs [] 구분 보존 (딥머지 유실 방지)
let gripHandCache: GripHand | null = null; // t_08d671a8 — 그립 손 위치
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
  if (echoModeCache !== null) payload.echoMode = echoModeCache;
  if (protectedTermsCache !== null) payload.protectedTerms = protectedTermsCache; // []도 정당한 값(전체 삭제) — null(미저장)만 키 생략
  if (gripHandCache !== null) payload.gripHand = gripHandCache; // t_08d671a8
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
  let localEchoMode: EchoMode | null = null;
  let localProtected: string[] | null = null; // t_64914144 — 배열이었을 때만 정규화 결과(미저장 null 구분)
  let localGripHand: GripHand | null = null; // t_08d671a8
  try {
    const raw = await secureStorage.get(PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      local = mapFromPreferences(parsed);
      localMode = normalizeJoystickMode(parsed?.joystickMode);
      localPttKey = typeof parsed?.pttKey === 'string' ? normalizePttKey(parsed.pttKey) : null;
      localPttMode = parsed?.pttMode === 'hold' || parsed?.pttMode === 'toggle' ? normalizePttMode(parsed.pttMode) : null;
      localEchoMode = normalizeEchoMode(parsed?.echoMode);
      if (Array.isArray(parsed?.protectedTerms)) localProtected = normalizeProtectedTerms(parsed.protectedTerms);
      localGripHand = normalizeGripHand(parsed?.gripHand); // t_08d671a8
    }
  } catch { local = null; localMode = null; localPttKey = null; localPttMode = null; localEchoMode = null; localProtected = null; localGripHand = null; }
  if (local) cache = local;
  if (localMode) modeCache = localMode;
  if (localPttKey) pttKeyCache = localPttKey;
  if (localPttMode) pttModeCache = localPttMode;
  if (localEchoMode !== null) echoModeCache = localEchoMode;
  if (localProtected !== null) protectedTermsCache = localProtected;
  if (localGripHand !== null) gripHandCache = localGripHand; // t_08d671a8
  try {
    const env = await api.getMe();
    const remote = mapFromPreferences(env.data?.preferences);
    if (remote) cache = remote; // 계정 값이 우선 (동기화)
    const remoteMode = normalizeJoystickMode(
      typeof env.data?.preferences === 'object' && env.data?.preferences !== null
        ? (env.data.preferences as { joystickMode?: unknown }).joystickMode : undefined);
    if (remoteMode) modeCache = remoteMode;
    const prefsObj = (typeof env.data?.preferences === 'object' && env.data?.preferences !== null)
      ? env.data.preferences as { pttKey?: unknown; pttMode?: unknown; echoMode?: unknown; protectedTerms?: unknown; gripHand?: unknown } : null;
    if (typeof prefsObj?.pttKey === 'string' && prefsObj.pttKey) pttKeyCache = normalizePttKey(prefsObj.pttKey);
    if (prefsObj?.pttMode === 'hold' || prefsObj?.pttMode === 'toggle') pttModeCache = normalizePttMode(prefsObj.pttMode);
    if (normalizeEchoMode(prefsObj?.echoMode)) echoModeCache = normalizeEchoMode(prefsObj?.echoMode);
    // t_64914144: 서버 배열 우선(계정 동기화). 빈 배열도 정당한 저장(전체 삭제) — null과 구분 위해 Array.isArray 게이트.
    if (Array.isArray(prefsObj?.protectedTerms)) protectedTermsCache = normalizeProtectedTerms(prefsObj.protectedTerms);
    // t_08d671a8: gripHand 서버→로컬 동기화
    const remoteGrip = normalizeGripHand(prefsObj?.gripHand);
    if (remoteGrip) gripHandCache = remoteGrip;
  } catch { /* 미로그인/오프라인 — 로컬 폴백 유지 (요구 2) */ }
  if (cache || modeCache || pttKeyCache || pttModeCache || echoModeCache !== null || protectedTermsCache !== null || gripHandCache !== null) await writeLocalState();
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

// ── 에코 모드 (t_43297d90 요구 1) — 읽기/쓰기. 백엔드 에코 게이트(t_d1dcd850)와 무관한 순수 선호 저장.
//    미저장 시 null → 호출자는 ECHO_MODE_DEFAULT('on'=답변 전 되물음) 폴백.

/** 에코 모드 동기 읽기 — 미저장 시 null(호출자는 ECHO_MODE_DEFAULT 폴백) */
export function getEchoMode(): EchoMode | null {
  return echoModeCache;
}

/** 에코 모드 갱신 ('on'|'off') — 낙관적 로컬 → 서버 preferences.echoMode (scalar 키, 딥머지 공존) */
export async function setEchoMode(mode: EchoMode): Promise<void> {
  echoModeCache = normalizeEchoMode(mode) ?? ECHO_MODE_DEFAULT;
  hydrated = true;
  await writeLocalState();
  emit();
  await patchPreferences({ echoMode: echoModeCache });
}

// ── 고유명사 보호 사전 (t_64914144 요구 2) — preferences.protectedTerms: string[] (백 d2ecf480 규격).
//    프론트는 저장/복원만 — 실제 과교정 차단·[ORTHOS] 주입은 서버가 매 턴 이 키를 읽어 결정한다.

/** 보호 사전 동기 읽기 — 미저장 시 [](UI는 빈 목록 렌더, 서버는 백 기본 사전만 사용) */
export function getProtectedTerms(): string[] {
  return protectedTermsCache ?? [];
}

/** 보호 사전 갱신 — 정규화 후 낙관적 로컬 반영 → 서버 preferences.protectedTerms.
 *  빈 배열도 정당한 저장(전체 삭제) — 미저장(null)과 달리 키가 실제로 나가야 백 기본 외 잔여 사전이 지워진다. */
export async function setProtectedTerms(terms: string[]): Promise<void> {
  protectedTermsCache = normalizeProtectedTerms(terms);
  hydrated = true;
  await writeLocalState();
  emit();
  await patchPreferences({ protectedTerms: protectedTermsCache });
}

// 테스트/로그아웃 대응용 리셋 훅
export function __resetPrefsForTests(): void {
  cache = null;
  modeCache = null;
  pttKeyCache = null;
  pttModeCache = null;
  echoModeCache = null;
  protectedTermsCache = null;
  gripHandCache = null; // t_08d671a8
  hydrated = false;
  writeQueue = Promise.resolve();
}

// ── 그립 손 위치 (t_08d671a8) — 패드 좌우 배치. 'left'|'center'|'right'.

/** 그립 손 동기 읽기 — 미저장 시 GRIP_HAND_DEFAULT ('center') */
export function getGripHand(): GripHand {
  return gripHandCache ?? GRIP_HAND_DEFAULT;
}

/** 그립 손 갱신 — 낙관적 로컬 반영 → 서버 preferences.gripHand. */
export async function setGripHand(hand: GripHand): Promise<void> {
  gripHandCache = hand;
  hydrated = true;
  await writeLocalState();
  emit();
  await patchPreferences({ gripHand: hand });
}
