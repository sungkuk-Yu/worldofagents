type CheckoutPlatform = 'ios' | 'android' | 'web';
// 국가 코드는 ISO 3166-1 alpha-2를 사용한다. 구독 UI 연결은 후속 작업이다.
const externalCheckout: Record<CheckoutPlatform, { default: boolean; KR: boolean }> = {
  ios: { default: true, KR: false },
  android: { default: true, KR: true },
  web: { default: true, KR: true },
};
export function shouldShowExternalCheckout(platform: CheckoutPlatform, region: string): boolean {
  const flags = externalCheckout[platform];
  return region.trim().toUpperCase() === 'KR' ? flags.KR : flags.default;
}
