import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { LocalizedError } from './errorKeys';

async function nativeAvailable() {
  return Platform.OS !== 'web' && await SecureStore.isAvailableAsync();
}
// 웹은 SecureStore를 지원하지 않으므로 브라우저 저장소를 사용한다. 접근 실패는 호출자에게 전달한다.
// 오류 문구는 errors.* 키로 전송 — UI는 LocalizedError.errorKey로 t() 해석해 표시 (raw 노출 방지)
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    return await nativeAvailable() ? SecureStore.getItemAsync(key) : globalThis.localStorage?.getItem(key) ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    if (await nativeAvailable()) await SecureStore.setItemAsync(key, value);
    else {
      if (!globalThis.localStorage) throw new LocalizedError('errors.storageSecure');
      globalThis.localStorage.setItem(key, value);
    }
  },
  async delete(key: string): Promise<void> {
    if (await nativeAvailable()) await SecureStore.deleteItemAsync(key);
    else {
      if (!globalThis.localStorage) throw new LocalizedError('errors.storageLocal');
      globalThis.localStorage.removeItem(key);
    }
  },
};
