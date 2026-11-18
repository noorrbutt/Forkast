import i18n from 'i18next';
import { getLocales } from 'expo-localization';
import { initReactI18next } from 'react-i18next';

import en from './locales/en';
import ur from './locales/ur';

export type AppLanguage = 'en' | 'ur';

export function isAppLanguage(value: string | null): value is AppLanguage {
  return value === 'en' || value === 'ur';
}

export function deviceLanguage(): AppLanguage {
  const languageTag = getLocales()[0]?.languageTag.toLowerCase() ?? '';
  return languageTag.startsWith('ur') ? 'ur' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ur: { translation: ur },
  },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
