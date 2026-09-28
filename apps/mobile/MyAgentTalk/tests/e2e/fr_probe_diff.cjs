// probe.json 비교 — px/ms 값 정규화 후 키별 필드 동일성 (t_70cbbd6b)
const fs = require('fs');
const norm = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'string' ? x.replace(/\d+px/g, 'Npx').replace(/\d+(\.\d+)?ms/g, 'Nms').replace(/t=\d+/g, 't=N') : x)));
const A = norm(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
const B = norm(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
const keys = Array.from(new Set([...Object.keys(A), ...Object.keys(B)]));
let diff = 0;
for (const k of keys) {
  const sa = JSON.stringify(A[k]), sb = JSON.stringify(B[k]);
  if (sa !== sb) { diff++; console.log(`DIFF[${k}]\n  A=${sa}\n  B=${sb}`); }
}
if (!diff) console.log('=== PROBE IDENTICAL (px/ms 정규화 후) ===');
process.exit(diff ? 1 : 0);
