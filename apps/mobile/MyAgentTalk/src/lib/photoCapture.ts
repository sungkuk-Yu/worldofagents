// 사진 편집 내보내기 (t_4497cfce) — web: canvas 합성(크롭+주석 굽기) / RN: expo-image-manipulator 크롭.
// 기성 라이브러리 우선 규칙: crop은 manipulator, 합성은 웹만 canvas 직접(카드 §1 예외 허용 범위).
import { Platform } from 'react-native';
import type { CropRect, PhotoAnnotation } from './photoLogic';
import { cropToPixels } from './photoLogic';

export interface EditSource { uri: string; width: number; height: number }

const ACCENT = '#E11D48';

/** 주석 리스트를 2D 컨텍스트에 굽는다 (크롭 영역 로컬 좌표 변환 포함). */
export function drawAnnotations(ctx: CanvasRenderingContext2D, list: PhotoAnnotation[], crop: CropRect, out: { w: number; h: number }) {
  const to = (p: { x: number; y: number }) => ({
    x: ((p.x - crop.x) / (crop.w || 1)) * out.w,
    y: ((p.y - crop.y) / (crop.h || 1)) * out.h,
  });
  ctx.lineWidth = Math.max(2, Math.round(out.w / 240));
  ctx.strokeStyle = ACCENT; ctx.fillStyle = ACCENT; ctx.font = `600 ${Math.max(12, Math.round(out.w / 30))}px sans-serif`;
  for (const a of list) {
    const from = to(a.from);
    if (a.type === 'pin') {
      ctx.beginPath(); ctx.arc(from.x, from.y, ctx.lineWidth * 3, 0, Math.PI * 2); ctx.fill();
    } else if (a.type === 'arrow' && a.to) {
      const t = to(a.to);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      const ang = Math.atan2(t.y - from.y, t.x - from.x); const head = ctx.lineWidth * 5;
      ctx.beginPath(); ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x - head * Math.cos(ang - 0.5), t.y - head * Math.sin(ang - 0.5));
      ctx.lineTo(t.x - head * Math.cos(ang + 0.5), t.y - head * Math.sin(ang + 0.5));
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(from.x, from.y, ctx.lineWidth * 2.5, 0, Math.PI * 2); ctx.fill();
    }
    if (a.note) {
      const tw = ctx.measureText(a.note).width;
      ctx.fillStyle = 'rgba(225,29,72,0.92)';
      ctx.fillRect(from.x + 6, from.y - 10, tw + 10, 22);
      ctx.fillStyle = '#FFFFFF'; ctx.fillText(a.note, from.x + 11, from.y + 6);
      ctx.fillStyle = ACCENT;
    }
  }
}

const loadHtmlImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous'; // capability URL/공개 버킷 — CORS 허용 시에만 합성 가능
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('errors.photoLoad'));
  img.src = src;
});
export { loadHtmlImage };

/** 웹: 크롭+주석을 PNG Blob으로 굽는다. 실패(CORS 등) 시 throw → 호출측이 원본 첨부로 폴백. */
export async function renderEditBlobWeb(src: string, crop: CropRect, annotations: PhotoAnnotation[]): Promise<{ blob: Blob; width: number; height: number }> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') throw new Error('errors.unavailableAction');
  const img = await loadHtmlImage(src);
  const natural = { width: img.naturalWidth, height: img.naturalHeight };
  const p = cropToPixels(crop, natural);
  const canvas = document.createElement('canvas');
  canvas.width = p.sw; canvas.height = p.sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('errors.photoLoad');
  ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, 0, 0, p.sw, p.sh);
  drawAnnotations(ctx, annotations, crop, { w: p.sw, h: p.sh });
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('errors.photoLoad');
  return { blob, width: p.sw, height: p.sh };
}

/** 웹: Blob을 파일로 저장(a.download). */
export function saveBlobWeb(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** RN: expo-image-manipulator로 크롭(주석 굽기 미지원 → 지시는 텍스트 페이로드로 전송). manipulateAsync는 전 플랫폼 지원. */
export async function cropImageRn(src: EditSource, crop: CropRect): Promise<string> {
  const { manipulateAsync } = await import('expo-image-manipulator');
  const p = cropToPixels(crop, { width: src.width, height: src.height });
  const res = await manipulateAsync(src.uri, [{ crop: { originX: p.sx, originY: p.sy, width: p.sw, height: p.sh } }], { compress: 0.92, format: 'jpeg' as never });
  return res.uri;
}

/** RN: 이미지 파일을 기기에 저장 (expo-media-library). */
export async function saveToLibraryRn(uri: string): Promise<void> {
  const MediaLibrary = await import('expo-media-library');
  const granted = await MediaLibrary.requestPermissionsAsync();
  if (!granted.granted) throw new Error('errors.saveDenied');
  await MediaLibrary.saveToLibraryAsync(uri);
}

export const downloadBlob = (blob: Blob, filename = 'edited.png'): void => saveBlobWeb(blob, filename);

/** 웹: 원거리 URL 첨부 저장 — fetch→blob 실패(CORS) 시 새 탭 폴백. */
export async function downloadUrlWeb(url: string, filename = 'media'): Promise<void> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const ext = (url.match(/\.(png|jpe?g|gif|webp|mp4|mov)/i) ?? [])[1] || 'png';
    saveBlobWeb(blob, `${filename}.${ext}`);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
