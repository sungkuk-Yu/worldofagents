// OAuth 순수 결정 로직 (t_198b95cc) — RN/expo/supabase import 금지 (node 단위테스트 직접 실행).
// 배선(oauth.ts)·클라이언트(oauthClient.ts)는 이 함수들만 호출해 '로직 vs 배선'을 분리한다.
export type OAuthProvider = 'google' | 'github' | 'kakao' | 'naver';

/** 카드 §1: supabase 네이티브 3종 + naver는 커스텀 OIDC. 지원 밖 값은 조용히 드롭(오타로
 *  미등록 provider 노출 방지). */
const SUPPORTED: readonly OAuthProvider[] = ['google', 'github', 'kakao', 'naver'];

/** 커스텀 OIDC 프로바이더는 supabase-js Provider 타입이 `custom:${string}`을 요구
 *  (auth-js 2.117 types read-back). naver는 대시보드 'Custom OIDC' 등록 항목 — 네이티브 내장이 아니다. */
export function supabaseProviderArg(p: OAuthProvider): string {
  return p === 'naver' ? 'custom:naver' : p;
}

/** EXPO_PUBLIC_OAUTH_PROVIDERS csv 파서 — 공백·대소문자 무시, 지원 밖 드롭, 중복 제거.
 *  빌드 시점 env(규약: EXPO_PUBLIC_*는 export 타임 베이크)이라 런타임 토글 없다.
 *  등록 전(env 빈 값) [] → 버튼 전체 미노출(카드 §1 'configured면 노출'의 프론트 측 단일 소스). */
export function parseAllowedProviders(raw: string | undefined | null): OAuthProvider[] {
  const list = (raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is OAuthProvider => (SUPPORTED as readonly string[]).includes(s));
  return Array.from(new Set(list));
}

/** 카드 §3 배치: 카카오·네이버 한국 우선 → 앞, 글로벌(구글·깃허브) 뒤. 허용 목록 내 것만 고정 순서. */
const KOREA_FIRST: OAuthProvider[] = ['kakao', 'naver', 'google', 'github'];
export function orderProviders(allowed: OAuthProvider[]): OAuthProvider[] {
  return KOREA_FIRST.filter((p) => allowed.includes(p));
}

/** OAuth 리다이렉트 복귀 파라미터 — supabase PKCE: code + sb_flow_id. 쿼리·해시 모두 회수. */
export interface CallbackParams {
  code?: string;
  flowId?: string;
  error?: string;
}
export function parseCallbackUrl(search: string, hash: string): CallbackParams | null {
  const out: CallbackParams = {};
  let found = false;
  for (const chunk of [search, hash]) {
    const q = (chunk || '').replace(/^[?#]/, '');
    if (!q) continue;
    for (const [k, v] of new URLSearchParams(q)) {
      if (k === 'code') { out.code = v; found = true; }
      else if (k === 'sb_flow_id') { out.flowId = v; found = true; }
      else if (k === 'error') { out.error = v; found = true; }
    }
  }
  return found ? out : null;
}

/** 콜백 파라미터 소비 여부(URL 정리기에서 클린업 판정). */
export function hasCallbackParams(p: CallbackParams | null): boolean {
  return !!p && (p.code !== undefined || p.error !== undefined || p.flowId !== undefined);
}

/** 네이티브 딥링크 정규화 — supabase는 redirectTo 'agenttalk://' 뒤에 '?code=…'를 붙여
 *  'agenttalk://?code=…'를 만든다. 이 형태는 파서에서 빈 authority 뒤 '?'라 쿼리 회수가
 *  불안정하다. scheme:// + '/?code=…'(빈 호스트 + 루트 path)로 보정. 이미 path가 있는
 *  URL·http(s)는 무변경. */
export function normalizeNativeDeepLink(raw: string): string {
  return raw.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:)\/{1,2}\?/, '$1///?');
}

/** raw URL(딥링크 문자열) → 콜백 파라미터. 파싱 불가 시 null(조용히 무시). */
export function parseDeepLink(rawUrl: string | null | undefined): CallbackParams | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(normalizeNativeDeepLink(rawUrl));
    return parseCallbackUrl(u.search, u.hash);
  } catch {
    return null;
  }
}

/** 자동 루프 가드: 콜백 소비는 부트스트랩 1회 + 사용자 터치만. 연속 실패 횟수가 상한(3)을
 *  넘으면 자동 재시도를 차단한다(URL残留·리스너 중복이 exchange 무한 재시도를 못 만든다). */
export function shouldRetryOAuth(failCount: number): boolean {
  return failCount < 3;
}

/** §4 세션 폴백 판정: sb 세션 핸들(리프레시)이 살아있고(=OAuth 사용자) 다른 재exchange가
 *  진행 중이지 않을 때만. email/password는 첫 조건부터 false → 현행 errors.auth 경로 보존. */
export function canRecoveryExchange(hasSupabaseSession: boolean, exchangeInFlight: boolean): boolean {
  return hasSupabaseSession && !exchangeInFlight;
}

/** OAuth 오류 → errors.* 키 매핑. 원시 코드/메시지를 UI에 직접 노출하지 않는다(관례).
 *  취소(access_denied/user cancelled), 네트워크, 그 외 전부 oauthFailed 폴백. */
export function oauthErrorKey(raw: string | null | undefined): string {
  const s = (raw || '').toLowerCase();
  if (s.includes('access_denied') || s.includes('cancel')) return 'errors.oauthCancelled';
  if (s.includes('network') || s.includes('failed to fetch') || s.includes('timeout')) return 'errors.oauthNetwork';
  return 'errors.oauthFailed';
}
