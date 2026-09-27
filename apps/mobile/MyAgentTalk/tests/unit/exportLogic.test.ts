// 카드 내보내기 클라이언트 로직 단위 테스트 (t_3116c5bc)
// react-native/expo 모듈은 require.cache 스텁으로 격리 (secureStorage.test.ts 관례).
import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';

function loadExportLogic(t: TestContext, platform = 'web') {
  const modulePath = require.resolve('../../src/lib/exportLogic');
  const originals = new Map<string, NodeModule | undefined>();
  const stubs: [string, Record<string, unknown>][] = [
    ['react-native', { Platform: { OS: platform } }],
    ['expo-file-system', { File: class { }, Paths: { cache: 'cache://' } }],
    ['expo-sharing', { default: { isAvailableAsync: async () => false } }],
  ];
  for (const [name, exports] of stubs) {
    try {
      const path = require.resolve(name);
      originals.set(path, require.cache[path]);
      require.cache[path] = { exports } as unknown as NodeModule;
    } catch { /* module unresolvable in test env — skip stub */ }
  }
  delete require.cache[modulePath];
  const mod = require('../../src/lib/exportLogic') as typeof import('../../src/lib/exportLogic');
  t.after(() => {
    delete require.cache[modulePath];
    for (const [path, previous] of originals) { if (previous) require.cache[path] = previous; else delete require.cache[path]; }
  });
  return mod;
}

test('서식 목록과 xlsx 게이트 — 백엔드와 동일 좌표 (표 카드만 Excel)', (t) => {
  const { EXPORT_FORMATS, isTableDialogue, formatDisabled } = loadExportLogic(t);
  assert.deepEqual(EXPORT_FORMATS, ['pdf', 'docx', 'xlsx', 'hwp']);
  assert.equal(isTableDialogue('spreadsheet'), true);
  assert.equal(isTableDialogue('chart'), true);
  assert.equal(isTableDialogue('text'), false);
  assert.equal(formatDisabled('xlsx', 'chart'), false, '차트는 xlsx 활성');
  assert.equal(formatDisabled('xlsx', 'info_card'), true, '정보카드는 xlsx 비활성');
  assert.equal(formatDisabled('pdf', 'text'), false, '나머지는 항상 활성');
});

test('hwp는 docx 확장자로 저장 (서버 정직 폴백: .docx 바이트 서빙)', (t) => {
  const { formatExt } = loadExportLogic(t);
  assert.equal(formatExt('hwp'), 'docx');
  assert.equal(formatExt('pdf'), 'pdf');
});

test('클라 폴백 파일명 — 위험 문자 제거 + hwp→docx + id 접미', (t) => {
  const { exportDownloadFilename } = loadExportLogic(t);
  assert.equal(exportDownloadFilename('계약/검토: 최종??', 'msg12345678-abcd', 'xlsx'), '계약 검토 최종_msg12345_xlsx.xlsx');
  assert.equal(exportDownloadFilename('한글 세션', 'id12345678', 'hwp').endsWith('_hwp.docx'), true);
});

test('Content-Disposition 파싱 — filename* 우선, ASCII 폴백, 결측 null', (t) => {
  const { filenameFromDisposition } = loadExportLogic(t);
  assert.equal(filenameFromDisposition(`attachment; filename="fallback.docx"; filename*=UTF-8''${encodeURIComponent('계약_x.docx')}`), '계약_x.docx');
  assert.equal(filenameFromDisposition('attachment; filename="plain.pdf"'), 'plain.pdf');
  assert.equal(filenameFromDisposition(null), null);
  assert.equal(filenameFromDisposition('inline'), null);
});
