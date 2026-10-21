"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetStore = exports.getStore = exports.supabase = exports.supabaseAdmin = void 0;
exports.createEphemeralAuthClient = createEphemeralAuthClient;
exports.createUserClient = createUserClient;
const supabase_js_1 = require("@supabase/supabase-js");
const config_1 = require("../config");
const devstore_1 = require("./devstore");
function buildClient(url, key, opts) {
    if (config_1.config.devMode || opts?.dev) {
        return (0, devstore_1.createDevClient)((0, devstore_1.getStore)());
    }
    const client = (0, supabase_js_1.createClient)(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: opts?.accessToken
            ? { headers: { Authorization: `Bearer ${opts.accessToken}` } }
            : undefined,
    });
    return client;
}
// 서비스 롤 클라이언트 (RLS 우회 — 서버에서만 사용)
exports.supabaseAdmin = buildClient(config_1.config.supabase.url, config_1.config.supabase.serviceKey);
/**
 * 로그인(signInWithPassword) 전용 — 요청마다 새로 만드는 일회용 클라이언트의 auth.
 *
 * P0 핫픽스(t_486cf23b): 공유 supabaseAdmin에서 signInWithPassword를 호출하면
 * supabase-js가 해당 인스턴스에 사용자 세션을 저장한다(persistSession=false여도
 * 메모리 세션으로 유지). 이후 공유 클라이언트의 모든 PostgREST 요청이
 * service_role 키 대신 "마지막 로그인한 사용자"의 JWT를 Authorization으로 보내
 * RLS가 발동 → 002 마이그레이션(SELECT 전용 정책) 기준으로 쓰기 전체가 거부된다.
 * 따라서 사용자 세션이 생기는 auth 호출은 절대 공유 admin 클라이언트에서 하지 말고
 * 이 팩토리로 만든 일회용 클라이언트에서 수행한 뒤 버린다(GC).
 */
function createEphemeralAuthClient() {
    if (config_1.config.devMode) {
        // devstore 클라이언트는 세션 상태가 없는 무상태 객체 — 그래도 공유 인스턴스를
        // 건드리지 않도록 매번 새 래퍼를 만든다.
        return (0, devstore_1.createDevClient)((0, devstore_1.getStore)()).auth;
    }
    const client = (0, supabase_js_1.createClient)(config_1.config.supabase.url, config_1.config.supabase.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    return client.auth;
}
// 익명(anon) 클라이언트 (RLS 적용)
exports.supabase = buildClient(config_1.config.supabase.url, config_1.config.supabase.anonKey);
/** Phase 3 예정: 자체 JWT를 Supabase access token으로 교환한 뒤 사용할 RLS 클라이언트. */
function createUserClient(accessToken) {
    if (config_1.config.devMode)
        return exports.supabaseAdmin;
    return buildClient(config_1.config.supabase.url, config_1.config.supabase.anonKey, { accessToken });
}
// devstore 접근 (테스트/디버깅)
var devstore_2 = require("./devstore");
Object.defineProperty(exports, "getStore", { enumerable: true, get: function () { return devstore_2.getStore; } });
Object.defineProperty(exports, "resetStore", { enumerable: true, get: function () { return devstore_2.resetStore; } });
//# sourceMappingURL=supabase.js.map