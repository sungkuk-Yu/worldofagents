// useAttachments — 입력창 첨부 스테이지 훅 (t_4497cfce P1-2)
// 사진 선택(expo-image-picker) → api.upload(백엔드 검증: 20MB/image·pdf/일 50) → 전송 대기 칩 목록.
// 실패는 서버 error.code를 errors.{snake→camel} 키로 매핑해 행 단위 노출(재시도 가능).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api, UploadError, UploadResult } from '../lib/api';

export const MAX_ATTACHMENTS = 10; // 백엔드 parseAttachmentIds(max=10)과 동일 상한

export interface AttachmentDraft {
  localId: string;
  name: string;
  uri: string;        // 업로드 성공 = 서버 URL / 실패 = 로컬 uri(재시도용)
  localUri: string;   // 편집기가 쓸 로컬 원본 (서버 URL은 웹 캔버스 CORS 오염 위험)
  type: string;
  status: 'uploading' | 'done' | 'error';
  errorKey?: string;
  result?: UploadResult;
}

/** UploadError.code(FILE_TOO_LARGE 등) → i18n 키 (api.upload 주석의 errors.{lower} 규칙). */
export const UPLOAD_ERROR_KEYS: Record<string, string> = {
  FILE_TOO_LARGE: 'errors.fileTooLarge',
  UNSUPPORTED_MEDIA_TYPE: 'errors.unsupportedMediaType',
  UPLOAD_QUOTA_EXCEEDED: 'errors.uploadQuotaExceeded',
  AUTH_REQUIRED: 'errors.auth',
};
export const uploadErrorKey = (e: unknown): string =>
  e instanceof UploadError ? (UPLOAD_ERROR_KEYS[e.code] ?? 'errors.uploadFailed') : 'errors.uploadFailed';

let counter = 0;

export function useAttachments() {
  const [items, setItems] = useState<AttachmentDraft[]>([]);
  const itemsRef = useRef<AttachmentDraft[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const patch = useCallback((localId: string, next: Partial<AttachmentDraft>) => {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...next } : it)));
  }, []);

  const uploadOne = useCallback(async (draft: AttachmentDraft) => {
    patch(draft.localId, { status: 'uploading', errorKey: undefined });
    try {
      const source = Platform.OS === 'web' && typeof fetch === 'function' && draft.uri.startsWith('blob:')
        ? await (await fetch(draft.uri)).blob()
        : { uri: draft.uri, name: draft.name, type: draft.type };
      const result = await api.upload(source as never, draft.name);
      patch(draft.localId, { status: 'done', result, uri: result.url });
    } catch (e) {
      patch(draft.localId, { status: 'error', errorKey: uploadErrorKey(e) });
    }
  }, [patch]);

  /** 업로드할 파일 1개 추가 (선택 즉시 업로드 시작 — 전송 시 대기 시간 최소화). 반환: localId. */
  const add = useCallback(async (file: { uri: string; name?: string; type?: string }): Promise<string> => {
    if (itemsRef.current.length >= MAX_ATTACHMENTS) return '';
    const draft: AttachmentDraft = {
      localId: `att-${Date.now()}-${++counter}`,
      name: file.name || 'photo.jpg',
      uri: file.uri,
      localUri: file.uri,
      type: file.type || 'image/jpeg',
      status: 'uploading',
    };
    setItems((prev) => [...prev, draft]);
    void uploadOne(draft);
    return draft.localId;
  }, [uploadOne]);

  const remove = useCallback((localId: string) => setItems((prev) => prev.filter((it) => it.localId !== localId)), []);
  const retry = useCallback((localId: string) => {
    const it = itemsRef.current.find((x) => x.localId === localId);
    if (it && it.status === 'error') void uploadOne(it);
  }, [uploadOne]);
  const clear = useCallback(() => setItems([]), []);

  /** 전송 가능한 상태인가 (업로드 중/오류 행 혼입 방지). */
  const ready = items.every((it) => it.status === 'done');
  const uploading = items.some((it) => it.status === 'uploading');
  const ids = () => items.filter((it) => it.status === 'done').map((it) => it.result!.id);

  return { items, add, remove, retry, clear, ready, uploading, ids, count: items.length };
}

export type AttachmentsApi = ReturnType<typeof useAttachments>;
