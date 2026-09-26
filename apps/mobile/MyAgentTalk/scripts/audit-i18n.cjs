// 주석을 제외한 한국어 리터럴과 정적 JSX 문구를 검사한다.
// --strict: App.tsx + src/**/*.{ts,tsx} 전수 스캔. 위반 시 exit 1 (CI 게이트).
// 면제 규칙 (t_46a5431d 확정):
//   1) `// i18n-exempt: <이유>` 같은 줄/직전 줄 → 그 줄 면제
//   2) `/* i18n-exempt-start */ ... /* i18n-exempt-end */` 블록 → 구간 전체 면제 (데이터 사전/키워드 매칭용)
//   3) console.* 호출 인자 → 자동 면제 (개발 로그는 사용자 노출 문구 아님)
//   4) JSX 텍스트는 한글 포함 시에만 위반 (심볼·숫자·영문 라벨은 오검사 제외)
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const STRICT = process.argv.includes('--strict');

// 전수 모드에서 면제할 경로 (사전·i18n 부팅은 t().fallback 사슬의 종점, 데모/정책 본문은 문서 자산)
const SKIP = [
  /(^|\/)src\/i18n\//,
  /(^|\/)src\/lib\/(demoContent|legalText)\.ts$/,
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('dist')) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const legacy = ['App.tsx', ...['ChatScreen', 'LoginScreen', 'DialogueListScreen', 'SettingsScreen', 'FavoritesScreen'].map((name) => `src/screens/${name}.tsx`), 'src/lib/chatLogic.ts', 'src/lib/api.ts', 'src/hooks/useChatSession.ts', 'src/components/RichText.tsx', 'src/components/RichLinks.tsx', 'src/components/dialogs/FormCard.tsx', 'src/components/dialogs/ChartCard.tsx', 'src/components/dialogs/MediaCard.tsx', 'src/cards/TextCard.tsx'];

const files = STRICT ? ['App.tsx', ...walk('src', [])].filter((f) => !SKIP.some((re) => re.test(f))) : legacy;

function exemptLines(text) {
  const lines = text.split('\n');
  const set = new Set();
  let block = null;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (line.includes('i18n-exempt-start')) block = n;
    if (block !== null) { set.add(n); if (line.includes('i18n-exempt-end')) block = null; }
    if (block === null && /(^|\/\/|\/\*)\s*i18n-exempt\b/.test(line)) set.add(n);
  });
  lines.forEach((line, i) => {
    if (/i18n-exempt\b/.test(line) && !/exempt-(start|end)/.test(line)) set.add(i + 2);
  });
  return set;
}

let violations = 0;
const perFile = new Map();
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const exempt = exemptLines(text);
  const isConsoleArg = (node) => {
    let cur = node, parent = node.parent;
    while (parent && parent !== source) {
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
        && ts.isIdentifier(parent.expression.expression) && parent.expression.expression.text === 'console') {
        return parent.arguments.includes(cur);
      }
      cur = parent; parent = parent.parent;
    }
    return false;
  };
  const report = (node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    const n = line + 1;
    if (exempt.has(n)) return;
    if (STRICT) {
      perFile.set(file, (perFile.get(file) || 0) + 1);
      console.log(`${file}:${n}: ${node.text.trim().slice(0, 70)}`);
    } else {
      console.log(`${file}:${n}: ${node.text.trim()}`);
    }
    violations++;
  };
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'console') {
      ts.forEachChild(node.expression, visit); // 로그 메시지 본문은 면제, 호출부는 계속 검사
      return;
    }
    const literal = ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if ((literal && /[가-힣]/u.test(node.text)) || (ts.isJsxText(node) && /[가-힣]/u.test(node.text))) report(node);
    ts.forEachChild(node, visit);
  };
  (function wire(node) { node.parent = node.parent ?? source; ts.forEachChild(node, wire); })(source);
  visit(source);
}
if (STRICT && perFile.size) {
  console.log('--- 파일별 ---');
  for (const [f, n] of [...perFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${f}`);
}
console.log(`검사 파일 ${files.length}개${STRICT ? ' (strict 전수)' : ''}, 미면제 하드코딩 문구 ${violations}건`);
process.exitCode = violations ? 1 : 0;
