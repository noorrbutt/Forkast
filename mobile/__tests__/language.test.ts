import * as SecureStore from 'expo-secure-store';
import { I18nManager, Platform } from 'react-native';

import en from '../lib/locales/en';
import ur from '../lib/locales/ur';
import i18n from '../lib/i18n';
import { initializeLanguage, setAppLanguage } from '../lib/language';

const translatedScreenKeys = [
  'common.loading',
  'common.tryAgain',
  'common.couldNotLoad',
  'common.requestFailed',
  'common.connectionTimeout',
  'common.cannotConnect',
  'common.requestStatus',
  'common.somethingWrong',
  'common.undo',
  'common.doubleTapUndo',
  'diary.tab',
  'diary.title',
  'diary.loggedCount',
  'diary.unavailable',
  'diary.noMealsFound',
  'diary.tryDifferentSearch',
  'diary.clearFilters',
  'diary.emptyTitle',
  'diary.emptyMessage',
  'diary.logFirstMeal',
  'diary.readingFurtherBack',
  'diary.endOfDiary',
  'diary.searchLabel',
  'diary.searchPlaceholder',
  'diary.categoriesUnavailable',
  'diary.allCategories',
  'diary.viewAccessibilityLabel',
  'diary.listView',
  'diary.mapView',
  'diary.deletedMessage',
  'diary.undo',
  'diary.today',
  'diary.yesterday',
  'diary.repeatTitle',
  'diary.repeatMessage',
  'diary.repeatAction',
  'diary.cancel',
  'diary.deleteTitle',
  'diary.deleteMessage',
  'diary.delete',
  'diary.logAgain',
  'diary.logging',
  'diary.loggingAgain',
  'diary.addDishHint',
  'diary.removeDishHint',
  'diary.loggedAgainToday',
  'diary.deleteDish',
  'diary.showActions',
  'diary.opensMeal',
  'diary.mealCaloriesA11y',
  'diary.savingDish',
  'diary.refined',
  'diary.refinedA11y',
  'diary.pendingSync',
  'diary.pendingSyncA11y',
  'diary.estimated',
  'diary.estimatedLocally',
  'diary.findingSpots',
  'diary.mapUnavailable',
  'diary.noPlacesTitle',
  'diary.noPlacesMessage',
  'diary.areaNotSet',
  'diary.unnamedSpot',
  'diary.placesHere_one',
  'diary.placesHere_other',
  'diary.mealLoggedHere_one',
  'diary.mealLoggedHere_other',
  'diary.dismissMapNotice',
  'diary.mapUnavailableNotice',
  'diary.overlappingPlacesHint',
  'diary.groupedMapWebNotice',
  'diary.showEveryArea',
  'diary.showingAreaOnly',
  'diary.areaTotal_one',
  'diary.areaTotal_other',
  'diary.visitCount_one',
  'diary.visitCount_other',
  'home.calories',
  'home.net',
  'log.calories',
] as const;

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

  it('has translations for the home, log, and diary screens in every locale', () => {
    const missing: string[] = [];
    for (const language of ['en', 'ur'] as const) {
      for (const key of translatedScreenKeys) {
        if (i18n.getResource(language, 'translation', key) === undefined) {
          missing.push(`${language}.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
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
