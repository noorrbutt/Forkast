import * as SecureStore from 'expo-secure-store';
import { I18nManager, Platform } from 'react-native';

import i18n, { deviceLanguage, isAppLanguage, type AppLanguage } from './i18n';

const LANGUAGE_KEY = 'forkast.language';

async function readSavedLanguage(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(LANGUAGE_KEY);
  }
  return SecureStore.getItemAsync(LANGUAGE_KEY);
}

async function saveLanguage(language: AppLanguage): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') {
      throw new Error('Language preferences are unavailable in this browser.');
    }
    localStorage.setItem(LANGUAGE_KEY, language);
    return;
  }
  await SecureStore.setItemAsync(LANGUAGE_KEY, language);
}

function setLayoutDirection(language: AppLanguage): boolean {
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') document.documentElement.dir = language === 'ur' ? 'rtl' : 'ltr';
    return false;
  }

  const rtl = language === 'ur';
  const restartRequired = I18nManager.isRTL !== rtl;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return restartRequired;
}

export async function initializeLanguage(): Promise<void> {
  const savedLanguage = await readSavedLanguage();
  const language = isAppLanguage(savedLanguage) ? savedLanguage : deviceLanguage();
  await i18n.changeLanguage(language);
  setLayoutDirection(language);
}

export async function setAppLanguage(language: AppLanguage): Promise<boolean> {
  await saveLanguage(language);
  await i18n.changeLanguage(language);
  return setLayoutDirection(language);
}
