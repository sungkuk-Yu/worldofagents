// Wave 2 사진편집/피드 순수 로직 단위 테스트 (t_4497cfce)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCrop, dragCrop, cropToPixels, presetRatio, sanitizeAnnotations,
  buildEditMessage, normalizeAttachments, containBox, cropRectOnContain,
  parsePhotoEditPayload, toFeedPost, filterFeedPosts, isVideoUrl, MIN_CROP,
} from '../../src/lib/photoLogic';

test('crop — clampCrop: 0~1 클램프 + 범위 내 크기', () => {
  assert.deepEqual(clampCrop({ x: -0.5, y: 2, w: 5, h: -1 }), { x: 0, y: 1, w: 1, h: 0 });
  const r = clampCrop({ x: 0.2, y: 0.1, w: 0.5, h: 0.5 });
  assert.ok(r.x + r.w <= 1 && r.y + r.h <= 1);
});
test('crop — clampCrop 비율: w:h=ratio 유지 + 범위 클램프', () => {
  const r = clampCrop({ x: 0, y: 0, w: 1, h: 1 }, 1); // 정사각
  assert.ok(Math.abs(r.w - r.h) < 1e-6, 'ratio=1 → w==h');
  const wide = clampCrop({ x: 0, y: 0, w: 1, h: 1 }, presetRatio('16:9')!);
  assert.ok(wide.y + wide.h <= 1 && wide.x + wide.w <= 1);
});
test('crop — dragCrop: move는 평행이동, se 핸들은 대각점(x,y) 고정', () => {
  const m = dragCrop({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'move', 0.1, -0.05);
  assert.deepEqual(m, { x: 0.3, y: 0.15, w: 0.4, h: 0.4 });
  const se = dragCrop({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'se', 0.1, 0.1);
  assert.equal(se.x, 0.2); assert.equal(se.y, 0.2); // 고정 대각점
  assert.ok(Math.abs(se.w - 0.5) < 1e-6);
  // 반대편을 지나친 드래그 → 대각 뒤집힘 방지(min/abs)
  const flip = dragCrop({ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, 'nw', 0.4, 0.4);
  assert.ok(flip.x <= 0.7 && flip.y <= 0.7 && flip.w >= MIN_CROP);
});
test('crop — cropToPixels: 정규화 → 원본 픽셀', () => {
  const p = cropToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { width: 200, height: 100 });
  assert.equal(p.sx, 50); assert.equal(p.sy, 50); assert.equal(p.sw, 100); assert.equal(p.sh, 25);
});
test('주석 — sanitizeAnnotations: 범위 클램프·타입 필터·to 없는 arrow 제거', () => {
  const out = sanitizeAnnotations([
    { type: 'arrow', from: { x: 0.5, y: 0.5 }, to: { x: 2, y: -1 } },
    { type: 'pin', from: { x: -0.2, y: 0.1 } },
    { type: 'text', from: { x: 0.3, y: 0.3 }, note: '  메모  ' },
    { type: 'bogus', from: { x: 0, y: 0 } },
    { type: 'arrow', from: { x: 0.1, y: 0.1 } },
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0].to, { x: 1, y: 0 });
  assert.deepEqual(out[1].from, { x: 0, y: 0.1 });
  assert.equal(out[2].note, '메모');
  assert.deepEqual(sanitizeAnnotations('nope'), []);
});
test('지시문 — buildEditMessage: 사람 요약 + JSON 펜스(photo_edit) 포함', () => {
  const text = buildEditMessage({ crop: { x: 0.1, y: 0, w: 0.8, h: 0.5 }, annotations: [{ type: 'pin', from: { x: 0.5, y: 0.5 } }], caption: '여기 강조해줘', editOf: 'msg-1' });
  assert.ok(text.includes('여기 강조해줘'));
  assert.ok(text.includes('```json'));
  const fence = JSON.parse((text.match(/```json\n([\s\S]*?)\n```/) ?? [])[1]);
  assert.equal(fence.photo_edit.edit_of, 'msg-1');
  assert.equal(fence.photo_edit.annotations.length, 1);
});
test('첨부 정규화 — messages.attachments JSONB 독해 + 이상 행 제거', () => {
  const out = normalizeAttachments([
    { id: '1', url: 'https://x/a.png', mime: 'image/png', size: 10, name: 'a.png' },
    { id: '2', url: 'ftp://nope', mime: 'image/png', size: 1 },
    { id: '', url: 'https://x/b', mime: 'application/pdf', size: 2, name: null },
    'junk',
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '1');
  assert.deepEqual(normalizeAttachments(undefined), []);
});
test('photo_edit payload 정규화 — crop_pct/원본·편집본 URL, 전체 크롭=편집 없음', () => {
  const p = parsePhotoEditPayload({ photo_edit: { crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, annotations: [{ type: 'pin', from: { x: 0.2, y: 0.2 } }], original_url: 'https://x/o.png', edited_url: 'https://x/e.png', edit_of: 'm1', caption: '캡션' } });
  assert.equal(p.crop!.w, 0.5);
  assert.equal(p.originalUrl, 'https://x/o.png');
  assert.equal(p.editedUrl, 'https://x/e.png');
  assert.equal(p.annotations.length, 1);
  const full = parsePhotoEditPayload({ crop: { x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(full.crop, null);
});
test('containBox / cropRectOnContain — 정규화 → 표시 px', () => {
  const b = containBox(200, 100, 100, 100); // 세로 이미지 → 폭 기준으로 축소
  assert.equal(b.w, 100); assert.equal(b.h, 100); assert.equal(b.ox, 50);
  const r = cropRectOnContain({ x: 0.5, y: 0, w: 0.5, h: 1 }, 200, 100, { width: 100, height: 100 });
  assert.equal(r.left, 100); assert.equal(r.width, 50);
});
test('피드 사영 — toFeedPost: media/photo_edit/카드 텍스트, 빈 행 제외, form_response 스냅샷 금지', () => {
  const media = toFeedPost({ message: { id: 'm1', dialogue_type: 'media', structured_payload: { media_type: 'image', url: 'https://x/img.png', caption: '사진' } }, session: { id: 's1', title: 'T', agent_name: 'A' } })!;
  assert.equal(media.kind, 'media');
  assert.deepEqual(media.mediaUrls, ['https://x/img.png']);
  assert.equal(media.sessionId, 's1');
  const card = toFeedPost({ message: { id: 'm2', dialogue_type: 'text', content: '요약 카드', attachments: [{ id: 'a', url: 'https://x/a.png', mime: 'image/png', size: 1, name: 'a.png' }] }, session: { id: 's2' } })!;
  assert.equal(card.kind, 'card');
  assert.ok(card.mediaUrls.includes('https://x/a.png'));
  assert.equal(toFeedPost({ message: { id: 'm3', dialogue_type: 'text', content: '', attachments: [] }, session: {} }), null);
  const form = toFeedPost({ message: { id: 'm4', dialogue_type: 'form_response', content: '견적 응답', structured_payload: { form_id: 'q1', response: { name: '홍길동' } } }, session: {} })!;
  assert.equal(form.canSnapshot, false);
  assert.deepEqual(filterFeedPosts([media, card, form], 'photo'), []);
  assert.deepEqual(filterFeedPosts([media, card], 'media').map((x) => x.messageId), ['m1', 'm2']);
  assert.equal(isVideoUrl('https://x/a.mp4'), true);
  assert.equal(isVideoUrl('https://x/a.png'), false);
});
