// fr_dom_diff.cjs — before/after DOM 스냅샷 불변성 비교 (t_70cbbd6b)
const fs = require('fs');
const [a, b] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(a, 'utf8'));
const B = JSON.parse(fs.readFileSync(b, 'utf8'));
let diffs = 0;
for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
  const va = JSON.stringify(A[k] ?? null);
  const vb = JSON.stringify(B[k] ?? null);
  if (va !== vb) { diffs++; console.log(`DIFF ${k}\n  before: ${va === undefined ? 'undefined' : va.slice(0, 300)}\n  after : ${vb === undefined ? 'undefined' : vb.slice(0, 300)}`); }
}
console.log(diffs ? `=== ${diffs} fields differ (${a} vs ${b})` : `=== IDENTICAL: ${a} == ${b}`);
process.exit(diffs ? 1 : 0);
