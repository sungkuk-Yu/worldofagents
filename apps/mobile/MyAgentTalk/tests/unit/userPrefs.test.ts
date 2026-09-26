// 사용자 선호 영속화 — 서버 preferences.joystickMap + 낙관적 로컬 폴백 (카드 t_ced38e19 요구 2)
// api/secureStorage는 require.cache 목으로 교체 (api.test.ts 패턴 준용) — 네트워크/키체인 접근 없음.
import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAP, ONE_HAND_MAP } from '../../src/lib/joystickMapping';

interface MockState {
  me: { preferences?: Record<string, unknown> } | null;
  meFails: boolean;
  patchFails: boolean;
  patches: Record<string, unknown>[];
  local: Map<string, string>;
}

function setup(t: TestContext, opts: { me?: MockState['me']; meFails?: boolean; patchFails?: boolean } = {}) {
  const state: MockState = {
    me: opts.me === undefined ? { preferences: {} } : opts.me,
    meFails: opts.meFails ?? false,
    patchFails: opts.patchFails ?? false,
    patches: [],
    local: new Map(),
  };
  const storagePath = require.resolve('../../src/lib/secureStorage');
  const apiPath = require.resolve('../../src/lib/api');
  const prefsPath = require.resolve('../../src/lib/userPrefs');
  const previous = [storagePath, apiPath].map((p) => [p, require.cache[p]] as const);

  require.cache[storagePath] = { exports: { secureStorage: {
    get: async (k: string) => state.local.get(k) ?? null,
    set: async (k: string, v: string) => { state.local.set(k, v); },
    delete: async (k: string) => { state.local.delete(k); },
  } } } as NodeModule;
  require.cache[apiPath] = { exports: { api: {
    getMe: async () => {
      if (state.meFails) throw new Error('401 unauthorized');
      return { ok: true, data: state.me };
    },
    patchMe: async (body: Record<string, unknown>) => {
      if (state.patchFails) throw new Error('500');
      state.patches.push(body);
      state.me = { ...(state.me ?? {}), preferences: body.preferences as Record<string, unknown> };
      return { ok: true, data: state.me };
    },
  } } } as NodeModule;
  delete require.cache[prefsPath];
  const prefs = require('../../src/lib/userPrefs') as typeof import('../../src/lib/userPrefs');
  prefs.__resetPrefsForTests();
  t.after(() => {
    delete require.cache[prefsPath];
    for (const [path, prev] of previous) { if (prev) require.cache[path] = prev; else delete require.cache[path]; }
  });
  return { prefs, state };
}

test('하이드레이션: 서버 preferences.joystickMap 우선 복원 + 로컬 동기화', async (t) => {
  const { prefs, state } = setup(t, { me: { preferences: { theme: 'dark', joystickMap: { ...ONE_HAND_MAP } } } });
  await prefs.hydratePrefs();
  assert.deepEqual(prefs.getPrefs()?.joystickMap, ONE_HAND_MAP);
  assert.ok(state.local.get('at-prefs-v1')?.includes('joystickMap')); // 로컬 미러
});

test('하이드레이션: 서버에 맵 없으면 로컬 저장본 유지 (오프라인 편집 보존)', async (t) => {
  const { prefs, state } = setup(t, { me: { preferences: { theme: 'dark' } } });
  state.local.set('at-prefs-v1', JSON.stringify({ joystickMap: { ...ONE_HAND_MAP } }));
  await prefs.hydratePrefs();
  assert.deepEqual(prefs.getPrefs()?.joystickMap, ONE_HAND_MAP);
});

test('하이드레이션 실패(미로그인/오프라인)는 던지지 않고 로컬 폴백 (요구 2)', async (t) => {
  const { prefs, state } = setup(t, { meFails: true });
  state.local.set('at-prefs-v1', JSON.stringify({ joystickMap: { ...DEFAULT_MAP, DIR_UP: 'favorites' } }));
  await prefs.hydratePrefs(); // resolve해야 함
  assert.equal(prefs.getPrefs()?.joystickMap.DIR_UP, 'favorites');
});

test('setJoystickMap: 즉시 반영 + PATCH는 기존 preferences 키 보존(read-modify-write)', async (t) => {
  const { prefs, state } = setup(t, { me: { preferences: { theme: 'dark', nudge: 1 } } });
  await prefs.hydratePrefs();
  await prefs.setJoystickMap({ ...DEFAULT_MAP, DIR_UPRIGHT: 'send' });
  assert.equal(prefs.getPrefs()?.joystickMap.DIR_UPRIGHT, 'send');
  assert.equal(state.patches.length, 1);
  const sent = state.patches[0] as { preferences: Record<string, unknown> };
  assert.equal(sent.preferences.theme, 'dark'); // 통째 replace에서 다른 키 보존
  assert.equal(sent.preferences.nudge, 1);
  assert.deepEqual(sent.preferences.joystickMap, { ...DEFAULT_MAP, DIR_UPRIGHT: 'send' });
});

test('setJoystickMap: 서버 저장 실패해도 로컬 캐시/저장은 유지 (낙관적)', async (t) => {
  const { prefs, state } = setup(t, { patchFails: true });
  await prefs.hydratePrefs();
  await prefs.setJoystickMap({ ...ONE_HAND_MAP });
  assert.deepEqual(prefs.getPrefs()?.joystickMap, ONE_HAND_MAP);
  assert.ok(state.local.get('at-prefs-v1')?.includes('joystickMap'));
});

test('손상된 서버 맵은 무시 — 로컬도 없으면 prefs null (호출자 프리셋 폴백)', async (t) => {
  const { prefs } = setup(t, { me: { preferences: { joystickMap: { DIR_LEFT: 'hax', junk: true } } } });
  await prefs.hydratePrefs();
  assert.equal(prefs.getPrefs(), null); // normalize가 null → 캐시 미설정 → 화면은 DEFAULT_MAP 폴백
});

// ── 입력 모드 영속 (카드 t_5de18a91 요구 2) ──────
test('모드: 서버 preferences.joystickMode 우선 복원', async (t) => {
  const { prefs, state } = setup(t, { me: { preferences: { joystickMode: 'hybrid' } } });
  await prefs.hydratePrefs();
  assert.equal(prefs.getJoystickMode(), 'hybrid');
  assert.ok(state.local.get('at-prefs-v1')?.includes('"joystickMode":"hybrid"')); // 로컬 미러
});

test('모드: setJoystickMode — 낙관적 로컬 + PATCH에 맵 키 보존 (read-modify-write)', async (t) => {
  const { prefs, state } = setup(t, { me: { preferences: { theme: 'dark', joystickMap: { ...DEFAULT_MAP } } } });
  await prefs.hydratePrefs();
  await prefs.setJoystickMode('pad');
  assert.equal(prefs.getJoystickMode(), 'pad');
  const sent = state.patches[state.patches.length - 1] as { preferences: Record<string, unknown> };
  assert.equal(sent.preferences.joystickMode, 'pad');
  assert.equal(sent.preferences.theme, 'dark'); // 통째 replace에서 다른 키 보존
  assert.ok(sent.preferences.joystickMap); // 기존 맵 유지
});

test('모드: 손상된 서버 값은 무시 → 로컬/기본 폴백 (normalize null)', async (t) => {
  const { prefs } = setup(t, { me: { preferences: { joystickMode: 'TRACKPAD' } } });
  await prefs.hydratePrefs();
  assert.equal(prefs.getJoystickMode(), null); // 호출자는 DEFAULT_MODE 폴백
});
