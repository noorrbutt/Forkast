/**
 * Reading a calendar day back without letting the runtime guess a timezone.
 *
 * `new Date('2026-09-17')` is specified to parse as UTC midnight, while
 * `new Date('2026-09-17T12:00:00')` parses as local. The API sends bare
 * calendar days for `calories_by_day[].day` and `last_junk_date`, so every
 * weekday label on the dashboard chart and the date on the Streaks tab was
 * built from an instant that lands on the previous evening for anyone west of
 * Greenwich, and read one day early.
 *
 * The runner's own zone decides whether that reproduces, so these tests do not
 * depend on it. They assert the property that has to hold in every zone: the
 * day that comes out is the day that went in.
 */

import { formatDate, shortDay } from '../lib/format';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

describe('a bare calendar day', () => {
  it('keeps its weekday, whatever zone the device is in', () => {
    // Built from parts, which is by definition the local day the string names.
    const local = new Date(2026, 8, 17);

    expect(shortDay('2026-09-17')).toBe(DAY_NAMES[local.getDay()]);
  });

  it('keeps its day number', () => {
    expect(formatDate('2026-09-17')).toBe('Sep 17');
    expect(formatDate('2026-01-01')).toBe('Jan 1');
    expect(formatDate('2026-12-31')).toBe('Dec 31');
  });

  it('does not drift across a whole year of days', () => {
    // The failure is an off by one, so it shows on every day rather than on an
    // edge case. A year of them makes that impossible to pass by accident.
    for (let index = 0; index < 365; index += 1) {
      const date = new Date(2026, 0, 1 + index);
      const iso = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');

      expect(shortDay(iso)).toBe(DAY_NAMES[date.getDay()]);
    }
  });

  it('is not what the naive parse gives in a western zone', () => {
    // Guards the fix rather than the formatter: this is the exact comparison
    // that was wrong, expressed without depending on the runner's zone.
    const naive = new Date('2026-09-17');
    const westOfGreenwich = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
    }).format(naive);

    // Proof the old approach really did land on the day before.
    expect(westOfGreenwich).toBe('Wed');
    // And proof the current one does not.
    expect(shortDay('2026-09-17')).toBe('Thu');
  });
});

describe('a real instant', () => {
  it('is still converted to local time, because that is correct for one', () => {
    // Anything with a time in it is a genuine moment and the runtime is right
    // to convert it. Only date-only strings are built from parts.
    const formatted = formatDate('2026-09-17T23:30:00Z');

    expect(formatted).toMatch(/^Sep 1[78]$/);
  });

  it('returns the input unchanged when it is not a date at all', () => {
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
  });
});
