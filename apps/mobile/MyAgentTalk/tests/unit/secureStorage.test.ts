import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';

function setup(t: TestContext, platform: string, available: boolean) {
  const nativeValues = new Map<string, string>();
  const webValues = new Map<string, string>();
  const native = {
    isAvailableAsync: async () => available,
    getItemAsync: async (key: string) => nativeValues.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { nativeValues.set(key, value); },
    deleteItemAsync: async (key: string) => { nativeValues.delete(key); },
  };
  const modulePath = require.resolve('../../src/lib/secureStorage');
  const originals = new Map<string, NodeModule | undefined>();
  for (const [name, exports] of [['react-native', { Platform: { OS: platform } }], ['expo-secure-store', native]] as const) {
    const path = require.resolve(name); originals.set(path, require.cache[path]);
    require.cache[path] = { exports } as NodeModule;
  }
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => webValues.get(key) ?? null,
    setItem: (key: string, value: string) => webValues.set(key, value),
    removeItem: (key: string) => webValues.delete(key),
  } });
  delete require.cache[modulePath];
  const { secureStorage } = require('../../src/lib/secureStorage') as typeof import('../../src/lib/secureStorage');
  t.after(() => {
    delete require.cache[modulePath];
    for (const [path, previous] of originals) { if (previous) require.cache[path] = previous; else delete require.cache[path]; }
    if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  return { secureStorage, nativeValues, webValues, native };
}

test('네이티브 토큰은 SecureStore로만 읽고 쓰고 삭제한다', async (t) => {
  const { secureStorage, nativeValues, webValues } = setup(t, 'ios', true);
  await secureStorage.set('token', '비밀');
  assert.equal(await secureStorage.get('token'), '비밀');
  assert.equal(nativeValues.size, 1); assert.equal(webValues.size, 0);
  await secureStorage.delete('token');
  assert.equal(await secureStorage.get('token'), null);
});

test('웹은 SecureStore 가용 여부와 무관하게 localStorage 사용', async (t) => {
  const { secureStorage, nativeValues, webValues, native } = setup(t, 'web', true);
  t.mock.method(native, 'isAvailableAsync', async () => { throw new Error('웹에서 호출 금지'); });
  await secureStorage.set('token', '웹 토큰');
  assert.equal(await secureStorage.get('token'), '웹 토큰');
  assert.equal(webValues.size, 1); assert.equal(nativeValues.size, 0);
  await secureStorage.delete('token'); assert.equal(webValues.size, 0);
});

test('SecureStore 미지원 폴백과 저장소 오류 전달', async (t) => {
  const { secureStorage, webValues } = setup(t, 'android', false);
  await secureStorage.set('token', '폴백'); assert.equal(webValues.size, 1);
  t.mock.method(globalThis.localStorage, 'setItem', () => { throw new Error('저장 실패'); });
  await assert.rejects(secureStorage.set('token', '오류'), /저장 실패/);
});

test('네이티브 암호화 저장 실패는 평문 저장으로 바꾸지 않는다', async (t) => {
  const { secureStorage, webValues, native } = setup(t, 'ios', true);
  t.mock.method(native, 'setItemAsync', async () => { throw new Error('암호화 저장 실패'); });
  await assert.rejects(secureStorage.set('token', '비밀'), /암호화 저장 실패/);
  assert.equal(webValues.size, 0);
});
