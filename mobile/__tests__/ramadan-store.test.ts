import { Platform } from 'react-native';

import { OFFSET_MAX, OFFSET_MIN, clampOffset, readRamadanSettings, writeRamadanSettings } from '../lib/ramadanStore';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

describe('clampOffset', () => {
  test('leaves a value already inside the range alone', () => {
    expect(clampOffset(0)).toBe(0);
    expect(clampOffset(OFFSET_MIN)).toBe(OFFSET_MIN);
    expect(clampOffset(OFFSET_MAX)).toBe(OFFSET_MAX);
  });

  test('clamps a value past either end of the range', () => {
    expect(clampOffset(OFFSET_MAX + 1)).toBe(OFFSET_MAX);
    expect(clampOffset(999)).toBe(OFFSET_MAX);
    expect(clampOffset(OFFSET_MIN - 1)).toBe(OFFSET_MIN);
    expect(clampOffset(-999)).toBe(OFFSET_MIN);
  });

  test('rounds a fractional value before clamping', () => {
    expect(clampOffset(3.6)).toBe(4);
    expect(clampOffset(-3.6)).toBe(-4);
  });

  test('a non-finite value reads as 0', () => {
    expect(clampOffset(NaN)).toBe(0);
    expect(clampOffset(Infinity)).toBe(0);
  });
});

describe('writeRamadanSettings / readRamadanSettings clamp the offset', () => {
  test('a write past the range is clamped before it ever reaches storage', async () => {
    await writeRamadanSettings({
      enabled: true,
      cityId: 'karachi',
      offsetMin: 999,
      dismissedSuggestion: false,
      dismissedEnded: false,
    });
    const stored = await readRamadanSettings();
    expect(stored?.offsetMin).toBe(OFFSET_MAX);
  });

  test('a value written by an older build (no range yet) is clamped on read', async () => {
    // Simulates settings written before OFFSET_MIN/OFFSET_MAX existed, or
    // edited by hand on disk, rather than round-tripping through this
    // module's own write path.
    const raw = JSON.stringify({ enabled: true, cityId: 'karachi', offsetMin: -500 });
    const SecureStore = jest.requireMock('expo-secure-store') as {
      setItemAsync: (key: string, value: string) => Promise<void>;
    };
    await SecureStore.setItemAsync('forkast.ramadan_settings', raw);

    const stored = await readRamadanSettings();
    expect(stored?.offsetMin).toBe(OFFSET_MIN);
  });

  test('a row written under the old field name (suggestionDismissed) still reads as dismissed', async () => {
    // dismissedSuggestion was named suggestionDismissed before it was
    // renamed to match dismissedEnded's convention. An account that
    // already dismissed the banner under the old name must not see it
    // reappear just because the field was renamed.
    const raw = JSON.stringify({
      enabled: false,
      cityId: 'karachi',
      offsetMin: 0,
      suggestionDismissed: true,
    });
    const SecureStore = jest.requireMock('expo-secure-store') as {
      setItemAsync: (key: string, value: string) => Promise<void>;
    };
    await SecureStore.setItemAsync('forkast.ramadan_settings', raw);

    const stored = await readRamadanSettings();
    expect(stored?.dismissedSuggestion).toBe(true);
  });
});

describe('on web, settings survive closing the tab', () => {
  const realPlatformOS = Platform.OS;
  let fakeLocalStorage: Record<string, string>;
  let fakeSessionStorage: Record<string, string>;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'web', configurable: true });
    fakeLocalStorage = {};
    fakeSessionStorage = {};
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (key: string) => fakeLocalStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        fakeLocalStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete fakeLocalStorage[key];
      },
      clear: () => {
        fakeLocalStorage = {};
      },
      key: () => null,
      length: 0,
    } as Storage;
    // Present but must never be touched: sessionStorage is what tokenStore
    // uses for auth tokens (deliberately gone when the tab closes), and
    // this setting -- already documented as never leaving the device at
    // all -- has no reason to inherit that same short lifetime.
    (globalThis as { sessionStorage?: Storage }).sessionStorage = {
      getItem: (key: string) => fakeSessionStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        fakeSessionStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete fakeSessionStorage[key];
      },
      clear: () => {
        fakeSessionStorage = {};
      },
      key: () => null,
      length: 0,
    } as Storage;
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => realPlatformOS, configurable: true });
    delete (globalThis as { localStorage?: Storage }).localStorage;
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  });

  test('a write lands in localStorage, not sessionStorage', async () => {
    await writeRamadanSettings({
      enabled: true,
      cityId: 'lahore',
      offsetMin: 3,
      dismissedSuggestion: false,
      dismissedEnded: false,
    });

    expect(fakeLocalStorage['forkast.ramadan_settings']).toBeTruthy();
    expect(fakeSessionStorage['forkast.ramadan_settings']).toBeUndefined();
  });

  test('still reads back after sessionStorage is cleared -- simulating the tab having closed and reopened', async () => {
    await writeRamadanSettings({
      enabled: true,
      cityId: 'lahore',
      offsetMin: 3,
      dismissedSuggestion: false,
      dismissedEnded: false,
    });

    fakeSessionStorage = {}; // what closing the tab does to sessionStorage

    const stored = await readRamadanSettings();
    expect(stored?.enabled).toBe(true);
    expect(stored?.cityId).toBe('lahore');
  });
});
