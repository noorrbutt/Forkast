import { MIN_DAYS_FOR_SUMMARY, summariseRamadanLogs } from '../hooks/useRamadanSummary';
import { cityById, fastingWindow } from '../lib/ramadan';
import type { FoodLog } from '../lib/types';

const KARACHI = cityById('karachi');

function log(overrides: Partial<FoodLog> & { created_at: string; is_junk?: boolean }): FoodLog {
  const { is_junk = false, ...rest } = overrides;
  return {
    has_photo: false,
    id: `log-${Math.random()}`,
    dish_name: 'test meal',
    category_id: 1,
    restaurant_id: null,
    area: null,
    rating: 4,
    fun_scale: null,
    friend_scale: null,
    serving_size: 'medium',
    estimated_calories: 500,
    estimate_source: 'local',
    calorie_source: 'category',
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    refined: true,
    category: { id: 1, cuisine_id: 1, slug: 'test', name: 'Test', base_calorie_min: 1, base_calorie_max: 9999, is_junk },
    restaurant: null,
    pending: false,
    ...rest,
  };
}

/** One day's window, so fixtures can be built relative to real sun times
 * rather than guessed clock hours. */
function dayWindow(y: number, m: number, d: number) {
  return fastingWindow(new Date(y, m - 1, d, 12), KARACHI, 0);
}

describe('summariseRamadanLogs', () => {
  test('returns null under MIN_DAYS_FOR_SUMMARY distinct days', () => {
    const logs: FoodLog[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SUMMARY - 1; day += 1) {
      const window = dayWindow(2027, 2, day + 6);
      logs.push(log({ created_at: new Date(window.fajr.getTime() - 60 * 60_000).toISOString() }));
    }
    expect(summariseRamadanLogs(logs, KARACHI, 0)).toBeNull();
  });

  test('exactly MIN_DAYS_FOR_SUMMARY distinct days is enough', () => {
    const logs: FoodLog[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SUMMARY; day += 1) {
      const window = dayWindow(2027, 2, day + 6);
      logs.push(log({ created_at: new Date(window.fajr.getTime() - 60 * 60_000).toISOString() }));
    }
    const summary = summariseRamadanLogs(logs, KARACHI, 0);
    expect(summary).not.toBeNull();
    expect(summary?.daysLogged).toBe(MIN_DAYS_FOR_SUMMARY);
  });

  test('averages sehri and iftar calories separately', () => {
    const logs: FoodLog[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SUMMARY; day += 1) {
      const window = dayWindow(2027, 2, day + 6);
      logs.push(
        log({
          created_at: new Date(window.fajr.getTime() - 60 * 60_000).toISOString(),
          estimated_calories: 300 + day * 10, // sehri
        }),
        log({
          created_at: new Date(window.maghrib.getTime() + 10 * 60_000).toISOString(),
          estimated_calories: 600 + day * 10, // iftar
        }),
      );
    }
    const summary = summariseRamadanLogs(logs, KARACHI, 0);
    const sehriValues = [310, 320, 330, 340, 350];
    const iftarValues = [610, 620, 630, 640, 650];
    const expectedSehri = Math.round(sehriValues.reduce((a, b) => a + b) / sehriValues.length);
    const expectedIftar = Math.round(iftarValues.reduce((a, b) => a + b) / iftarValues.length);
    expect(summary?.avgSehriKcal).toBe(expectedSehri);
    expect(summary?.avgIftarKcal).toBe(expectedIftar);
  });

  test('late-night share counts logs after the iftar window, as a percentage', () => {
    const logs: FoodLog[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SUMMARY; day += 1) {
      const window = dayWindow(2027, 2, day + 6);
      logs.push(log({ created_at: new Date(window.fajr.getTime() - 60 * 60_000).toISOString() })); // sehri
      logs.push(log({ created_at: new Date(window.maghrib.getTime() + 200 * 60_000).toISOString() })); // late
    }
    const summary = summariseRamadanLogs(logs, KARACHI, 0);
    // 5 late out of 10 total logs = 50%.
    expect(summary?.lateNightSharePct).toBe(50);
  });

  test('junk share is computed separately for iftar vs everything else', () => {
    const logs: FoodLog[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SUMMARY; day += 1) {
      const window = dayWindow(2027, 2, day + 6);
      // Every iftar log is junk.
      logs.push(
        log({ created_at: new Date(window.maghrib.getTime() + 10 * 60_000).toISOString(), is_junk: true }),
      );
      // Every sehri log is not.
      logs.push(
        log({
          created_at: new Date(window.fajr.getTime() - 60 * 60_000).toISOString(),
          is_junk: false,
        }),
      );
    }
    const summary = summariseRamadanLogs(logs, KARACHI, 0);
    expect(summary?.junkShareAtIftarPct).toBe(100);
    expect(summary?.junkShareRestPct).toBe(0);
  });

  test('a pending (unsettled) log is excluded entirely', () => {
    const logs: FoodLog[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SUMMARY; day += 1) {
      const window = dayWindow(2027, 2, day + 6);
      logs.push(log({ created_at: new Date(window.fajr.getTime() - 60 * 60_000).toISOString() }));
    }
    // A sixth day's log, but still pending -- should not count toward days
    // logged, and the day floor should still be exactly MIN_DAYS_FOR_SUMMARY.
    const pendingWindow = dayWindow(2027, 2, 20);
    logs.push(
      log({
        created_at: new Date(pendingWindow.fajr.getTime() - 60 * 60_000).toISOString(),
        pending: true,
      }),
    );
    const summary = summariseRamadanLogs(logs, KARACHI, 0);
    expect(summary?.daysLogged).toBe(MIN_DAYS_FOR_SUMMARY);
  });

  test('a log logged while fasting (neither sehri nor iftar) counts toward "rest" only', () => {
    const logs: FoodLog[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SUMMARY; day += 1) {
      const window = dayWindow(2027, 2, day + 6);
      // Mid-afternoon: deep in the fast, slotOf returns null.
      const midFast = new Date((window.fajr.getTime() + window.maghrib.getTime()) / 2);
      logs.push(log({ created_at: midFast.toISOString(), is_junk: true }));
    }
    const summary = summariseRamadanLogs(logs, KARACHI, 0);
    expect(summary?.avgSehriKcal).toBeNull();
    expect(summary?.avgIftarKcal).toBeNull();
    expect(summary?.junkShareAtIftarPct).toBeNull();
    expect(summary?.junkShareRestPct).toBe(100);
  });
});
