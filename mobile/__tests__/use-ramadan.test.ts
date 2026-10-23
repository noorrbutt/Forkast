import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useRamadan } from '../hooks/useRamadan';
import { readRamadanSettings, writeRamadanSettings } from '../lib/ramadanStore';

// jest-expo's auto-mock for expo-secure-store resolves every call without
// storing anything, so a write followed by a read would silently see nothing
// written rather than exercising the hook's real persistence path. A small
// Map-backed mock here stands in for the OS keystore the same way it does on
// a real device.
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

describe('useRamadan', () => {
  beforeEach(async () => {
    // Settings live under one key, so each test starts from "nothing saved".
    await writeRamadanSettings({
      enabled: false,
      cityId: 'karachi',
      offsetMin: 0,
      suggestionDismissed: false,
    });
  });

  test('loads the stored settings', async () => {
    await writeRamadanSettings({
      enabled: true,
      cityId: 'lahore',
      offsetMin: 5,
      suggestionDismissed: true,
    });

    const { result } = renderHook(() => useRamadan());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.enabled).toBe(true);
    expect(result.current.city.id).toBe('lahore');
    expect(result.current.offsetMin).toBe(5);
  });

  test('defaults to Karachi, off, and no offset when nothing is stored', async () => {
    // Nothing stored yet in this process's in-memory fallback.
    const { result } = renderHook(() => useRamadan());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.enabled).toBe(false);
    expect(result.current.city.id).toBe('karachi');
    expect(result.current.offsetMin).toBe(0);
  });

  test('setEnabled persists across a fresh hook instance', async () => {
    const { result } = renderHook(() => useRamadan());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setEnabled(true));
    await waitFor(() => expect(result.current.enabled).toBe(true));

    const persisted = await readRamadanSettings();
    expect(persisted?.enabled).toBe(true);

    const { result: second } = renderHook(() => useRamadan());
    await waitFor(() => expect(second.current.loaded).toBe(true));
    expect(second.current.enabled).toBe(true);
  });

  test('setCityId and setOffsetMin persist their own fields', async () => {
    const { result } = renderHook(() => useRamadan());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setCityId('lahore'));
    await waitFor(() => expect(result.current.city.id).toBe('lahore'));

    act(() => result.current.setOffsetMin(-3));
    await waitFor(() => expect(result.current.offsetMin).toBe(-3));

    expect(result.current.city.id).toBe('lahore');
  });

  test('suggestVisible is false once the mode is on', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2027, 1, 20));
    await writeRamadanSettings({
      enabled: true,
      cityId: 'karachi',
      offsetMin: 0,
      suggestionDismissed: false,
    });

    const { result } = renderHook(() => useRamadan());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.suggestVisible).toBe(false);
    jest.useRealTimers();
  });

  test('suggestVisible is false once dismissed, even inside the window', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2027, 1, 20));
    await writeRamadanSettings({
      enabled: false,
      cityId: 'karachi',
      offsetMin: 0,
      suggestionDismissed: true,
    });

    const { result } = renderHook(() => useRamadan());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.suggestVisible).toBe(false);
    jest.useRealTimers();
  });

  test('suggestVisible is true when off, undismissed, and inside the window', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2027, 1, 20));
    await writeRamadanSettings({
      enabled: false,
      cityId: 'karachi',
      offsetMin: 0,
      suggestionDismissed: false,
    });

    const { result } = renderHook(() => useRamadan());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.suggestVisible).toBe(true);
    jest.useRealTimers();
  });

  test('dismissSuggestion hides the banner and persists', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2027, 1, 20));
    await writeRamadanSettings({
      enabled: false,
      cityId: 'karachi',
      offsetMin: 0,
      suggestionDismissed: false,
    });

    const { result } = renderHook(() => useRamadan());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.suggestVisible).toBe(true);

    act(() => result.current.dismissSuggestion());
    await waitFor(() => expect(result.current.suggestVisible).toBe(false));

    const persisted = await readRamadanSettings();
    expect(persisted?.suggestionDismissed).toBe(true);
    jest.useRealTimers();
  });

  test('suggestVisible is false outside the Ramadan window', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 1));
    const { result } = renderHook(() => useRamadan());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.suggestVisible).toBe(false);
    jest.useRealTimers();
  });
});
