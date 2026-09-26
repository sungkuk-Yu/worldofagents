// 디바이스 라벨 — 백엔드 presence 화이트리스트와 정확히 동일해야 한다 (t_d75ca81c 계약).
// 순수 로직: react-native import 금지 (node 단위테스트가 useChatSession 체인을 직접 실행한다).
// 네이티브 여부는 RN의 navigator polyfill(product='ReactNative', osName)로 판정하고,
// 없으면 UA 문자열로 폴백 — 웹/노드에서는 창 폭으로 pc-web/mobile-web을 가른다.
import { PC_BREAKPOINT } from './layout';

export const DEVICE_LABELS = ['pc-web', 'mobile-web', 'ios', 'android', 'desktop-app', 'unknown'] as const;
export type DeviceLabel = (typeof DEVICE_LABELS)[number];

interface NavLike { product?: string; userAgent?: string; osName?: string }

/**
 * 현재 실행 환경을 라벨로. width = 레이아웃 감지용 창 폭 (PC_BREAKPOINT와 같은 소스).
 * - 네이티브(RN): osName/UA → ios | android
 * - 웹 ≥768: pc-web, <768: mobile-web (태블릿도 모바일 웹 트리로 — PTT 홀드 관습 동일)
 */
export function detectDeviceLabel(windowWidth: number, nav?: NavLike): DeviceLabel {
  const n = nav ?? (typeof navigator !== 'undefined' ? navigator as unknown as NavLike : undefined);
  if (n?.product === 'ReactNative' || /iPhone|iPad|iPod|Android/.test(n?.userAgent || '')) {
    if (n?.osName === 'android' || /Android/.test(n?.userAgent || '')) return 'android';
    return 'ios';
  }
  return windowWidth >= PC_BREAKPOINT ? 'pc-web' : 'mobile-web';
}

/** 디바이스 라벨 → i18n 키 (missing key 시 라벨 자체 폴백) */
export function deviceLabelKey(device: string): string {
  return `device.${device}`;
}

/** presence 항목의 라벨 → 아이콘(화면 라벨) — 화이트리스트 밖은 unknown 처리 */
export function deviceLabelIcon(device: string): string {
  switch (device) {
    case 'pc-web': case 'desktop-app': return '🖥';
    case 'mobile-web': return '🌐';
    case 'ios': case 'android': return '📱';
    default: return '·';
  }
}

/** presence 리스트에서 본인 라벨을 제외한 접속 디바이스 (본인은 '여기'이므로 목록에 안 씀) */
export function peersOf(devices: { device: string }[], self: string): string[] {
  const seen = new Set<string>();
  for (const d of devices) {
    if (d.device !== self) seen.add(d.device);
  }
  return [...seen];
}
