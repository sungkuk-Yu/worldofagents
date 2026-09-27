// PDF 포맷터 (t_3116c5bc) — headless Chromium --print-to-pdf 실행.
// 백엔드는 PDF 엔진을 직접 구현하지 않는다: 인쇄 최적화 HTML(renderHtml print:true)을 만든 뒤
// 로컬 chrome-headless-shell을 자식으로 띄워 PDF로 굽는다.
//   - CHROME_PATH 환경변수 > 잘-known 캐시 경로 순 탐색. 없으면 null 반환 → 라우트가 503 노출
//     (프론트는 같은 경우 print-HTML을 웹에서 직접 print-to-pdf 하거나 오류 안내 — 조용한 실패 금지).
// - 세션 콘텐츠가 임시 HTML 파일로落地되지만 임시dir은 0700이고 즉시 삭제. (t_64af90b0 개인 면담 주의)
import { execFile } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean) as string[];

export interface PdfEngine {
  path: string;
  /** woff2 등 로컬 폰트를 @font-face로 주입해 한글 깨짐 방지 (서버 CJK 폰트 의존 회피). */
  fontCss?: string;
}

import { existsSync } from 'fs';
export function findPdfEngine(): PdfEngine | null {
  for (const path of CANDIDATES) {
    if (existsSync(path)) return { path };
  }
  return null;
}

/** HTML → PDF. 엔진 부재 시 PdfEngineMissing → 라우트가 503으로 매핑한다. */
export async function htmlToPdf(html: string, fontFaceCss = ''): Promise<Buffer> {
  const engine = findPdfEngine();
  if (!engine) throw new Error('PDF_ENGINE_MISSING');
  // 폰트 주입: <style> 마지막에 @font-face 삽입 (Pretendard woff2 file:// — 있으면 한글 원본 폰트)
  const doc = fontFaceCss ? html.replace('</style>', `${fontFaceCss}</style>`) : html;
  const dir = await mkdtemp(join(tmpdir(), 'mat-export-'));
  try {
    const src = join(dir, 'card.html');
    const out = join(dir, 'card.pdf');
    await writeFile(src, doc, { mode: 0o600 });
    await execFileAsync(engine.path, [
      '--headless', '--disable-gpu', '--no-sandbox',
      '--force-prefers-reduced-motion',
      '--no-pdf-header-footer',
      `--print-to-pdf=${out}`,
      `file://${src}`,
    ], { timeout: 30_000 });
    const { readFile } = await import('fs/promises');
    const pdf = await readFile(out);
    if (!pdf.subarray(0, 5).toString('latin1').startsWith('%PDF-')) throw new Error('PDF_OUTPUT_INVALID');
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
