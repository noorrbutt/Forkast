import {
  CITIES,
  IFTAR_DISHES,
  RAMADAN_1448,
  SEHRI_DISHES,
  cityById,
  countdownText,
  fastingWindow,
  phase,
  rankForRamadanSlot,
  shareCardOfferedFrom,
  shareCardVisible,
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
const FIXTURES: {
  date: [number, number, number];
  fajr: string;
  maghrib: string;
  kind: 'verified' | 'snapshot';
}[] = [
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

  test('89 minutes after maghrib is still iftar; exactly 90 is night, matching slotOf’s own boundary', () => {
    expect(phase(new Date(window.maghrib.getTime() + 89 * 60_000), window)).toBe('iftar');
    expect(phase(new Date(window.maghrib.getTime() + 90 * 60_000), window)).toBe('night');
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

  test('falls back to the plain "resumes tomorrow" line with no nextFajr given', () => {
    expect(countdownText(new Date(window.maghrib.getTime() + 200 * 60_000), window)).toBe(
      'Fasting resumes tomorrow',
    );
  });

  test('counts down to tomorrow’s fajr at night, when nextFajr is given', () => {
    // Tomorrow's sehri window closes a little earlier/later than today's,
    // same as any two consecutive days -- a round number here would make
    // the test pass even if the function quietly used today's fajr again.
    const nextFajr = new Date(2026, 1, 20, 5, 44);
    const now = new Date(nextFajr.getTime() - (6 * 60 + 2) * 60_000);
    expect(countdownText(now, window, nextFajr)).toBe('Sehri ends in 6h 02m');
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

describe('rankForRamadanSlot', () => {
  const hints = [
    { name: 'daal chawal' },
    { name: 'daliya' },
    { name: 'dates' },
    { name: 'dahi bhalla' },
  ];

  test('null slot returns the list unchanged', () => {
    expect(rankForRamadanSlot(hints, null)).toEqual(hints);
  });

  test('iftar moves IFTAR_DISHES matches to the front, order otherwise preserved', () => {
    const ranked = rankForRamadanSlot(hints, 'iftar');
    expect(ranked.map((h) => h.name)).toEqual(['dates', 'dahi bhalla', 'daal chawal', 'daliya']);
  });

  test('sehri moves SEHRI_DISHES matches to the front', () => {
    const ranked = rankForRamadanSlot(hints, 'sehri');
    expect(ranked.map((h) => h.name)).toEqual(['daliya', 'daal chawal', 'dates', 'dahi bhalla']);
  });

  test('returns a new array rather than mutating the input', () => {
    const original = [...hints];
    rankForRamadanSlot(hints, 'iftar');
    expect(hints).toEqual(original);
  });

  test('IFTAR_DISHES and SEHRI_DISHES name real desi-table dishes', () => {
    // A name here that does not exist in the dish table would silently never
    // match anything the server could return.
    for (const name of [...IFTAR_DISHES, ...SEHRI_DISHES]) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
    expect(IFTAR_DISHES.has('dates')).toBe(true);
    expect(SEHRI_DISHES.has('daliya')).toBe(true);
  });
});

describe('shareCardVisible', () => {
  test('offered exactly 3 days before the end', () => {
    const offeredFrom = shareCardOfferedFrom();
    expect(RAMADAN_1448.end.getTime() - offeredFrom.getTime()).toBe(3 * 24 * 60 * 60_000);
  });

  test('not visible before the offered date', () => {
    const justBefore = new Date(shareCardOfferedFrom().getTime() - 60_000);
    expect(shareCardVisible(justBefore)).toBe(false);
  });

  test('visible from the offered date onward, including after the end', () => {
    expect(shareCardVisible(shareCardOfferedFrom())).toBe(true);
    expect(shareCardVisible(RAMADAN_1448.end)).toBe(true);
    expect(shareCardVisible(new Date(RAMADAN_1448.end.getTime() + 10 * 24 * 60 * 60_000))).toBe(true);
  });
});
