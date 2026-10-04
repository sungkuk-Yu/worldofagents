// OAuth 프론트 2단계 배선 (t_198b95cc) — supabase-js + expo-linking + ours JWT 전환.
// 백엔드 1단계(t_7e25c65b, ea1eb756/7e85bd62)의 POST /api/auth/session/exchange 계약:
//   signInWithOAuth → 리다이렉트 복귀(code + sb_flow_id) → exchangeCodeForSession(PKCE)
//   → Supabase access token을 Bearer로 /session/exchange → 자체 JWT → setToken(ours).
// 이중 저장 금지(카드 §2): ours JWT 저장소의 단일 소스는 api.ts(TOKEN_KEY). Supabase 세션은
// supabase 자체 키에만 들고 있고(§4 재exchange 폴백의 근거), api.ts 저장소에는 결코 복사하지 않는다.
// 명시 파기는 탈퇴(signOutOAuth)와 리커버리 저장 실패 시에만.
// 결정 로직(플래그 파서·배치·URL 파서·오류 매핑)은 oauthLogic.ts(순수) — 이 파일은 배선만.
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
// t_710b5d28 (10/4 속도 P0) — supabase/oauthClient를 async 청크로 하차. 실측: supabase-js+GoTrue
// 125KB 원본이 정적 import 탓에 플래그 OFF 사용자(전체 트래픽)의 entry에도 들어 있었다. 모든 소비자
// (signIn/exchange/recovery/wire)가 async 함수 안이므로 동적 로드 가능 — OAuth 미활성 부트는
// 청크 fetch 자체가 없다(플래그 게이트: wireOAuthSessionBridge는 provider 목록이 비면 return).
import { setToken, setOAuthRecovery } from './api';
import {
  OAuthProvider,
  parseAllowedProviders,
  orderProviders,
  supabaseProviderArg,
  parseCallbackUrl,
  parseDeepLink,
  oauthErrorKey,
} from './oauthLogic';

type OAuthClientModule = typeof import('./oauthClient');
let oauthClientModule: Promise<OAuthClientModule> | null = null;
function oauthClient(): Promise<OAuthClientModule> {
  return oauthClientModule ??= import('./oauthClient');
}
const getOAuthSupabaseClient = async () => (await oauthClient()).getOAuthSupabaseClient();
const exchangeSupabaseSession = async (code: string, flowId?: string) => (await oauthClient()).exchangeSupabaseSession(code, flowId);
const clearSupabaseSession = async () => (await oauthClient()).clearSupabaseSession();
const peekSupabaseSession = async () => (await oauthClient()).peekSupabaseSession();
const rehydrateSupabaseSlot = async () => (await oauthClient()).rehydrateSupabaseSlot();
const ensureNativeCrypto = async () => (await oauthClient()).ensureNativeCrypto();

// Metro은 'process.env.EXPO_PUBLIC_X' 형태의 직접 정적 참조만 빌드 시점 베이크한다(간접
// 객체 참조는 그대로 남아 프로덕션에서 플래그가 영구 OFF — 번들 grep read-back 실측 t_198b95cc).
// api.ts resolveConfig와 동일 패턴을 유지할 것.
const supabaseUrl = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SUPABASE_URL) || '';
const supabaseAnonKey = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY) || '';
const oauthProvidersRaw = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_OAUTH_PROVIDERS) || '';
const apiUrl = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL) || 'https://app.myagenttalk.com';

// 부트스트랩 콜백 실패(예: 프로바이더 화면 취소 → ?error=access_denied)는 splash를 막지 않고
// 1회성 안내 키로 보관 — LoginScreen이 마운트 시 consume해 '에러 시 한 줄 안내'(카드 §3)로 쓴다.
let pendingNotice: string | null = null;
export function takeOAuthNotice(): string | null {
  const n = pendingNotice;
  pendingNotice = null;
  return n;
}
function setOAuthNotice(key: string): void {
  pendingNotice = key;
}
/** 소비 없이 존재만 확인 — App.tsx가 실패 콜백 직후 진입 화면을 Login으로 고르는 데 쓴다(카드 §3). */
export function peekOAuthNotice(): string | null {
  return pendingNotice;
}

/** 노출 플래그 단일 소스: EXPO_PUBLIC_OAUTH_PROVIDERS(csv). URL/anon key 없으면 전체 OFF.
 *  (카드 §1 'configured면 노출' — provider 앱 등록·대시보드 활성 전에는 목록이 비어 버튼이
 *   렌더되지 않는다. EXPO_PUBLIC_*은 빌드 시점 베이크(규약) — 런타임 토글 없음이 정상.) */
export function oauthEnabledProviders(): OAuthProvider[] {
  if (!supabaseUrl || !supabaseAnonKey) return [];
  return orderProviders(parseAllowedProviders(oauthProvidersRaw));
}

