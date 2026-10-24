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
  suggestionDismissed: boolean;
  /** Whether the "turn it off now the month has ended?" banner was dismissed. */
  dismissedEnded: boolean;
};

/**
 * Where Ramadan mode's settings live on the device.
 *
 * This is religious observance data, which the app must not hold in its own
 * database: no API call, no DB column, no migration. The storage shape
 * mirrors lib/tokenStore.ts's own reasoning -- SecureStore on native, a
 * sessionStorage probe on web since expo-secure-store ships an empty web
 * implementation, and an in-memory map as the last resort so a blocked or
 * unavailable store degrades to "forgotten on reload" rather than a crash.
 */
const memory = new Map<string, string>();

function webStore(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    const probe = globalThis.sessionStorage;
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
      suggestionDismissed: Boolean(parsed.suggestionDismissed),
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
