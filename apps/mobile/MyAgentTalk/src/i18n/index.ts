import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { AppState } from 'react-native';
import { setApiLocale } from '../lib/api';
import { secureStorage } from '../lib/secureStorage';
import { LanguagePreference, resolveLanguage } from './language';
import ko from './locales/ko.json';
import en from './locales/en.json';

const i18n = createInstance();
let preference: LanguagePreference = 'system';
const systemLanguage = () => resolveLanguage(getLocales()[0]?.languageCode);
void i18n.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en } },
  lng: systemLanguage(), fallbackLng: 'ko', initAsync: false,
  interpolation: { escapeValue: false },
});
// 현재 언어를 API 레이어에 푸시 — REST Accept-Language / WS locale 파라미터 (백엔드 로케일 협상)
const syncApiLocale = () => setApiLocale(String(i18n.language));
i18n.on('languageChanged', syncApiLocale);
syncApiLocale();
export const getLanguagePreference = () => preference;
export async function changeLanguage(next: LanguagePreference) {
  await secureStorage.set('at-language', next);
  preference = next;
  await i18n.changeLanguage(next === 'system' ? systemLanguage() : next);
}
export async function initializeLanguage() {
  const saved = await secureStorage.get('at-language');
  if (saved === 'ko' || saved === 'en' || saved === 'system') preference = saved;
  await i18n.changeLanguage(preference === 'system' ? systemLanguage() : preference);
}
AppState.addEventListener('change', (state) => {
  if (state === 'active' && preference === 'system') void i18n.changeLanguage(systemLanguage());
});
export default i18n;
