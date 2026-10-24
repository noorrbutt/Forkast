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
      suggestionDismissed: false,
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
});
