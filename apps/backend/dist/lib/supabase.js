"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetStore = exports.getStore = exports.supabase = exports.supabaseAdmin = void 0;
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
// 익명(anon) 클라이언트 (RLS 적용)
exports.supabase = buildClient(config_1.config.supabase.url, config_1.config.supabase.anonKey);
// 사용자 JWT 기반 클라이언트 — RLS가 사용자 컨텍스트를 반영
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