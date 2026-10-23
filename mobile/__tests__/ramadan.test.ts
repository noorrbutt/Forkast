import {
  CITIES,
  RAMADAN_1448,
  cityById,
  countdownText,
  fastingWindow,
  phase,
  withinRamadanWindow,
} from '../lib/ramadan';

const KARACHI = cityById('karachi');

/**
 * Fajr/Maghrib fixtures for Karachi, local HH:MM.
 *
 * "verified" rows were checked against published Karachi timetables and are
 * held to a 2 minute tolerance. "snapshot" rows are only what this module
 * itself computes, kept to catch a regression in the calculation rather than
 * to assert real-world accuracy.
 */
const FIXTURES: Array<{ date: [number, number, number]; fajr: string; maghrib: string; kind: 'verified' | 'snapshot' }> = [
  { date: [2026, 2, 19], fajr: '05:47', maghrib: '18:29', kind: 'verified' },
  { date: [2026, 3, 18], fajr: '05:23', maghrib: '18:42', kind: 'verified' },
  { date: [2027, 2, 8], fajr: '05:53', maghrib: '18:22', kind: 'snapshot' },
  { date: [2027, 3, 8], fajr: '05:33', maghrib: '18:37', kind: 'snapshot' },
];

function minutesFromLocalClock(label: string): number {
  const [h, m] = label.split(':').map(Number);
  return h * 60 + m;
}

function localMinutesOfDay(date: Date, timezoneOffsetFromKarachiMin: number): number {
  // The fixture clock times are in Karachi local time (UTC+5, no DST), so a
  // UTC instant is converted to Karachi wall-clock minutes directly off its
  // UTC fields rather than relying on the test runner's own timezone.
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + timezoneOffsetFromKarachiMin + 24 * 60) % (24 * 60);
}

const KARACHI_UTC_OFFSET_MIN = 5 * 60;

describe('fastingWindow (Karachi fixtures)', () => {
  for (const fixture of FIXTURES) {
    const tolerance = fixture.kind === 'verified' ? 2 : 10;
    const [year, month, day] = fixture.date;
    const label = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} (${fixture.kind})`;

    test(`${label} matches within ${tolerance}m`, () => {
      const when = new Date(year, month - 1, day, 12, 0, 0);
      const window = fastingWindow(when, KARACHI, 0);

      const fajrMinutes = localMinutesOfDay(window.fajr, KARACHI_UTC_OFFSET_MIN);
      const maghribMinutes = localMinutesOfDay(window.maghrib, KARACHI_UTC_OFFSET_MIN);

      expect(Math.abs(fajrMinutes - minutesFromLocalClock(fixture.fajr))).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(maghribMinutes - minutesFromLocalClock(fixture.maghrib))).toBeLessThanOrEqual(tolerance);
    });
  }

  test('a positive minute offset shifts both times later', () => {
    const when = new Date(2026, 1, 19, 12, 0, 0);
    const base = fastingWindow(when, KARACHI, 0);
    const shifted = fastingWindow(when, KARACHI, 10);
    expect(shifted.fajr.getTime() - base.fajr.getTime()).toBe(10 * 60_000);
    expect(shifted.maghrib.getTime() - base.maghrib.getTime()).toBe(10 * 60_000);
  });

  test('defaults to Karachi when a city id is unknown', () => {
    expect(cityById('nowhere')).toEqual(KARACHI);
  });

  test('CITIES includes about a dozen Pakistani cities, Karachi among them', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(10);
    expect(CITIES.some((city) => city.id === 'karachi')).toBe(true);
  });
});

describe('phase', () => {
  const window = { fajr: new Date(2026, 1, 19, 5, 47), maghrib: new Date(2026, 1, 19, 18, 29) };

  test('before fajr is before_sehri', () => {
    expect(phase(new Date(2026, 1, 19, 4, 0), window)).toBe('before_sehri');
  });

  test('between fajr and maghrib is fasting', () => {
    expect(phase(new Date(2026, 1, 19, 12, 0), window)).toBe('fasting');
  });

  test('just after maghrib is iftar', () => {
    expect(phase(new Date(2026, 1, 19, 18, 30), window)).toBe('iftar');
  });

  test('90 minutes after maghrib is still iftar, 91 is night', () => {
    expect(phase(new Date(window.maghrib.getTime() + 90 * 60_000), window)).toBe('iftar');
    expect(phase(new Date(window.maghrib.getTime() + 91 * 60_000), window)).toBe('night');
  });
});

describe('countdownText', () => {
  const window = { fajr: new Date(2026, 1, 19, 5, 47), maghrib: new Date(2026, 1, 19, 18, 29) };

  test('counts down to maghrib while fasting', () => {
    const now = new Date(window.maghrib.getTime() - (2 * 60 + 14) * 60_000);
    expect(countdownText(now, window)).toBe('Iftar in 2h 14m');
  });

  test('counts down to fajr before sehri ends', () => {
    const now = new Date(window.fajr.getTime() - (6 * 60 + 2) * 60_000);
    expect(countdownText(now, window)).toBe('Sehri ends in 6h 02m');
  });

  test('says iftar time during the iftar window', () => {
    expect(countdownText(new Date(window.maghrib.getTime() + 10 * 60_000), window)).toBe('Iftar time');
  });

  test('says fasting resumes tomorrow at night', () => {
    expect(countdownText(new Date(window.maghrib.getTime() + 200 * 60_000), window)).toBe(
      'Fasting resumes tomorrow',
    );
  });
});

describe('withinRamadanWindow', () => {
  test('true inside RAMADAN_1448', () => {
    expect(withinRamadanWindow(new Date(2027, 1, 20))).toBe(true);
  });

  test('false well outside it', () => {
    expect(withinRamadanWindow(new Date(2026, 5, 1))).toBe(false);
  });

  test('inclusive of the start and end dates', () => {
    expect(withinRamadanWindow(RAMADAN_1448.start)).toBe(true);
    expect(withinRamadanWindow(RAMADAN_1448.end)).toBe(true);
  });
});
