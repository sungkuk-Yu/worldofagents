"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = exports.supabaseAdmin = void 0;
exports.createSupabaseClient = createSupabaseClient;
const supabase_js_1 = require("@supabase/supabase-js");
const config_1 = require("../config");
// Admin client (bypasses RLS)
exports.supabaseAdmin = (0, supabase_js_1.createClient)(config_1.config.supabase.url, config_1.config.supabase.serviceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});
// Public client (RLS applied)
exports.supabase = (0, supabase_js_1.createClient)(config_1.config.supabase.url, config_1.config.supabase.anonKey);
// Create client from user JWT
function createSupabaseClient(accessToken) {
    return (0, supabase_js_1.createClient)(config_1.config.supabase.url, config_1.config.supabase.anonKey, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    });
}
//# sourceMappingURL=supabase.js.map