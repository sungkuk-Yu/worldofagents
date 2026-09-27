export const consentTypes = ['terms', 'privacy', 'voice_recording', 'overseas_transfer', 'marketing'] as const;
export type ConsentType = typeof consentTypes[number];
export type ConsentState = Record<ConsentType, boolean> & { ageConfirmed: boolean };
export interface SignupConsents {
  consents: { type: ConsentType; version: '1.0'; consented: boolean }[];
  age_confirmed: boolean;
}
export const emptyConsents: ConsentState = {
  terms: false, privacy: false, voice_recording: false, overseas_transfer: false,
  marketing: false, ageConfirmed: false,
};
export function validateConsents(state: ConsentState): boolean {
  return consentTypes.filter((type) => type !== 'marketing').every((type) => state[type] === true)
    && state.ageConfirmed === true;
}
// t_cac6f531 (대표님 피드백 9/27): 전체 동의 = 선택(마케팅)까지 6종 일괄 on/off.
// 개별 토글은 그대로 유지 — 일괄 후에도 마케팅 행만 개별 해제 가능. 필수 판정(validateConsents)은 불변.
export function toggleRequiredConsents(state: ConsentState): ConsentState {
  const checked = !validateConsents(state);
  return { ...state, terms: checked, privacy: checked, voice_recording: checked, overseas_transfer: checked, marketing: checked, ageConfirmed: checked };
}
export function signupConsents(state: ConsentState): SignupConsents {
  return { consents: consentTypes.map((type) => ({ type, version: '1.0', consented: state[type] })), age_confirmed: state.ageConfirmed };
}
