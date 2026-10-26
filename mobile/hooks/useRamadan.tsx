import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { CITIES, DEFAULT_CITY_ID, RAMADAN_1448, cityById, withinRamadanWindow, type City } from '../lib/ramadan';
import {
  OFFSET_MAX,
  OFFSET_MIN,
  clampOffset,
  readRamadanSettings,
  writeRamadanSettings,
  type RamadanSettings,
} from '../lib/ramadanStore';
import { useNow } from './useNow';

const DEFAULTS: RamadanSettings = {
  enabled: false,
  cityId: DEFAULT_CITY_ID,
  offsetMin: 0,
  dismissedSuggestion: false,
  dismissedEnded: false,
};

export type RamadanValue = {
  loaded: boolean;
  enabled: boolean;
  city: City;
  cities: readonly City[];
  offsetMin: number;
  suggestVisible: boolean;
  /** Whether to offer turning the mode off now the month has ended. */
  endedBannerVisible: boolean;
  setEnabled: (enabled: boolean) => void;
  setCityId: (cityId: string) => void;
  setOffsetMin: (offsetMin: number) => void;
  dismissSuggestion: () => void;
  dismissEnded: () => void;
};

const RamadanContext = createContext<RamadanValue | null>(null);

/**
 * Ramadan mode's on/off, city and minute offset, persisted on the device and
 * shared across every screen that reads it.
 *
 * This used to be a plain hook that each caller invoked independently --
 * Home, Profile, Plan, Trends, the log form and useReminders each held their
 * own copy, loaded from storage separately. Toggling the mode in Profile
 * updated Profile's own copy and nothing else: Home kept showing the old
 * state, the log form kept ranking chips for the old mode, and useReminders
 * kept whatever reminders it had already scheduled, all until something
 * else happened to remount them. One provider, one `persist`, one update
 * that every consumer sees on the same render.
 *
 * `loaded` starts false so a caller can hold off rendering a toggle whose
 * value would otherwise flash from the default to the stored one on launch.
 */
export function RamadanProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<RamadanSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const now = useNow();

  useEffect(() => {
    let active = true;
    void readRamadanSettings().then((stored) => {
      if (active && stored) setSettings(stored);
      if (active) setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((next: RamadanSettings) => {
    setSettings(next);
    void writeRamadanSettings(next);
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => persist({ ...settings, enabled }),
    [settings, persist],
  );
  const setCityId = useCallback(
    (cityId: string) => persist({ ...settings, cityId }),
    [settings, persist],
  );
  const setOffsetMin = useCallback(
    (offsetMin: number) => persist({ ...settings, offsetMin: clampOffset(offsetMin) }),
    [settings, persist],
  );
  const dismissSuggestion = useCallback(
    () => persist({ ...settings, dismissedSuggestion: true }),
    [settings, persist],
  );
  const dismissEnded = useCallback(
    () => persist({ ...settings, dismissedEnded: true }),
    [settings, persist],
  );

  const suggestVisible = loaded && !settings.enabled && !settings.dismissedSuggestion && withinRamadanWindow(now);
  const endedBannerVisible =
    loaded && settings.enabled && !settings.dismissedEnded && now.getTime() > RAMADAN_1448.end.getTime();

  const value: RamadanValue = useMemo(
    () => ({
      loaded,
      enabled: settings.enabled,
      city: cityById(settings.cityId),
      cities: CITIES as readonly City[],
      offsetMin: settings.offsetMin,
      suggestVisible,
      endedBannerVisible,
      setEnabled,
      setCityId,
      setOffsetMin,
      dismissSuggestion,
      dismissEnded,
    }),
    [loaded, settings, suggestVisible, endedBannerVisible, setEnabled, setCityId, setOffsetMin, dismissSuggestion, dismissEnded],
  );

  return <RamadanContext.Provider value={value}>{children}</RamadanContext.Provider>;
}

/**
 * Reads the shared Ramadan state. Must be called under `RamadanProvider`
 * (the app root wraps the whole tree in one, same as `AuthProvider`).
 */
export function useRamadan(): RamadanValue {
  const value = useContext(RamadanContext);
  if (!value) {
    throw new Error('useRamadan must be used within a RamadanProvider');
  }
  return value;
}

export { OFFSET_MIN, OFFSET_MAX };
