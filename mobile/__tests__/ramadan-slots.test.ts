import { chooseNextStep } from '../components/home/nextStep';
import { activeSlots, openSlots, slotOf, type FastingWindow } from '../components/home/todayMeals';
import type { FoodLog } from '../lib/types';

const WINDOW: FastingWindow = {
  fajr: new Date(2026, 1, 19, 5, 47),
  maghrib: new Date(2026, 1, 19, 18, 29),
};

function log(createdAt: Date): FoodLog {
  return {
    id: 'x',
    created_at: createdAt.toISOString(),
    pending: false,
  } as FoodLog;
}

describe('slotOf, standard mode (no window) is unchanged', () => {
  test.each([
    [8, 'breakfast'],
    [12, 'lunch'],
    [20, 'dinner'],
    [2, null],
  ])('hour %i -> %s', (hour, expected) => {
    expect(slotOf(new Date(2026, 1, 19, hour as number))).toBe(expected);
  });
});

describe('slotOf, Ramadan mode', () => {
  test('90 minutes before fajr is sehri', () => {
    const when = new Date(WINDOW.fajr.getTime() - 60 * 60_000);
    expect(slotOf(when, WINDOW)).toBe('sehri');
  });

  test('right at fajr is no longer sehri, but daytime (fasting begins)', () => {
    expect(slotOf(WINDOW.fajr, WINDOW)).toBe('daytime');
  });

  test('mid-afternoon, deep in the fast, is daytime', () => {
    expect(slotOf(new Date(2026, 1, 19, 14, 0), WINDOW)).toBe('daytime');
  });

  test('30 minutes before maghrib through 90 after is iftar', () => {
    expect(slotOf(new Date(WINDOW.maghrib.getTime() - 20 * 60_000), WINDOW)).toBe('iftar');
    expect(slotOf(new Date(WINDOW.maghrib.getTime() + 60 * 60_000), WINDOW)).toBe('iftar');
  });

  test('late night, after the iftar window, is late', () => {
    expect(slotOf(new Date(WINDOW.maghrib.getTime() + 200 * 60_000), WINDOW)).toBe('late');
  });

  test('activeSlots returns the Ramadan three, in order', () => {
    expect(activeSlots(WINDOW)).toEqual(['sehri', 'iftar', 'late']);
  });

  test('activeSlots with no window returns the standard three', () => {
    expect(activeSlots(null)).toEqual(['breakfast', 'lunch', 'dinner']);
  });
});

describe('slotOf, Ramadan mode, exact boundary instants', () => {
  const SEHRI_START = new Date(WINDOW.fajr.getTime() - 90 * 60_000);
  const IFTAR_START = new Date(WINDOW.maghrib.getTime() - 30 * 60_000);
  const IFTAR_END = new Date(WINDOW.maghrib.getTime() + 90 * 60_000);

  test.each([
    ['fajr-90 (sehri start, inclusive)', SEHRI_START, 'sehri'],
    ['fajr (sehri ends, exclusive -- fasting begins)', WINDOW.fajr, 'daytime'],
    ['maghrib-30 (iftar start, inclusive)', IFTAR_START, 'iftar'],
    ['maghrib+90 (iftar end, exclusive -- late begins)', IFTAR_END, 'late'],
  ] as const)('%s', (_label, when, expected) => {
    expect(slotOf(when, WINDOW)).toBe(expected);
  });

  // One minute either side of each edge, so a boundary test cannot pass by
  // accident from an off-by-one that happens to land on the right side of
  // every edge checked above.
  test.each([
    [new Date(SEHRI_START.getTime() - 60_000), 'late'],
    [new Date(SEHRI_START.getTime() + 60_000), 'sehri'],
    [new Date(WINDOW.fajr.getTime() - 60_000), 'sehri'],
    [new Date(WINDOW.fajr.getTime() + 60_000), 'daytime'],
    [new Date(IFTAR_START.getTime() - 60_000), 'daytime'],
    [new Date(IFTAR_START.getTime() + 60_000), 'iftar'],
    [new Date(IFTAR_END.getTime() - 60_000), 'iftar'],
    [new Date(IFTAR_END.getTime() + 60_000), 'late'],
  ] as const)('one minute off an edge: %s -> %s', (when, expected) => {
    expect(slotOf(when, WINDOW)).toBe(expected);
  });
});

/**
 * With the mode off (no window), slotOf must still answer exactly as it did
 * before 'daytime' existed -- the whole point of 'daytime' is that it is
 * reachable only through a fasting window, never through this path.
 */
describe('slotOf, standard mode, exact boundary instants (mode-off snapshot)', () => {
  const DAY = new Date(2026, 1, 19);

  test.each([
    ['4:59am', new Date(DAY).setHours(4, 59), null],
    ['5:00am', new Date(DAY).setHours(5, 0), 'breakfast'],
    ['10:59am', new Date(DAY).setHours(10, 59), 'breakfast'],
    ['11:00am', new Date(DAY).setHours(11, 0), 'lunch'],
    ['3:59pm', new Date(DAY).setHours(15, 59), 'lunch'],
    ['4:00pm', new Date(DAY).setHours(16, 0), 'dinner'],
    ['11:59pm', new Date(DAY).setHours(23, 59), 'dinner'],
  ] as const)('standard mode edge %s', (_label, timestamp, expected) => {
    expect(slotOf(new Date(timestamp))).toBe(expected);
  });

  test('never returns daytime with no window, at any hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(slotOf(new Date(2026, 1, 19, hour))).not.toBe('daytime');
    }
  });
});

describe('openSlots, Ramadan mode', () => {
  test('nothing logged, before sehri: every slot is open', () => {
    const now = new Date(WINDOW.fajr.getTime() - 60 * 60_000);
    expect(openSlots([], now, WINDOW)).toEqual(['sehri', 'iftar', 'late']);
  });

  test('sehri logged: it drops off the open list', () => {
    const sehriAt = new Date(WINDOW.fajr.getTime() - 30 * 60_000);
    const meals = [log(sehriAt)];
    expect(openSlots(meals, sehriAt, WINDOW)).toEqual(['iftar', 'late']);
  });

  test('deep in the fast, no slot open yet: only what is still ahead', () => {
    const now = new Date(2026, 1, 19, 14, 0);
    expect(openSlots([], now, WINDOW)).toEqual(['iftar', 'late']);
  });
});

describe('chooseNextStep suppresses the "nothing logged" nudge while fasting', () => {
  test('no fastingWindow: the standard afternoon nudge still fires', () => {
    const now = new Date(2026, 1, 19, 14, 0);
    const step = chooseNextStep({ today: null, meals: [], open: ['lunch'], plan: null, now });
    expect(step.kind).toBe('log');
  });

  test('fastingWindow present, now mid-fast: no nudge even though nothing was logged', () => {
    const now = new Date(2026, 1, 19, 14, 0);
    const step = chooseNextStep({
      today: null,
      meals: [],
      open: [],
      plan: null,
      now,
      fastingWindow: WINDOW,
    });
    expect(step.kind).not.toBe('log');
  });

  test('fastingWindow present, now before fajr: the sehri nudge can still fire', () => {
    const now = new Date(WINDOW.fajr.getTime() - 30 * 60_000);
    const step = chooseNextStep({
      today: null,
      meals: [],
      open: ['sehri'],
      plan: null,
      now,
      fastingWindow: WINDOW,
    });
    // Before 1pm the standard afternoon-nudge gate has not opened yet either way.
    expect(step.kind).toBe('make-plan');
  });
});
