// 이미지 선택 — 네이티브: expo-image-picker / 웹: hidden <input type=file accept=image/*>
// (expo-image-picker는 SDK 57 웹에서 비지원 — AGENTS.md 규칙에 따라 문서 확인 후 웹 폴백 직접 구현)
import { Platform } from 'react-native';

export interface PickedImage { uri: string; name: string; type: string; width?: number; height?: number }

async function pickWeb(max: number): Promise<PickedImage[]> {
  if (typeof document === 'undefined') return [];
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (max > 1) input.multiple = true;
    input.style.display = 'none';
    input.onchange = () => {
      const files = Array.from(input.files ?? []).slice(0, max);
      input.remove();
      resolve(files.map((f) => ({ uri: URL.createObjectURL(f), name: f.name || 'photo.jpg', type: f.type || 'image/jpeg' })));
    };
    // 취소(empty change 이벤트 없음)는 resolve 안 함 — 호출측이 상태 유지.
    document.body.appendChild(input);
    input.click();
  });
}

export async function pickImages(max = 1): Promise<PickedImage[]> {
  if (Platform.OS === 'web') return pickWeb(max);
  const ImagePicker = await import('expo-image-picker');
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('errors.photoPermDenied');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: max > 1, selectionLimit: max, quality: 0.9,
  });
  if (res.canceled) return [];
  return res.assets.slice(0, max).map((a) => ({ uri: a.uri, name: a.fileName || a.uri.split('/').pop() || 'photo.jpg', type: a.mimeType || 'image/jpeg', width: a.width, height: a.height }));
}

/** 이미지 URL/uri의 자연 크기 (편집기 좌표계 필요). 실패 시 0 — 호출측 폴백. */
export async function measureImage(uri: string): Promise<{ width: number; height: number }> {
  if (Platform.OS === 'web' && typeof Image !== 'undefined') {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = uri;
    });
  }
  try {
    const { Image: RNImage } = await import('react-native');
    const s = RNImage.resolveAssetSource({ uri });
    return { width: s.width || 0, height: s.height || 0 };
  } catch { return { width: 0, height: 0 }; }
}

/**
 * t_55e92e7e 후속 실행 배선: ↗ 파일첨부 웹 선택기 — hidden <input type=file>(accept 없음 = 전 유형,
 * 백엔드 /api/upload mime 검증에 일임). 네이티브는 expo-document-picker 미설치 — errors.unavailableAction
 * throw(호출측 setUnavailableError 폴백). att.add가 받는 { uri, name, type } 형태 반환.
 */
export async function pickFilesWeb(): Promise<{ uri: string; name: string; type: string }[]> {
  if (Platform.OS !== 'web') throw new Error('errors.unavailableAction');
  if (typeof document === 'undefined') return [];
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files.map((f) => ({ uri: URL.createObjectURL(f), name: f.name || 'file.bin', type: f.type || 'application/octet-stream' })));
    };
    // 취소는 resolve 안 함 — pickWeb과 동일 계약(호출측 상태 유지).
    document.body.appendChild(input);
    input.click();
  });
}