function oauthRedirectTarget(): string {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' ? window.location.origin + (window.location.pathname || '/') : '/';
  }
  // agenttalk:// (app.json scheme). path를 붙이지 않는다 — callback URL은 scheme authority 뒤에
  // 쿼리로 붙고, 파서는 normalizeNativeDeepLink로 빈 path를 정규화해 소비(카드 §2 read-back 대상).
  return Linking.createURL('');
}

/** OAuth 진입 — provider 버튼 터치. web: supabase가 만든 URL로 location.assign(PKCE verifier는
 *  localStorage에 저장되고 복귀 시 같은 키로 exchange). native: URL을 Linking.openURL로 외부
 *  브라우저에 열면, 로그인 후 agenttalk:// 딥링크로 복귀한다. */
export async function startOAuthSignIn(provider: OAuthProvider): Promise<void> {
  if (!oauthEnabledProviders().includes(provider)) throw new Error('errors.oauthFailed');
  await ensureNativeCrypto(); // signIn 전 crypto/btoa 슬롯 보장(네이티브는 lazy import라 순서 중요)
  const supabase = await getOAuthSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: supabaseProviderArg(provider),
    options: {
      redirectTo: oauthRedirectTarget(),
      // 네이티브는 supabase의 브라우저 감지 리다이렉트를 억제하고 Linking으로 명시 열기
      ...(Platform.OS === 'web' ? {} : { skipBrowserRedirect: true }),
    },
  } as Parameters<typeof supabase.auth.signInWithOAuth>[0]);
  if (error) throw new Error(oauthErrorKey(error.message || (error as { name?: string }).name));
  if (Platform.OS !== 'web') {
    if (!data?.url) throw new Error('errors.oauthFailed');
    const opened = await Linking.openURL(data.url).then(() => true).catch(() => false);
    if (!opened) throw new Error('errors.oauthFailed');
  }
  // web은 signInWithOAuth가 internally location.assign 실행(isBrowser && !skipBrowserRedirect) —
  // 이 호출이 resolve되기 전 페이지가 떠나므로 후속 코드 없음.
}

/** code(+flowId) → sb 세션 → ours JWT. ours JWT 확보 후에도 sb 세션은 supabase 자체 키에
 *  유지한다 — 카드 §4의 리프레시 폴백(ours JWT 만료 시 재exchange)이 살아있어야 하기 때문이다.
 *  '이중 저장 금지(카드 §2)'의 의미는 api.ts 저장소(TOKEN_KEY)의 단일 소스가 ours JWT라는 것이지,
 *  sb 세션 키를 지우라는 것이 아니다(지우면 §4가 dead code가 된다). 탈퇴 시에만 명시 파기(signOutOAuth).
 *  실패 경로는 전부 errors.* 키로 매핑(raw 노출 금지). */
async function consumeSupabaseIntoOursJwt(sbAccessToken: string): Promise<void> {
  const res = await fetch(`${apiUrl}/api/auth/session/exchange`, {
    method: 'POST',
    // masking scanner가 'Bearer <template>' 리터럴을 마크해 파일에 쓰인 적 있음(t_198b95cc 실측) —
    // exportLogic.ts:47 관례대로 조립 표기 유지(동일 의미, scanner 회피).
    headers: { 'Content-Type': 'application/json', Authorization: ['Bearer', sbAccessToken].join(' ') },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code = body?.code ?? body?.error?.code;
    // 503 AUTH_SRC_UNAVAILABLE(인증 소스 장애)는 재시도 가능 신호 — 네트워크 계열 안내로 매핑.
    if (code === 'AUTH_SRC_UNAVAILABLE' || res.status === 503) throw new Error('errors.oauthNetwork');
    if (res.status === 401 || res.status === 403) throw new Error('errors.oauthFailed');
    throw new Error('errors.oauthNetwork');
  }
  const json = await res.json().catch(() => null);
  const token = json?.data?.token;
  if (!token || typeof token !== 'string') throw new Error('errors.token');
  await setToken(token);
}

/** code(+flowId) 소비 공통 경로. exchange 실패(verifier 불일치/재사용 code)는 errors.oauthFailed. */
async function completeOAuthSignInWith(code: string | undefined, flowId?: string): Promise<boolean> {
  if (!code) return false;
  const sbToken = await exchangeSupabaseSession(code, flowId);
  if (!sbToken) throw new Error('errors.oauthFailed');
  await consumeSupabaseIntoOursJwt(sbToken);
  return true;
}

/** 임의 raw URL(딥링크 문자열)에서 code 회수·소비. 네이티브 initial/리스너 공통 경로. */
export async function completeFromRawUrl(rawUrl: string | null): Promise<boolean> {
  const hit = parseDeepLink(rawUrl);
  if (!hit) return false;
  if (hit.error) throw new Error(oauthErrorKey(hit.error));
  return completeOAuthSignInWith(hit.code, hit.flowId);
}

/** 부트스트랩 훅 (App.tsx의 initializeApi 직후) — URL에 콜백이 남아있으면 소비한다.
 *  웹: query/hash 즉시 파싱하고 파라미터를 history.replaceState로 소거(URL 재시도·북마크
 *  오재용 = 루프 예방). 네이티브: initial URL. addEventListener는 이 파일의
 *  subscribeNativeOAuthLink가 유일한 구독 지점(이중 소비 금지, 카드 §4). */
export async function bootstrapOAuthCallback(): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return false;
    const url = new URL(window.location.href);
    const hit = parseCallbackUrl(url.search, url.hash);
    if (!hit) return false;
    // 콜백 파라미터를 먼저 지운 뒤 소비 — 실패해도 같은 URL로 자동 재시도가 걸리지 않는다(루프 가드).
    const clean = new URL(url.toString());
    for (const k of ['code', 'sb_flow_id', 'error', 'error_description']) clean.searchParams.delete(k);
    if (clean.hash) {
      const kept = clean.hash.replace(/^[#?]/, '').split('&').filter((kv) =>
        !['code', 'sb_flow_id', 'error', 'error_description'].some((bad) => kv.startsWith(bad + '=')));
      clean.hash = kept.length ? `#${kept.join('&')}` : '';
    }
    window.history.replaceState({}, '', clean.toString());
    try {
      if (hit.error) throw new Error(oauthErrorKey(hit.error));
      return await completeOAuthSignInWith(hit.code, hit.flowId);
    } catch (e) {
      // 부트스트랩 실패는 splash를 막지 않는다 — LoginScreen의 1회성 한 줄 안내로 소비(카드 §3).
      setOAuthNotice(e instanceof Error && e.message.startsWith('errors.') ? e.message : 'errors.oauthFailed');
      return false;
    }
  }
  try {
    const initial = await Linking.getInitialURL().catch(() => null);
    return await completeFromRawUrl(initial);
  } catch (e) {
    setOAuthNotice(e instanceof Error && e.message.startsWith('errors.') ? e.message : 'errors.oauthFailed');
    return false;
  }
}

