// AUTO-GENERATED — 백엔드 apps/backend/src/lib/empathyRule.ts의 esbuild CJS 스냅샷.
// 손 edits 금지. 백엔드 pool/빌더 변경 후 재생성: bash tools/extract-empathy-pool.sh
// 용도: tests/e2e/run_c_fixtures.cjs 재질문 미러 (t_a7b39e0f 드리프트 봉인).
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../../.hermes/profiles/frontdev/cache/scratch/tmp.aloZi7HkB4/pool-reexport.ts
var pool_reexport_exports = {};
__export(pool_reexport_exports, {
  pool: () => EMPATHY_REQUESTION_TEMPLATES,
  requestion: () => buildEmpathyRequestion,
  summary: () => empathyKeywordSummary
});
module.exports = __toCommonJS(pool_reexport_exports);

// apps/backend/src/lib/empathyRule.ts
var EMPATHY_REQUESTION_TEMPLATES = [
  { id: "eq_confirm", ko: "\uC81C \uC0DD\uAC01\uC5D4 {\uC694\uC57D}\uB77C\uB294 \uB9D0\uC500\uC774\uC2E0 \uAC74\uAC00\uC694?", en: 'Am I right that you mean "{\uC694\uC57D}"?' },
  { id: "eq_proceed", ko: "{\uC694\uC57D} \uAC74\uC73C\uB85C \uC81C\uAC00 \uBC14\uB85C \uC9C4\uD589\uD574\uB3C4 \uB420\uAE4C\uC694?", en: 'Shall I go ahead with "{\uC694\uC57D}" as I read it?' },
  { id: "eq_understand", ko: "\uC81C\uAC00 \uC774\uD574\uD55C \uAC74 {\uC694\uC57D} \uCABD\uC774\uC5D0\uC694 \u2014 \uB9DE\uC744\uAE4C\uC694?", en: 'My reading is "{\uC694\uC57D}" \u2014 does that land?' },
  { id: "eq_align", ko: "{\uC694\uC57D}\uC774\uB77C\uB294 \uB9D0\uC500\uC774\uC2E0 \uAC70\uC8E0?", en: `You're saying "{\uC694\uC57D}", right?` }
];
function empathyKeywordSummary(message) {
  const cleaned = message.replace(/^(안녕하세요|반갑습니다|그럼|그래서|근데|그런데|있잖아|있죠|저희|우리)\s*[,!?]?\s*/i, "").replace(/[。．.，,、!！?？~〜'"\\n]+/g, " ").replace(/\s+/g, " ").trim();
  const head = cleaned || message.trim();
  return head.length > 24 ? head.slice(0, 24).trimEnd() + "\u2026" : head;
}
function buildEmpathyRequestion(message, lastTemplateId, locale) {
  const pool = EMPATHY_REQUESTION_TEMPLATES;
  const summary = empathyKeywordSummary(message);
  const prev = lastTemplateId ? pool.findIndex((t2) => t2.id === lastTemplateId) : -1;
  let idx;
  if (prev >= 0) {
    idx = (prev + 1) % pool.length;
  } else {
    let h = 0;
    for (const ch of message) h = h * 31 + ch.codePointAt(0) >>> 0;
    idx = h % pool.length;
    if (idx === prev) idx = (idx + 1) % pool.length;
  }
  const t = pool[idx];
  const raw = locale === "en" ? t.en : t.ko;
  return { text: raw.split("{\uC694\uC57D}").join(summary), templateId: t.id };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  pool,
  requestion,
  summary
});
