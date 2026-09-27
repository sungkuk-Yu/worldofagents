// 카드 내보내기 포맷터 (t_3116c5bc) — ExportDocument → md/html/docx/xlsx/json/PDF(HTML 래퍼).
// OOXML은 최소 스키마: Word/Excel가 요구하는 parts만 담는다 (docx: document+styles 불요,
// xlsx: workbook+sheet+sharedStrings 없이 inlineStr 사용). 검증은 라운드트립 테스트 + python zipfile.
import { createZip } from './zip';
import type { ExportBlock, ExportDocument, ExportMessage } from './exportDoc';

export const xmlEscape = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** 제어문자 제거 (XML 1.0 비허용 문자 — 붙여넣기等内容 방어). */
const sanitize = (value: string): string => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const label = (msg: ExportMessage): string =>
  msg.role === 'agent' ? 'Assistant' : msg.role === 'user' ? 'User' : 'System';

const blockToText = (block: ExportBlock): string => {
  switch (block.kind) {
    case 'heading': return block.text;
    case 'paragraph': return block.text;
    case 'list': return block.items.map((i) => `- ${i}`).join('\n');
    case 'code': return block.text;
    case 'table': {
      const head = `| ${block.columns.join(' | ')} |`;
      const sep = `| ${block.columns.map(() => '---').join(' | ')} |`;
      return [head, sep, ...block.rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
    }
  }
};

// ── Markdown ───────────────────────────────────────────────
export function renderMarkdown(doc: ExportDocument, titleSuffix = ''): string {
  const lines: string[] = [`# ${doc.title}`, ``, `> ${doc.exportedAt}${doc.favoritesOnly ? ' · 즐겨찾기한 카드만' : ''}`];
  for (const msg of doc.messages) {
    lines.push('', `## ${label(msg)}${msg.aiGenerated ? ' ✦ AI' : ''}`);
    for (const block of msg.blocks) {
      const text = blockToText(block);
      if (!text) continue;
      if (block.kind === 'heading') lines.push('', `### ${text}`);
      else if (block.kind === 'code') lines.push('', '```', text, '```');
      else lines.push('', text);
    }
  }
  return lines.join('\n') + '\n';
}

// ── HTML (브라우저 표시용 + PDF 렌더 소스) ──────────────────
export function renderHtml(doc: ExportDocument, opts: { print?: boolean } = {}): string {
  const esc = (v: string) => xmlEscape(sanitize(v));
  const blockHtml = (b: ExportBlock): string => {
    switch (b.kind) {
      case 'heading': return `<h3>${esc(b.text)}</h3>`;
      case 'paragraph': return `<p>${esc(b.text)}</p>`;
      case 'list': return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
      case 'code': return `<pre>${esc(b.text)}</pre>`;
      case 'table': return `<table><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
  };
  const body = doc.messages.map((m) =>
    `<section class="msg msg-${m.role}"><header><span class="who">${esc(label(m))}</span>${m.aiGenerated ? '<span class="ai">AI</span>' : ''}<time>${esc(m.time)}</time></header>${m.blocks.map(blockHtml).join('\n')}</section>`).join('\n');
  // PDF(print)는 headless chrome --print-to-pdf 사용 — @page A4. 한글 폰트: 시스템 CJK 폰트 스택
  // (서버에 폰트 없으면 PDF에서 깨짐 — exportPdf가 --font-render-hinting 로드 전 확인, 필요 시
  //  Pretendard woff2를 file:// 주입). 화면용은 앱 디자인 토큰 계열 유지.
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
:root{--ink:#171717;--body:#4d4d4d;--line:#e5e7eb;--accent:#0068d6}
*{box-sizing:border-box}body{margin:0 auto;padding:32px 24px;max-width:760px;color:var(--body);font-family:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",sans-serif;font-size:15px;line-height:1.6;word-break:keep-all}
h1{color:var(--ink);font-size:24px;margin:0 0 4px}h2{font-size:16px}h3{color:var(--ink);font-size:15px;margin:12px 0 6px}
.meta{color:#9ca3af;font-size:12px;margin-bottom:24px}
section.msg{border-top:1px solid var(--line);padding:16px 0}
section.msg header{display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:12px;color:var(--ink)}
section.msg .who{font-weight:600}section.msg .ai{border:1px solid var(--accent);color:var(--accent);border-radius:4px;padding:0 5px;font-weight:600}
section.msg time{color:#9ca3af;margin-left:auto}
p{margin:6px 0}ul{margin:6px 0;padding-left:20px}pre{background:#f6f7f9;border-radius:6px;padding:12px;overflow:auto;font-size:13px}
table{border-collapse:collapse;margin:10px 0;font-size:13px}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}th{background:#fafafa;color:var(--ink)}
${opts.print ? '@page{size:A4;margin:18mm 16mm}body{padding:0;max-width:none;font-size:12.5px}section.msg{break-inside:avoid-page}' : ''}
</style></head><body>
<h1>${esc(doc.title)}</h1><p class="meta">${esc(doc.exportedAt)} · ${doc.messageCount}개 카드${doc.favoritesOnly ? ' · 즐겨찾기한 카드만' : ''}</p>
${body}
</body></html>`;
}

// ── JSON (원본 필드 보존 — 재가공/백업용) ───────────────────
export function renderJson(doc: ExportDocument): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

// ── DOCX (OOXML word/document.xml) ─────────────────────────
const wRun = (text: string, bold = false): string =>
  `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEscape(sanitize(text))}</w:t></w:r>`;
const wPara = (text: string, style?: 'h1' | 'h2' | 'meta'): string => {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}${wRun(text, style !== undefined)}</w:p>`;
};

export function renderDocx(doc: ExportDocument): Buffer {
  const parts: string[] = [wPara(doc.title, 'h1'), wPara(`${doc.exportedAt} · ${doc.messageCount} cards${doc.favoritesOnly ? ' · favorites only' : ''}`, 'meta')];
  for (const m of doc.messages) {
    parts.push(wPara(`${label(m)}${m.aiGenerated ? ' · AI' : ''}`, 'h2'));
    for (const b of m.blocks) {
      if (b.kind === 'table') {
        const rowXml = (cells: string[], header: boolean) =>
          `<w:tr>${cells.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${wPara(c, header ? 'h2' : undefined)}</w:tc>`).join('')}</w:tr>`;
        parts.push(`<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideV w:val="single" w:sz="4" w:color="D1D5DB"/></w:tblBorders></w:tblPr>${rowXml(b.columns, true)}${b.rows.map((r) => rowXml(r, false)).join('')}</w:tbl>`);
      } else {
        for (const line of blockToText(b).split('\n')) if (line.trim()) parts.push(wPara(line));
      }
    }
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Malgun Gothic"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="h1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="h2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="6B7280"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`;
  return createZip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
  ]);
}