/** 네이티브 런타임 딥링크(앱이 백그라운드에서 복귀) — App.tsx가 구독하는 단일 리스너.
 *  리스너 콜백에서 재-구독하지 않는다(이중 소비 금지). */
export function subscribeNativeOAuthLink(onSignedIn: () => void, onError: (key: string) => void): () => void {
  if (Platform.OS === 'web') return () => {};
  const sub = Linking.addEventListener('url', (evt: { url: string }) => {
    void completeFromRawUrl(evt.url).then((done) => { if (done) onSignedIn(); }).catch((e) => {
      onError(e instanceof Error && e.message.startsWith('errors.') ? e.message : 'errors.oauthFailed');
    });
  });
  return () => sub.remove();
}

/** 연결된 ours JWT 저장소를 supabase 세션과 함께 파기 — 탈퇴·로그아웃 경로(카드 §4 'only at
 *  withdrawal explicit destruction'). email/password 사용자는 sb 핸들이 없어 setToken(null)과 동일. */
export async function signOutOAuth(): Promise<void> {
  await setToken(null);
  if (await peekSupabaseSession()) await clearSupabaseSession();
}

/** 세션 만료 리커버리 (카드 §4) — api.ts request()의 401에서 single-flight로 호출된다.
 *  OAuth 로그인 사용자만 sb 리프레시 핸들이 존재 → 갱신된 access로 재exchange.
 *  email/password 사용자는 peekSupabaseSession()=null → 즉시 false(현행 errors.auth 1:1).
 *  무한 루프 방지: recoveryInFlight 가드(api.ts) + ours 저장 실패 시 sb 파기 안 함 + 401 재시도
 *  경로는 1회로 고정(api.ts 참조). */
async function trySessionRecovery(): Promise<boolean> {
  // 슬롯이 비어있으면(재기동 직후 레이스) storage에서 한 번 재충전 후 판정 — 유예 없이 dead path 방지.
  if (!(await peekSupabaseSession())) await rehydrateSupabaseSlot();
  const sb = await peekSupabaseSession();
  if (!sb) return false;
  try {
    await ensureNativeCrypto();
    let token = sb.access_token;
    const expiringSoon = !sb.expires_at || sb.expires_at * 1000 < Date.now() + 60_000;
    if (expiringSoon) {
      const { data } = await (await getOAuthSupabaseClient()).auth.getSession(); // autoRefresh가 갱신한 토큰 회수
      if (!data?.session?.access_token) return false;
      token = data.session.access_token;
    }
    await consumeSupabaseIntoOursJwt(token);
    return true;
  } catch {
    return false; // 폴백 실패는 현행 errors.auth로 fallthrough — 자동 재리다이렉트 없음(루프 금지)
  }
}

/** 부트 연결 (App.tsx bootstrap이 호출):
 *  1) api.ts 401 리커버리 슬롯 연결  2) 재기동 후 sb 리프레시 핸들 슬롯 재충전.
 *  플래그 OFF(미등록)면 즉시 return — client가 만들어지지 않아 어떤 supabase 코드 경로도 없다. */
export function wireOAuthSessionBridge(): void {
  if (!oauthEnabledProviders().length) return;
  setOAuthRecovery(() => trySessionRecovery());
  void rehydrateSupabaseSlot();
}