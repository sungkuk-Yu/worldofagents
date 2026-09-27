// 카드 내보내기 클라이언트 로직 (t_3116c5bc) — 순수 함수 + 플랫폼 저장 분기.
// 서식 메뉴 정의(라벨 키/확장자)와 백엔드 URL 빌드는 여기서, 실제 저장은 downloadExport가
// web=Blob 저장(a.download), RN=expo-file-system+expo-sharing(없으면 미지원 안내)으로 분기한다.
// 백엔드 계약: GET /api/messages/:id/export?fmt=pdf|docx|xlsx|hwp — 400/503은 JSON 에러 래퍼.
// 파일명: 서버 Content-Disposition(filename*=UTF-8) 우선 — {세션제목}_{카드요약} 규칙은 서버 소유.
import { Platform } from 'react-native';
import { getApiConfig, initializeApi } from './api';

export type ExportFormat = 'pdf' | 'docx' | 'xlsx' | 'hwp';
export const EXPORT_FORMATS: ExportFormat[] = ['pdf', 'docx', 'xlsx', 'hwp'];

/** 표 카드(스프레드시트·차트)만 xlsx 활성 — 백엔드 400과 동일 게이트로 메뉴에서 비활성화. */
export const isTableDialogue = (dialogueType?: string | null): boolean =>
  dialogueType === 'spreadsheet' || dialogueType === 'chart';

export const formatDisabled = (fmt: ExportFormat, dialogueType?: string | null): boolean =>
  fmt === 'xlsx' && !isTableDialogue(dialogueType);

/** hwp는 .docx 바이트로 서빙(서버 정직 폴백) — 클라 폴백명도 docx로 맞춘다. */
export const formatExt = (fmt: ExportFormat): string => (fmt === 'hwp' ? 'docx' : fmt);

/** 서버 헤더 결측 시 클라이언트 폴백명 — 백엔드 safeName 규칙과 동일 좌표. */
export function exportDownloadFilename(title: string, messageId: string, fmt: ExportFormat): string {
  const safe = (title || 'card').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48).replace(/\.+$/, '') || 'card';
  return `${safe}_${messageId.slice(0, 8)}_${fmt}.${formatExt(fmt)}`;
}

/** Content-Disposition에서 filename*(UTF-8) → filename(ASCII) 순으로 추출. */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* fallthrough */ } }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

export function exportUrl(messageId: string, fmt: ExportFormat): string {
  const { apiUrl } = getApiConfig();
  return `${apiUrl}/api/messages/${encodeURIComponent(messageId)}/export?fmt=${fmt}`;
}

/** 백엔드 fetch(인증 헤더) → 성공 시 Blob+서버 파일명, 에러 시 서버 message 코드 매핑 키. */
async function fetchExportBlob(messageId: string, fmt: ExportFormat): Promise<{ blob?: Blob; filename?: string | null; errorKey?: string }> {
  await initializeApi().catch(() => undefined);
  const { apiUrl, token } = getApiConfig();
  try {
    const headers: Record<string, string> = token ? { Authorization: ['Bearer', token].join(' ') } : {};
    const res = await fetch(`${apiUrl}/api/messages/${encodeURIComponent(messageId)}/export?fmt=${fmt}`, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const code = body?.error?.code;
      if (code === 'EXPORT_FORMAT_UNSUPPORTED') return { errorKey: 'exporter.unsupported' };
      if (code === 'EXPORT_PDF_ENGINE_MISSING') return { errorKey: 'exporter.pdfMissing' };
      return { errorKey: 'exporter.failed' };
    }
    return { blob: await res.blob(), filename: filenameFromDisposition(res.headers.get('content-disposition')) };
  } catch {
    return { errorKey: 'exporter.offline' };
  }
}

export interface ExportSaveResult { ok: boolean; errorKey?: string; filename?: string }

/**
 * 내보내기 실행 + 저장.
 * web: Blob → objectURL → a.download.
 * RN: expo-file-system writeBytes(캐시) → expo-sharing.shareAsync (시스템 공유 시트가 저장 경로).
 */
export async function downloadExport(messageId: string, title: string, fmt: ExportFormat): Promise<ExportSaveResult> {
  const { blob, filename, errorKey } = await fetchExportBlob(messageId, fmt);
  if (!blob) return { ok: false, errorKey: errorKey ?? 'exporter.failed' };
  const name = filename || exportDownloadFilename(title, messageId, fmt);
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return { ok: false, errorKey: 'exporter.failed' };
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true, filename: name };
  }
  try {
    const { File, Paths } = await import('expo-file-system');
    const Sharing = (await import('expo-sharing')).default;
    if (!(await Sharing.isAvailableAsync())) return { ok: false, errorKey: 'exporter.unsupported' };
    const data = new Uint8Array(await blob.arrayBuffer());
    const dest = new File(Paths.cache, name);
    if (dest.exists) dest.delete();
    dest.write(data); // NativeFileSystemFile.write(content: string|Uint8Array) — 캐시 저장 후 시스템 공유 시트
    await Sharing.shareAsync(dest.uri, { mimeType: blob.type || 'application/octet-stream', dialogTitle: name });
    return { ok: true, filename: name };
  } catch {
    return { ok: false, errorKey: 'exporter.failed' };
  }
}
