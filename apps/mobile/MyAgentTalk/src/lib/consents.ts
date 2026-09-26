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
// 선택 동의는 필수 일괄 토글과 독립적으로 유지한다.
export function toggleRequiredConsents(state: ConsentState): ConsentState {
  const checked = !validateConsents(state);
  return { ...state, terms: checked, privacy: checked, voice_recording: checked, overseas_transfer: checked, ageConfirmed: checked };
}
export function signupConsents(state: ConsentState): SignupConsents {
  return { consents: consentTypes.map((type) => ({ type, version: '1.0', consented: state[type] })), age_confirmed: state.ageConfirmed };
}
