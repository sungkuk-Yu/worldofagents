// 주석을 제외한 한국어 리터럴과 정적 JSX 문구를 검사한다.
const fs = require('node:fs');
const ts = require('typescript');
const files = ['App.tsx', ...['ChatScreen', 'LoginScreen', 'DialogueListScreen', 'SettingsScreen', 'FavoritesScreen', 'LegalDocScreen'].map((name) => `src/screens/${name}.tsx`), 'src/lib/chatLogic.ts', 'src/lib/api.ts', 'src/hooks/useChatSession.ts', 'src/components/RichText.tsx', 'src/components/RichLinks.tsx', 'src/components/dialogs/FormCard.tsx', 'src/components/dialogs/ChartCard.tsx', 'src/components/dialogs/MediaCard.tsx', 'src/components/dialogs/WithdrawDialog.tsx', 'src/cards/TextCard.tsx'];
let violations = 0;
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    const literal = ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if ((literal && /[가-힣]/u.test(node.text)) || (ts.isJsxText(node) && /[가-힣a-zA-Z0-9]/u.test(node.text))) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      console.log(`${file}:${line + 1}: ${node.text.trim()}`);
      violations++;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
console.log(`검사 파일 ${files.length}개, 주석 제외 하드코딩 문구 ${violations}건`);
process.exitCode = violations ? 1 : 0;
