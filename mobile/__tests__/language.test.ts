import * as SecureStore from 'expo-secure-store';
import { I18nManager, Platform } from 'react-native';

import en from '../lib/locales/en';
import ur from '../lib/locales/ur';
import i18n from '../lib/i18n';
import { initializeLanguage, setAppLanguage } from '../lib/language';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

function leafKeys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'object' && child !== null
      ? leafKeys(child as Record<string, unknown>, path)
      : [path];
  });
}

describe('app language', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ships matching English and Urdu translation keys', () => {
    expect(leafKeys(ur)).toEqual(leafKeys(en));
  });

  it('resolves plural order labels in both languages', async () => {
    expect(i18n.t('log.loggedItems', { count: 1 })).toBe('Logged 1 item');
    expect(i18n.t('log.logItems', { count: 2 })).toBe('Log 2 items');

    await i18n.changeLanguage('ur');
    expect(i18n.t('log.loggedItems', { count: 1 })).toBe('1 چیز درج ہوئی');
    expect(i18n.t('log.logItems', { count: 2 })).toBe('2 چیزیں درج کریں');
  });

  it('loads the saved language and applies its layout direction', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('ur');

    await initializeLanguage();

    expect(i18n.language).toBe('ur');
    expect(i18n.t('home.today')).toBe('آج');
    if (Platform.OS !== 'web') {
      expect(I18nManager.allowRTL).toHaveBeenCalledWith(true);
      expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    }
  });

  it('persists a profile language selection and reports when layout needs a restart', async () => {
    jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
    const rtlBefore = I18nManager.isRTL;

    const restartRequired = await setAppLanguage('ur');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('forkast.language', 'ur');
    expect(i18n.language).toBe('ur');
    expect(restartRequired).toBe(Platform.OS !== 'web' && !rtlBefore);
    if (Platform.OS !== 'web') expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
  });
});
