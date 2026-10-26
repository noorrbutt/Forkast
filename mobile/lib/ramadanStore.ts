import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'forkast.ramadan_settings';

/** The minute offset's allowed range: a correction, not a second timetable. */
export const OFFSET_MIN = -10;
export const OFFSET_MAX = 10;

export function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, Math.round(value)));
}

export type RamadanSettings = {
  enabled: boolean;
  cityId: string;
  offsetMin: number;
  dismissedSuggestion: boolean;
  /** Whether the "turn it off now the month has ended?" banner was dismissed. */
  dismissedEnded: boolean;
};

/**
 * Where Ramadan mode's settings live on the device.
 *
 * This is religious observance data, which the app must not hold in its own
 * database: no API call, no DB column, no migration. SecureStore on native,
 * an in-memory map as the last resort so a blocked or unavailable store
 * degrades to "forgotten on reload" rather than a crash.
 *
 * On web this deliberately uses localStorage, not lib/tokenStore.ts's
 * sessionStorage. tokenStore's choice is about blast radius: a stolen auth
 * token is a live session, so it is made to not outlive the tab. There is
 * no equivalent risk here -- this is a toggle, a city and a number, already
 * documented as never leaving the device -- so the ordinary expectation for
 * a saved preference applies instead: turn it on, close the tab, reopen it,
 * it is still on. sessionStorage could not do that; it forgot the setting
 * the moment the tab closed.
 */
const memory = new Map<string, string>();

function webStore(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    const probe = globalThis.localStorage;
    probe.setItem('forkast.probe', '1');
    probe.removeItem('forkast.probe');
    return probe;
  } catch {
    return null;
  }
}

async function readRaw(): Promise<string | null> {
  const web = webStore();
  if (web) return web.getItem(KEY);
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return memory.get(KEY) ?? null;
  }
}

async function writeRaw(value: string): Promise<void> {
  const web = webStore();
  if (web) {
    web.setItem(KEY, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(KEY, value);
  } catch {
    memory.set(KEY, value);
  }
}

export async function readRamadanSettings(): Promise<RamadanSettings | null> {
  const raw = await readRaw();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      enabled: Boolean(parsed.enabled),
      cityId: typeof parsed.cityId === 'string' ? parsed.cityId : 'karachi',
      // Clamped on read too, not just on write, so a value written by an
      // older build (before the range existed) or edited by hand on disk
      // can never come back out wider than the range actually allows.
      offsetMin: clampOffset(typeof parsed.offsetMin === 'number' ? parsed.offsetMin : 0),
      // `suggestionDismissed` was this field's name before it was renamed
      // to match `dismissedEnded`'s convention. Falling back to it means an
      // account that already dismissed the suggestion banner under the old
      // name does not see it reappear just because the field was renamed.
      dismissedSuggestion: Boolean(parsed.dismissedSuggestion ?? parsed.suggestionDismissed),
      dismissedEnded: Boolean(parsed.dismissedEnded),
    };
  } catch {
    // Settings written by a future, incompatible version of this file read
    // back as "nothing saved yet" rather than crashing the app on launch.
    return null;
  }
}

export async function writeRamadanSettings(settings: RamadanSettings): Promise<void> {
  await writeRaw(JSON.stringify({ ...settings, offsetMin: clampOffset(settings.offsetMin) }));
}
