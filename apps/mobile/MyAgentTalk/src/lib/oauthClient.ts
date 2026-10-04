// supabase-js 클라이언트 배선 (t_198b95cc) — OAuth 전용. lazy 단일 인스턴스.
//
// 규약 반영:
//  · detectSessionInUrl:false — 콜백 code 회수는 oauth.ts가 직접 파싱(web URL/expo-linking)하고
//    exchangeCodeForSession을 명시 호출. 기본값(true)이 window URL을 먼저 읽으면 파서와 경쟁해
//    콜백을 두 번 소비한다(한 번은 실패로 소음). 단일 소비 경로를 강제로 고정.
//  · autoRefreshToken:true — ours JWT가 만료돼도 sb 리프레시 토큰이 살아있으면
//    trySessionRecovery가 getSession()에서 갱신된 access token을 회수해 재exchange한다(카드 §4).
//  · persistSession:true — ours JWT는 api.ts 저장소(TOKEN_KEY) 단일 소스, sb 세션은 supabase
//    자체 키(sb-<ref>-auth-token)에만. ours 확보 후에도 sb 세션은 유지(§4 재exchange 폴백 근거),
//    파기는 탈퇴(oauth.signOutOAuth) 시에만 — '이중 저장 금지'는 api.ts 저장소 기준(카드 §2).
//  · Hermes polyfill (네이티브): auth-js 2.117은 crypto.getRandomValues·crypto.subtle·btoa를
//    조건부 없이 참조(라이브러리 소스 read-back: helpers.js generatePKCEVerifier/generatePKCEChallenge,
//    btoa는 :274) — expo-crypto + 최소 btoa 이식을 client 생성 직전 1회 주입. 웹은 no-op.
//    (Hermes는 URL/URLSearchParams/TextEncoder를 동봉 — RN 0.86 런타임 실측惯例, 추가 이식 없음.
//     expo-linking은 RN Linking 어댑터로 이 URL 파싱 경로에 관여하지 않는다.)
//  · storage (네이티브): @react-native-async-storage/async-storage — supabase 공식 RN 가이드 관례.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseSessionLite {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

// 리커버리가 파고드는 supabase 세션 슬롯(카드 §4의 'sb 세션 남아있나' 판정).
// OAuth 로그인 사용자만 채운다 — email/password 로그인은 절대 채워지지 않는다
// → trySessionRecovery 즉시 false, 현행 errors.auth 경로 1:1.
let currentSbSession: SupabaseSessionLite | null = null;
export function peekSupabaseSession(): SupabaseSessionLite | null {
  return currentSbSession;
}
export async function clearSupabaseSession(): Promise<void> {
  currentSbSession = null;
  const client = clientRef;
  if (client) {
    // supabase 로컬 스토리지의 sb 세션도 파기 — ours JWT가 유일한 저장 소스(카드 §2).
    try { await client.auth.signOut({ scope: 'local' }); } catch { /* 파기 실패는 치명 아님 */ }
  }
}

let clientRef: SupabaseClient | null = null;
let cryptoReady = false;

export async function ensureNativeCrypto(): Promise<void> {
  if (Platform.OS === 'web' || cryptoReady) return;
  cryptoReady = true;
  const g = globalThis as { crypto?: Crypto; btoa?: (s: string) => string };
  if (!g.crypto || typeof g.crypto.getRandomValues !== 'function') {
    // expo-crypto 57는 getRandomValues/randomUUID/digest를 노출(빌드 API read-back 확인).
    const ExpoCrypto = await import('expo-crypto');
    const cryptoObj = {
      getRandomValues: ExpoCrypto.getRandomValues as Crypto['getRandomValues'],
      randomUUID: ExpoCrypto.randomUUID,
      subtle: null as unknown as Crypto['subtle'],
    };
    g.crypto = cryptoObj as Crypto;
    // auth-js PKCE는 crypto.subtle.digest('SHA-256', bytes)를 요구 — expo-crypto.digest는
    // 이미 ArrayBuffer를 반환한다(라이브러리 시그니처 read-back) → 얇은 어댑터.
    (cryptoObj as { subtle: { digest: (alg: { name: string }, data: Uint8Array) => Promise<ArrayBuffer> } }).subtle = {
      // data를 ArrayBuffer 소유 복사본으로 정규화 — ExpoCrypto는 BufferSource(ArrayBufferView<ArrayBuffer>)를 요구.
      digest: async (_alg, data) => ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(data)),
    };
  }
  if (typeof g.btoa !== 'function') {
    // Hermes는 btoa가 없다 — auth-js 챌린지 계산 btoa(hashed)(binary string)가 무조건 참조.
    g.btoa = (input: string) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let out = '';
      for (let i = 0; i < input.length; i += 3) {
        const c0 = input.charCodeAt(i) & 0xff;
        const c1 = i + 1 < input.length ? input.charCodeAt(i + 1) & 0xff : NaN;
        const c2 = i + 2 < input.length ? input.charCodeAt(i + 2) & 0xff : NaN;
        out += chars[c0 >> 2];
        out += chars[((c0 & 3) << 4) | (Number.isNaN(c1) ? 0 : c1 >> 4)];
        out += Number.isNaN(c1) ? '=' : chars[((c1 & 15) << 2) | (Number.isNaN(c2) ? 0 : c2 >> 6)];
        out += Number.isNaN(c2) ? '=' : chars[c2 & 63];
      }
      return out;
    };
  }
}

