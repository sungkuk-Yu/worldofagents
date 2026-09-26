import { ApiError } from './errors';
import type { ConsentType } from '../types/db';

export const REQUIRED_CONSENTS = ['terms', 'privacy', 'voice_recording', 'overseas_transfer'] as const;
export interface SignupConsent { type: ConsentType; version: string; consented: boolean }

/** 개발 스모크 호환: 필드 자체 생략에만 자동 기록 허용. 실제 동의와 구분되는 버전을 남긴다. */
export function validateSignupConsents(body: { consents?: unknown; age_confirmed?: unknown }, devMode: boolean): SignupConsent[] {
  if (!Object.prototype.hasOwnProperty.call(body, 'consents') && devMode) {
    if (body.age_confirmed !== undefined && body.age_confirmed !== true) {
      throw new ApiError('AGE_CONFIRM_REQUIRED', '연령 확인이 필요합니다.', { category: 'VALIDATION_ERROR' });
    }
    return REQUIRED_CONSENTS.map(type => ({ type, version: 'dev-auto', consented: true }));
  }
  const fail = () => new ApiError('CONSENT_REQUIRED', '필수 약관 동의가 필요합니다.', { category: 'VALIDATION_ERROR' });
  if (!Array.isArray(body.consents)) throw fail();
  const seen = new Set<string>();
  const consents: SignupConsent[] = [];
  for (const item of body.consents) {
    if (!item || typeof item !== 'object' || ![...REQUIRED_CONSENTS, 'marketing'].includes(item.type)
      || typeof item.version !== 'string' || !item.version.trim() || typeof item.consented !== 'boolean' || seen.has(item.type)) throw fail();
    seen.add(item.type);
    consents.push({ type: item.type, version: item.version.trim(), consented: item.consented });
  }
  if (!REQUIRED_CONSENTS.every(type => consents.some(c => c.type === type && c.consented))) throw fail();
  if (body.age_confirmed !== true) throw new ApiError('AGE_CONFIRM_REQUIRED', '연령 확인이 필요합니다.', { category: 'VALIDATION_ERROR' });
  return consents;
}