// ── XLSX (inlineStr 스프레드시트 — sharedStrings 불요) ──────
const colName = (index: number): string => {
  let n = index + 1; let out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
};
const xCell = (row: number, col: number, value: string): string =>
  `<c r="${colName(col)}${row}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(sanitize(value))}</t></is></c>`;
const xRow = (row: number, values: string[]): string =>
  `<row r="${row}">${values.map((v, i) => xCell(row, i, v)).join('')}</row>`;

export function renderXlsx(doc: ExportDocument): Buffer {
  // 시트 구성: 1) 대화 전체(시간/발신자/AI/유형/본문) 2) 표 블록마다 데이터 시트
  const sheets: { name: string; rows: string[][] }[] = [];
  const convo: string[][] = [['Time', 'From', 'AI', 'Type', 'Content']];
  for (const m of doc.messages) {
    convo.push([m.time, label(m), m.aiGenerated ? 'yes' : '', m.dialogueType, blockToText({ kind: 'list', items: m.blocks.map(blockToText) }).replace(/^- /gm, '').replace(/\n/g, ' ⏎ ')]);
  }
  sheets.push({ name: 'Conversation', rows: convo });
  let tableIdx = 0;
  for (const m of doc.messages) {
    for (const b of m.blocks) {
      if (b.kind === 'table') {
        tableIdx += 1;
        sheets.push({ name: `Table${tableIdx}`, rows: [b.columns, ...b.rows] });
      }
    }
  }
  const usedNames = new Set<string>();
  const safeName = (n: string): string => {
    let base = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    let out = base; let k = 2;
    while (usedNames.has(out)) out = `${base.slice(0, 28)}${k++}`;
    usedNames.add(out); return out;
  };
  const names = sheets.map((s) => safeName(s.name));
  const sheetXmls = sheets.map((s) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.rows.map((r, i) => xRow(i + 1, r)).join('')}</sheetData></worksheet>`);
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
  const overrides = names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return createZip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/workbook.xml', data: workbook },
    ...sheetXmls.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data })),
  ]);
}