export function getOAuthSupabaseClient(): SupabaseClient {
  if (clientRef) return clientRef;
  // Metro bake 규약: process.env.EXPO_PUBLIC_X 직접 정적 참조만 치환된다(t_198b95cc 번들 grep 실측).
  const url = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SUPABASE_URL) || '';
  const anonKey = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY) || '';
  if (!url || !anonKey) throw new Error('oauth_disabled'); // 노출 플래그가 false라 normally 도달 불가
  // supabase-js 2.117 옵션 위치(read-back): detectSessionInUrl·flowType·persistSession·
  // autoRefreshToken·storage은 전부 options.auth 하위 — 최상위에 두면 조용히 무시되고
  // 기본값(true)이 살아서 내부 자동 탐지가 PKCE verifier를 선소비한다(t_198b95cc 실측:
  // detectSessionInUrl:false가 최상위였던 빌드에서 exchangeCodeForSession이
  // AuthPKCECodeVerifierMissingError — 내부 자동 exchange가 code를 먼저 소비하고 제거한 탓).
  const options = {
    auth: {
      detectSessionInUrl: false, // 단일 소비 경로 고정(상단 주석) — bootstrapOAuthCallback만 code를 읽는다
      flowType: 'pkce' as const,
      persistSession: true,
      autoRefreshToken: true,
      // flowId를 redirect에 태운다 — 기본값(false)이면 리다이렉트 왕복 후 code↔verifier 매칭이
      // legacy 단일 슬롯으로 몰려 동시 플로우·재시도에서 verifier 불일치가 난다(라이브러리 doc
      // read-back: 'Flows that offer no way to obtain the flow id can only be correlated via
      // this flag'). 배포 노트: Supabase 대시보드 Redirect URLs는 와일드카드(app.myagenttalk.com/*)
      // 로 등록 — 쿼리 포함 정확 매칭이 ?sb_flow_id= 때문에 실패하는 것 방지.
      experimental: { appendPkceFlowIdToRedirects: true },
      // 네이티브 스토리지: supabase 공식 RN 가이드 = AsyncStorage (auth.storage 슬롯 —
      // 2.117에서 최상위 storage은 storage-js 옵션이라 위치가 다르다, 타입 read-back 확인).
      // SupportedStorage는 Promise 반환 getItem/setItem/removeItem — 래퍼로 명시 이식.
      ...(Platform.OS !== 'web' ? {
        storage: {
          getItem: (key: string) => AsyncStorage.getItem(key),
          setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
          removeItem: (key: string) => AsyncStorage.removeItem(key),
        },
      } : {}),
      // naver는 대시보드 Custom OIDC 등록(최종 순서) 후 노출 — 미등록 시 서버 400이
      // 한 줄 안내로 매핑되고 나머지 provider는 정상 동작(배지·목록 규칙과 무관).
    },
  };
  clientRef = createClient(url, anonKey, options);
  return clientRef;
}

/** code+flowId → sb 세션(access_token). 성공 시 peekSupabaseSession으로 노출(리커버리 폴백용). */
export async function exchangeSupabaseSession(code: string, flowId?: string): Promise<string | null> {
  const supabase = getOAuthSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );
  if (error || !data?.session?.access_token) return null;
  currentSbSession = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  };
  return currentSbSession.access_token;
}

// 재기동 후 supabase 저장소에 남아있던 세션 핸들로 메모리 슬롯을 재충전 — ours JWT는
// SecureStore/localStorage에 살아있고 sb 리프레시는 별도 슬롯이라, 재exchange 자격(OAuth
// 사용자)을 복원한다. ours JWT 보유자만 호출하는 lifecycle(App.tsx wire)에 연결.
// clientRef가 없으면(재기동 직후) 여기서 생성한다 — 플래그 ON을 통과한 호출자만 도달한다.
export async function rehydrateSupabaseSlot(): Promise<void> {
  if (currentSbSession) return;
  const client = clientRef ?? getOAuthSupabaseClient();
  try {
    const { data } = await client.auth.getSession();
    const s = data?.session;
    if (s?.access_token && s?.refresh_token) {
      currentSbSession = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at };
    }
  } catch { /* 슬롯 재충전은 최선 — 실패해도 현행 경로 무손상 */ }
}
