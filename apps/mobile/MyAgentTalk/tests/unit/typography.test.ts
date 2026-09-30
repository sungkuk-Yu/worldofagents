// 모바일 한글 가독성 타이포 계약 (t_99322cc0 — 대표님 9/30)
// ① 웹 폰트 스택은 한글 퍼스트(PretendardVariable 우선, Inter는 라틴만) — theme와 index.html 순서 일치
// ② 본문 17px·lineHeight 1.55 ③ 20px 이하 자간 음수 금지(28px+ 디스플레이만 허용)
// react-native는 require.cache 스텁 격리 (exportLogic.test.ts 관례).
import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function loadTheme(t: TestContext, platform: 'web' | 'ios' | 'android') {
  const modulePath = require.resolve('../../src/theme/index');
  const rnPath = require.resolve('react-native');
  const previous = require.cache[rnPath];
  require.cache[rnPath] = {
    exports: {
      Platform: {
        OS: platform,
        select: (o: Record<string, unknown>) => o[platform === 'web' ? 'web' : 'default'],
      },
      StyleSheet: { create: (s: unknown) => s },
    },
  } as unknown as NodeModule;
  delete require.cache[modulePath];
  const mod = require('../../src/theme/index') as typeof import('../../src/theme/index');
  t.after(() => {
    delete require.cache[modulePath];
    if (previous) require.cache[rnPath] = previous; else delete require.cache[rnPath];
  });
  return mod;
}

test('웹 폰트 스택 — PretendardVariable(한글) 퍼스트, Inter는 한글 폰트 뒤 (t_99322cc0 ①)', (t) => {
  const { fontFamily } = loadTheme(t, 'web');
  const first = fontFamily.split(',')[0].trim();
  assert.equal(first, 'PretendardVariable');
  const idxLatin = fontFamily.indexOf('Inter');
  const idxKorean = fontFamily.indexOf('Apple SD Gothic Neo');
  assert.ok(idxLatin > idxKorean, `Inter(라틴)는 한글 폴백 뒤: ${fontFamily}`);
});

test('index.html CSS 스택과 theme fontFamily(web) 순서 일치 — 공백 금지 (t_99322cc0 ①)', (t) => {
  const { fontFamily } = loadTheme(t, 'web');
  // 실행 위치가 앱 루트(원본)든 dist-test-unit(컴파일본)이든 public/index.html를 찾는다.
  const candidates = [
    path.resolve(__dirname, '../../public/index.html'),
    path.resolve(__dirname, '../../../public/index.html'),
    path.resolve(process.cwd(), 'public/index.html'),
  ];
  const htmlPath = candidates.find((p) => fs.existsSync(p));
  assert.ok(htmlPath, `index.html 위치 못 찾음: ${candidates.join(' | ')}`);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/html, body, #root\s*\{[^}]*font-family:\s*([^;]+);/);
  assert.ok(m, 'index.html 루트 폰트 선언을 찾지 못함');
  const norm = (s: string) => s.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).join(',');
  assert.equal(norm(m[1]), norm(fontFamily), 'CSS↔theme 폰트 순서 불일치');
  assert.match(html, /word-break:\s*keep-all/, '한글 줄바꿈 keep-all 유지');
});

test('본문 17px·lineHeight 1.55 — body/bodyBold (t_99322cc0 ②)', (t) => {
  const { typography } = loadTheme(t, 'web');
  assert.equal(typography.body.fontSize, 17);
  assert.equal(typography.bodyBold.fontSize, 17);
  assert.ok(Math.abs(typography.body.lineHeight / typography.body.fontSize - 1.55) < 0.001,
    `body 행간 ${typography.body.lineHeight} ≠ 1.55×17`);
});

test('자간 — 20px 이하 음수 금지(한글 뭉개짐), 28px+만 음수 허용 (t_99322cc0 ③)', (t) => {
  const { typography } = loadTheme(t, 'web');
  for (const [name, style] of Object.entries(typography)) {
    if (style.fontSize <= 20) {
      assert.ok(style.letterSpacing >= 0, `${name}(${style.fontSize}px) 자간 음수 불가: ${style.letterSpacing}`);
    }
  }
  assert.ok(typography.display.letterSpacing < 0, '디스플레이급(34) 음수 트래킹 유지');
});

test('네이티브는 PretendardVariable 단일 등록 유지 (t_99322cc0 — 기본)', (t) => {
  const { fontFamily } = loadTheme(t, 'ios');
  assert.equal(fontFamily, 'PretendardVariable');
});
