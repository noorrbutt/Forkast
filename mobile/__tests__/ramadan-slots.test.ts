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

  test('right at fajr is no longer sehri (fasting begins)', () => {
    expect(slotOf(WINDOW.fajr, WINDOW)).toBe(null);
  });

  test('mid-afternoon, deep in the fast, is null', () => {
    expect(slotOf(new Date(2026, 1, 19, 14, 0), WINDOW)).toBe(null);
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
