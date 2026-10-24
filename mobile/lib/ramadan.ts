import { CalculationMethod, Coordinates, PrayerTimes } from 'adhan';

/**
 * Ramadan mode: fasting windows computed on the device, never sent to the API.
 *
 * Mode, city and minute offset are device-local settings (see hooks/useRamadan.ts)
 * precisely because this is religious observance data, which the app must not
 * hold in its own database. Everything here is pure maths over coordinates and a
 * calendar date, so it can run fully offline and be tested without a server.
 */

export type City = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

/**
 * About a dozen Pakistani cities, named and coordinated for adhan's
 * CalculationMethod.Karachi, which is tuned for the region this app ships to
 * first. Karachi is the default: it is both the method's namesake and the
 * country's largest city, so it is the least surprising fallback for someone
 * who has not picked one yet.
 */
export const CITIES: readonly City[] = [
  { id: 'karachi', label: 'Karachi', latitude: 24.8607, longitude: 67.0011 },
  { id: 'lahore', label: 'Lahore', latitude: 31.5497, longitude: 74.3436 },
  { id: 'islamabad', label: 'Islamabad', latitude: 33.6844, longitude: 73.0479 },
  { id: 'rawalpindi', label: 'Rawalpindi', latitude: 33.5651, longitude: 73.0169 },
  { id: 'faisalabad', label: 'Faisalabad', latitude: 31.4504, longitude: 73.1350 },
  { id: 'multan', label: 'Multan', latitude: 30.1575, longitude: 71.5249 },
  { id: 'peshawar', label: 'Peshawar', latitude: 34.0151, longitude: 71.5805 },
  { id: 'quetta', label: 'Quetta', latitude: 30.1798, longitude: 66.9750 },
  { id: 'hyderabad', label: 'Hyderabad', latitude: 25.3960, longitude: 68.3578 },
  { id: 'sialkot', label: 'Sialkot', latitude: 32.4945, longitude: 74.5229 },
  { id: 'gujranwala', label: 'Gujranwala', latitude: 32.1877, longitude: 74.1945 },
  { id: 'sukkur', label: 'Sukkur', latitude: 27.7052, longitude: 68.8574 },
];

export const DEFAULT_CITY_ID = 'karachi';

export function cityById(id: string): City {
  return CITIES.find((city) => city.id === id) ?? CITIES.find((city) => city.id === DEFAULT_CITY_ID)!;
}

/**
 * The window a given calendar day fasts across: Fajr to Maghrib, plus the
 * user's own minute correction against the local timetable they actually
 * follow.
 *
 * adhan reads the *local* calendar date off the Date it is given (year, month,
 * day in whatever zone the JS runtime is in), not an instant, so a bare
 * `new Date()` passed at 11pm or just after midnight can compute the wrong
 * day's times depending on the caller's clock. Building a noon Date from the
 * same Y/M/D sidesteps that: noon is never adjacent to a day boundary or a DST
 * transition, so the calendar day read back out is always the one intended,
 * under any runtime timezone.
 */
export function fastingWindow(
  date: Date,
  city: City,
  offsetMin = 0,
): { fajr: Date; maghrib: Date } {
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  const coordinates = new Coordinates(city.latitude, city.longitude);
  const times = new PrayerTimes(coordinates, noon, CalculationMethod.Karachi());
  const offsetMs = offsetMin * 60_000;
  return {
    fajr: new Date(times.fajr.getTime() + offsetMs),
    maghrib: new Date(times.maghrib.getTime() + offsetMs),
  };
}

export type RamadanPhase = 'before_sehri' | 'fasting' | 'iftar' | 'night';

/** How long the iftar window stays open before the day reads as "night". */
const IFTAR_WINDOW_MIN = 90;

/**
 * Where `now` sits against a day's fasting window.
 *
 * `window` must be the window for `now`'s own calendar day: a window computed
 * for yesterday or tomorrow does not describe where `now` falls.
 */
export function phase(now: Date, window: { fajr: Date; maghrib: Date }): RamadanPhase {
  if (now < window.fajr) return 'before_sehri';
  if (now < window.maghrib) return 'fasting';
  if (now.getTime() <= window.maghrib.getTime() + IFTAR_WINDOW_MIN * 60_000) return 'iftar';
  return 'night';
}

/** "2h 14m", or "14m" once under an hour: never a figure that reads as zero. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * The one line the Home fasting card shows, naming whichever of Fajr or
 * Maghrib is still ahead of `now`.
 *
 * During the iftar window itself there is nothing left to count down to, so
 * the card says what the day is instead of measuring a window that already
 * closed.
 */
export function countdownText(now: Date, window: { fajr: Date; maghrib: Date }): string {
  const day = phase(now, window);
  switch (day) {
    case 'before_sehri':
      return `Sehri ends in ${formatDuration(window.fajr.getTime() - now.getTime())}`;
    case 'fasting':
      return `Iftar in ${formatDuration(window.maghrib.getTime() - now.getTime())}`;
    case 'iftar':
      return 'Iftar time';
    case 'night':
      return 'Fasting resumes tomorrow';
  }
}

/**
 * Ramadan 1448 AH, used only to decide when to suggest turning the mode on --
 * never to force it on, since the mode is opt-in and the date range is itself
 * only an estimate until the moon is actually sighted.
 */
export const RAMADAN_1448 = {
  start: new Date(2027, 1, 7),
  end: new Date(2027, 2, 10),
};

/** Whether a given moment falls inside the suggested Ramadan date range. */
export function withinRamadanWindow(now: Date): boolean {
  return now >= RAMADAN_1448.start && now <= RAMADAN_1448.end;
}

/**
 * Dish names (matching app/services/ai/desi.py's own dish names exactly)
 * that someone opening the iftar chips is most likely reaching for: the
 * things that open a fast, plus a few common iftar-table staples.
 */
export const IFTAR_DISHES: ReadonlySet<string> = new Set([
  'dates',
  'dahi bhalla',
  'fruit chaat',
  'chana chaat',
  'papri chaat',
  'samosa',
  'pakora',
  'rooh afza',
  'falooda',
  'nimbu pani',
  'jalebi',
]);

/** The same idea for sehri: light, before dawn, nothing heavy. */
export const SEHRI_DISHES: ReadonlySet<string> = new Set([
  'anda paratha',
  'omelette',
  'daliya',
  'paratha',
  'plain paratha',
  'roti',
  'sawaiyan',
  'zarda',
  'lassi',
  'chai',
  'doodh patti chai',
]);

/**
 * Reorders dish-hint chips so a Ramadan-slot match comes first, without
 * touching the server request that produced them.
 *
 * Client-side only, on purpose: the `/dishes` call itself must stay
 * identical whether Ramadan mode is on or off, since the app's eating
 * pattern during Ramadan is not something to tell the server about. `slot`
 * is null outside sehri/iftar (standard mode, or deep in the fast with
 * nothing to suggest), in which case the list comes back unchanged.
 */
export function rankForRamadanSlot<T extends { name: string }>(
  hints: readonly T[],
  slot: 'sehri' | 'iftar' | null,
): T[] {
  if (!slot) return [...hints];
  const preferred = slot === 'iftar' ? IFTAR_DISHES : SEHRI_DISHES;
  const matches: T[] = [];
  const rest: T[] = [];
  for (const hint of hints) {
    (preferred.has(hint.name) ? matches : rest).push(hint);
  }
  return [...matches, ...rest];
}
