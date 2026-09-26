// Wave 1 순수 로직 단위 테스트 — richtext / formLogic / chartLogic + 즐겨찾기 정규화
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRichText, extractLinks, isSafeLink, safePayloadLinks } from '../../src/lib/richtext';
import { buildFormResponsePayload, initialFormValues, parseFormSpec, validateFormValues } from '../../src/lib/formLogic';
import { chartToTableRows, parseChartSpec, toggleSeriesHidden } from '../../src/lib/chartLogic';
import { normalizeServerMessages } from '../../src/lib/chatLogic';
import { buildCardPreview } from '../../src/cards/preview';

// ── richtext ────────────────────────────────────────────
test('richtext — 마크다운 링크/URL 자동감지/인라인 코드/코드블록/인용 분리', () => {
  const segs = parseRichText('[문의](https://example.test/contact) 또는 https://a.test/x 에게 `npm i` 실행\n> 인용 문장');
  assert.deepEqual(segs.map((s) => s.kind), ['link', 'text', 'link', 'text', 'code', 'text', 'quote']);
  assert.equal(extractLinks(segs).length, 2);
  const code = parseRichText('```js\nconst a = 1;\n```\n설명');
  assert.deepEqual(code.map((s) => s.kind), ['codeblock', 'text']);
  assert.equal(code[0].text, 'const a = 1;');
});
test('richtext — 닫히지 않은 ```는 끝까지 코드블록, 악의 스킴은 텍스트 유지', () => {
  const open = parseRichText('앞\n```\nrm -rf /');
  assert.deepEqual(open.map((s) => s.kind), ['text', 'codeblock']);
  assert.equal(isSafeLink('javascript:alert(1)'), false);
  assert.equal(isSafeLink('https://ok.test'), true);
  const evil = parseRichText('[x](javascript:alert(1))');
  assert.deepEqual(evil.map((s) => s.kind), ['text']);
});
test('richtext — payload.links는 안전 URL+라벨만 통과', () => {
  const links = safePayloadLinks([{ label: '문서', url: 'https://docs.test' }, { label: '', url: 'https://x.test' }, { label: '나쁜', url: 'http://user:pass@x.test' }, 'bad', null]);
  assert.deepEqual(links, [{ label: '문서', url: 'https://docs.test' }]);
});

// ── formLogic ───────────────────────────────────────────
test('form — 스키마 파싱/결측 방어/duplicate id 제외', () => {
  const spec = parseFormSpec({ title: '견적', fields: [
    { id: 'a', type: 'text', label: '이름', required: true },
    { id: 'b', type: 'radio', label: '종류', options: ['x', 'y'], default: 'y' },
    { id: 'b', type: 'text', label: '중복' },
    { id: 'c', type: 'unknown', label: '미지원' },
  ] });
  assert.equal(spec?.title, '견적');
  assert.deepEqual(spec?.fields.map((f) => f.id), ['a', 'b']);
  assert.equal(spec?.fields[1].def, 'y');
  assert.equal(parseFormSpec({ fields: [] }), null);
  assert.equal(parseFormSpec(undefined), null);
});
test('form — 기본값/필수 검증/multi·select default 정합', () => {
  const spec = parseFormSpec({ fields: [
    { id: 'ok', type: 'checkbox', label: '동의', required: true },
    { id: 'tags', type: 'multi', label: '태그', options: ['a', 'b'], default: ['a', 'ghost'] },
    { id: 'pick', type: 'select', label: '선택', options: ['1', '2'], default: 'ghost' },
  ] })!;
  const init = initialFormValues(spec);
  assert.deepEqual(init, { ok: false, tags: ['a'], pick: '' });
  assert.deepEqual(validateFormValues(spec, init), ['ok']);
  assert.deepEqual(validateFormValues(spec, { ok: true, tags: [], pick: '1' }), []);
});
test('form — 제출 payload 계약 {type:form_response, form_id, values} + 빈값 제거', () => {
  const wire = buildFormResponsePayload('f1', { a: 'v', b: false, c: '', d: ['x'], e: true });
  assert.deepEqual(wire, { type: 'form_response', form_id: 'f1', values: { a: 'v', d: ['x'], e: true } });
});

// ── chartLogic ──────────────────────────────────────────
test('chart — series/labels 정규화, 비숫자 제외, scatter는 x 보존', () => {
  const spec = parseChartSpec({ chart_type: 'bar', labels: ['1월', '2월'], unit: '만원', title: '매출', series: [{ name: 'A', data: [10, 'oops', 30] }] })!;
  assert.equal(spec.chartType, 'bar');
  assert.deepEqual(spec.series[0].data, [{ x: '1월', y: 10 }, { x: 2, y: 30 }]); // 라벨 없는 3번째 값은 숫자 x
  assert.equal(parseChartSpec({ chart_type: 'donut', series: [{ data: [1] }] }), null);
  assert.equal(parseChartSpec({ chart_type: 'line', series: [] }), null);
});
test('chart — 시리즈 on/off 토글과 표 변환', () => {
  const spec = parseChartSpec({ chart_type: 'line', labels: ['a', 'b'], series: [{ name: 'S1', data: [1, 2] }, { name: 'S2', data: [3, 4] }] })!;
  const hidden = toggleSeriesHidden([], 'S1');
  assert.deepEqual(toggleSeriesHidden(hidden, 'S1'), []);
  const table = chartToTableRows(spec, hidden);
  assert.deepEqual(table.columns, ['label', 'S2']);
  assert.deepEqual(table.rows, [['a', 3], ['b', 4]]);
});

// ── 즐겨찾기 영속화 + Wave1 프리뷰 규칙 ─────────────────
test('normalizeServerMessages — favorite boolean 보존/그 외는 undefined', () => {
  const [on, off] = normalizeServerMessages([
    { id: 'a', role: 'agent', content: 'x', turn_index: 1, favorite: true },
    { id: 'b', role: 'agent', content: 'y', turn_index: 2, favorite: 'yes' },
  ]);
  assert.equal(on.favorite, true);
  assert.equal(off.favorite, undefined);
});
test('프리뷰 Wave1 — form 필드 수 배지 / chart 시리즈 배지 / media 안전 URL만 펼침', () => {
  const form = buildCardPreview('form', { fields: [{ id: 'a', type: 'text', label: 'A' }, { id: 'b', type: 'checkbox', label: 'B' }] }, '', true);
  assert.equal(form.badge, '2');
  assert.equal(form.expandable, true);
  const chart = buildCardPreview('chart', { labels: ['1', '2', '3'], series: [{ name: 'S1', data: [1, 2, 3] }] }, '', true);
  assert.equal(chart.badge, 'S1');
  assert.equal(chart.moreCount, 1);
  const media = buildCardPreview('media', { media_type: 'video', url: 'https://cdn.test/v.mp4', caption: '영상' }, '', true);
  assert.equal(media.badge, '▶');
  assert.equal(media.expandable, true);
  const unsafe = buildCardPreview('media', { media_type: 'image', url: 'javascript:x' }, '', true);
  assert.equal(unsafe.expandable, false);
});
