import { useCallback, useEffect, useState } from 'react';

import { CITIES, DEFAULT_CITY_ID, cityById, withinRamadanWindow, type City } from '../lib/ramadan';
import { readRamadanSettings, writeRamadanSettings, type RamadanSettings } from '../lib/ramadanStore';

const DEFAULTS: RamadanSettings = {
  enabled: false,
  cityId: DEFAULT_CITY_ID,
  offsetMin: 0,
  suggestionDismissed: false,
};

/**
 * Ramadan mode's on/off, city and minute offset, persisted on the device.
 *
 * `loaded` starts false so a caller can hold off rendering a toggle whose
 * value would otherwise flash from the default to the stored one on launch.
 * The suggestion banner is computed here rather than left to the caller: it
 * is "off, inside the suggested date range, and not already dismissed", and
 * keeping that one rule in one place is what stops Home and Profile disagreeing
 * about when to show it.
 */
export function useRamadan() {
  const [settings, setSettings] = useState<RamadanSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

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
    (offsetMin: number) => persist({ ...settings, offsetMin }),
    [settings, persist],
  );
  const dismissSuggestion = useCallback(
    () => persist({ ...settings, suggestionDismissed: true }),
    [settings, persist],
  );

  const suggestVisible =
    loaded && !settings.enabled && !settings.suggestionDismissed && withinRamadanWindow(new Date());

  return {
    loaded,
    enabled: settings.enabled,
    city: cityById(settings.cityId),
    cities: CITIES as readonly City[],
    offsetMin: settings.offsetMin,
    suggestVisible,
    setEnabled,
    setCityId,
    setOffsetMin,
    dismissSuggestion,
  };
}
