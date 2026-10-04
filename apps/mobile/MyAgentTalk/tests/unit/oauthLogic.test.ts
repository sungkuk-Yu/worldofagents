// OAuth 순수 로직 회귀 (t_198b95cc) — 결정 함수만 다룬다(배선은 e2e 담당).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAllowedProviders,
  orderProviders,
  supabaseProviderArg,
  parseCallbackUrl,
  normalizeNativeDeepLink,
  parseDeepLink,
  hasCallbackParams,
  shouldRetryOAuth,
  canRecoveryExchange,
  oauthErrorKey,
} from '../../src/lib/oauthLogic';

test('플래그 파서 — csv·공백·대소문자·미지원 무시·중복 제거', () => {
  assert.deepEqual(parseAllowedProviders('google,github'), ['google', 'github']);
  assert.deepEqual(parseAllowedProviders(' KAKAO , naver '), ['kakao', 'naver']);
  assert.deepEqual(parseAllowedProviders('google,facebook,google'), ['google']);
  assert.deepEqual(parseAllowedProviders(''), []);
  assert.deepEqual(parseAllowedProviders(undefined), []);
});

test('배치 — 카카오/네이버 우선, 허용 목록 밖은 낙하', () => {
  assert.deepEqual(orderProviders(parseAllowedProviders('google,github,kakao,naver')), ['kakao', 'naver', 'google', 'github']);
  assert.deepEqual(orderProviders(parseAllowedProviders('github,naver')), ['naver', 'github']);
});

test('supabase 인자 — naver만 custom 접두 (auth-js Provider 타입 read-back)', () => {
  assert.equal(supabaseProviderArg('naver'), 'custom:naver');
  assert.equal(supabaseProviderArg('google'), 'google');
});

test('콜백 URL 파서 — query PKCE(code+sb_flow_id)와 hash implicit(access_token=code 없음) 분리 회수', () => {
  const q = parseCallbackUrl('?code=abc123&sb_flow_id=f-42&state=x', '');
  assert.deepEqual(q, { code: 'abc123', flowId: 'f-42' });
  const h = parseCallbackUrl('', '#error=access_denied&error_description=user+cancelled');
  assert.deepEqual(h, { error: 'access_denied' });
  assert.equal(parseCallbackUrl('?foo=1', ''), null);
  assert.equal(parseCallbackUrl('', ''), null);
});

test('네이티브 딥링크 정규화 — agenttalk://?code=… → 빈 path 슬래시 보정', () => {
  assert.equal(normalizeNativeDeepLink('agenttalk://?code=abc&sb_flow_id=f1'), 'agenttalk:///?code=abc&sb_flow_id=f1');
  assert.equal(normalizeNativeDeepLink('agenttalk://oauth/callback?code=abc'), 'agenttalk://oauth/callback?code=abc');
  assert.equal(normalizeNativeDeepLink('https://app.myagenttalk.com/?code=x'), 'https://app.myagenttalk.com/?code=x');
  const hit = parseDeepLink('agenttalk://?code=abc&sb_flow_id=f1');
  assert.deepEqual(hit, { code: 'abc', flowId: 'f1' });
  assert.equal(parseDeepLink(null), null);
  assert.equal(parseDeepLink('::not-a-url::'), null);
});

test('hasCallbackParams — 파라미터 소비 판정', () => {
  assert.equal(hasCallbackParams({ code: 'x' }), true);
  assert.equal(hasCallbackParams({ error: 'e' }), true);
  assert.equal(hasCallbackParams({}), false);
  assert.equal(hasCallbackParams(null), false);
});

test('루프 가드 — 연속 실패 3회까지 재시도, 초과 차단', () => {
  assert.equal(shouldRetryOAuth(0), true);
  assert.equal(shouldRetryOAuth(2), true);
  assert.equal(shouldRetryOAuth(3), false);
});

test('리커버리 판정 — sb 세션 없으면(email/password) 즉시 false, 진행 중이면 중복 차단', () => {
  assert.equal(canRecoveryExchange(false, false), false);
  assert.equal(canRecoveryExchange(true, false), true);
  assert.equal(canRecoveryExchange(true, true), false);
});

test('오류 매핑 — 원시 코드는 errors.* 키로만 (raw 노출 금지 관례)', () => {
  assert.equal(oauthErrorKey('access_denied'), 'errors.oauthCancelled');
  assert.equal(oauthErrorKey('Network request failed'), 'errors.oauthNetwork');
  assert.equal(oauthErrorKey('code already used'), 'errors.oauthFailed');
  assert.equal(oauthErrorKey(null), 'errors.oauthFailed');
});
