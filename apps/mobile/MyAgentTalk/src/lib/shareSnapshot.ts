// 외부 공유 스냅샷 (t_4497cfce P0-2 §2) — 카드 내용만 이미지로 내보낸다.
// 개인정보 규칙: 세션 컨텍스트(세션 제목·에이전트명) 절대 포함 금지 — media+caption만 합성.
// 웹: canvas 합성 캡처 → navigator.share(files) 지원 시 공유 시트, 아니면 다운로드 폴백.
// RN:expo-file-system 다운로드 → expo-sharing.shareAsync (미디어 있는 카드만; pure-text 캐리는 카드 캡처 합성 불가 → 미지원 안내).
import { Platform } from 'react-native';
import { loadHtmlImage, saveBlobWeb } from './photoCapture';

export interface SnapshotInput {
  mediaUrls: string[];
  caption: string;
}

const W = 1080;
const PAD = 48;
const CAPTION_H = 220;

/** 웹: 캐리지 이미지 1장 + 캡션 밴드 → PNG blob. 실패 시 null. */
async function buildSnapshotWeb(input: SnapshotInput): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const imgs = (await Promise.all(input.mediaUrls.slice(0, 1).map((u) => loadHtmlImage(u).catch(() => null)))).filter((i): i is HTMLImageElement => !!i);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = imgs[0] ?? null;
  const imgH = img ? Math.round((W - PAD * 2) * (img.naturalHeight / Math.max(1, img.naturalWidth))) : 0;
  const text = (input.caption || '').slice(0, 240);
  const h = (img ? PAD + imgH : 0) + (text ? CAPTION_H : PAD) + (img ? PAD / 2 : 0);
  canvas.width = W;
  canvas.height = Math.max(640, h);
  ctx.fillStyle = '#0b0b0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = PAD;
  if (img) {
    const iw = W - PAD * 2;
    ctx.drawImage(img, PAD, y, iw, imgH);
    y += imgH + PAD;
  }
  if (text) {
    ctx.fillStyle = '#e8e8ee';
    ctx.font = '600 44px Inter, system-ui, sans-serif';
    const words = text.split(/\s+/);
    let line = '';
    let ty = y + 44;
    for (const w of words) {
      if (ctx.measureText(line + w).width > W - PAD * 2) {
        ctx.fillText(line, PAD, ty);
        line = w + ' ';
        ty += 60;
        if (ty > canvas.height - 20) break;
      } else line += w + ' ';
    }
    if (ty <= canvas.height - 20) ctx.fillText(line, PAD, ty);
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * 공유 스냅샷 내보내기.
 * @returns 'shared'=공유 시트 열림 / 'downloaded'=웹 다운로드 폴백 / 'unsupported'=불가(메시지 표시용)
 */
export async function shareSnapshot(input: SnapshotInput): Promise<'shared' | 'downloaded' | 'unsupported'> {
  if (!input.mediaUrls.length && !input.caption.trim()) return 'unsupported';
  if (Platform.OS === 'web') {
    const blob = await buildSnapshotWeb(input).catch(() => null);
    if (!blob) return 'unsupported';
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const file = new File([blob], 'share-card.png', { type: 'image/png' });
    if (nav && typeof (nav as Navigator).share === 'function' && typeof File !== 'undefined') {
      try {
        await (nav as Navigator).share({ files: [file], title: 'AgentTalk' });
        return 'shared';
      } catch {
        /* 사용자가 취소/미지원 → 다운로드 폴백 */
      }
    }
    saveBlobWeb(blob, 'share-card.png');
    return 'downloaded';
  }
  // RN: 미디어 있는 카드만 (expo-file-system + expo-sharing). 텍스트 합성은 expo-gl/CaptureView 필요 → 후속.
  const url = input.mediaUrls[0];
  if (!url || !/^https?:/i.test(url)) return 'unsupported';
  try {
    const { File, Paths } = await import('expo-file-system');
    const Sharing = (await import('expo-sharing')).default;
    if (!(await Sharing.isAvailableAsync())) return 'unsupported';
    const dest = new File(Paths.cache, 'share-card.png');
    const res = await File.downloadFileAsync(url, dest);
    if (!res || !dest.exists) return 'unsupported';
    await Sharing.shareAsync(dest.uri, { mimeType: 'image/png' });
    return 'shared';
  } catch {
    return 'unsupported';
  }
}
