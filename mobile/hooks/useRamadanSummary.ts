import { useQuery } from '@tanstack/react-query';

import { slotOf } from '../components/home/todayMeals';
import { api } from '../lib/api';
import { localDateKey } from '../lib/format';
import { RAMADAN_1448, fastingWindow, type City } from '../lib/ramadan';
import type { FoodLog, LogPage } from '../lib/types';
import { useAuth } from './useAuth';
import { DIARY_PAGE } from './useLogs';
import { useRamadan } from './useRamadan';

/**
 * Ramadan mode's retrospective: how sehri, iftar and the nights in between
 * actually went, from logs already on the server -- nothing new is sent or
 * computed there. Every figure here is an aggregate; see RamadanShareCard
 * for why that matters.
 */
export type RamadanSummary = {
  daysLogged: number;
  avgSehriKcal: number | null;
  avgIftarKcal: number | null;
  lateNightSharePct: number;
  junkShareAtIftarPct: number | null;
  junkShareRestPct: number | null;
};

/** Below this many distinct logged days, the maths is too thin to say anything. */
export const MIN_DAYS_FOR_SUMMARY = 5;

/** How many pages of the diary this will read before giving up. */
export const RAMADAN_SUMMARY_MAX_PAGES = 10;

/**
 * The pure arithmetic, kept separate from the fetch so it can be tested
 * against fixtures without a server.
 *
 * `logs` should already be narrowed to the Ramadan date range; this does not
 * filter by date itself, only by `pending` (an optimistic row with no settled
 * figures yet would skew every average it touched).
 */
export function summariseRamadanLogs(
  logs: readonly FoodLog[],
  city: City,
  offsetMin: number,
): RamadanSummary | null {
  const settled = logs.filter((log) => !log.pending);

  const days = new Set(settled.map((log) => localDateKey(new Date(log.created_at))));
  if (days.size < MIN_DAYS_FOR_SUMMARY) return null;

  let sehriTotal = 0;
  let sehriCount = 0;
  let iftarTotal = 0;
  let iftarCount = 0;
  let lateCount = 0;
  let iftarJunk = 0;
  let iftarAll = 0;
  let restJunk = 0;
  let restAll = 0;

  for (const log of settled) {
    const at = new Date(log.created_at);
    const window = fastingWindow(at, city, offsetMin);
    const slot = slotOf(at, window);
    const isJunk = log.category?.is_junk ?? false;

    if (slot === 'sehri') {
      sehriTotal += log.estimated_calories;
      sehriCount += 1;
    } else if (slot === 'iftar') {
      iftarTotal += log.estimated_calories;
      iftarCount += 1;
    } else if (slot === 'late') {
      lateCount += 1;
    }

    if (slot === 'iftar') {
      iftarAll += 1;
      if (isJunk) iftarJunk += 1;
    } else {
      restAll += 1;
      if (isJunk) restJunk += 1;
    }
  }

  return {
    daysLogged: days.size,
    avgSehriKcal: sehriCount > 0 ? Math.round(sehriTotal / sehriCount) : null,
    avgIftarKcal: iftarCount > 0 ? Math.round(iftarTotal / iftarCount) : null,
    lateNightSharePct: settled.length > 0 ? Math.round((lateCount / settled.length) * 100) : 0,
    junkShareAtIftarPct: iftarAll > 0 ? Math.round((iftarJunk / iftarAll) * 100) : null,
    junkShareRestPct: restAll > 0 ? Math.round((restJunk / restAll) * 100) : null,
  };
}

/**
 * Pages back through the diary from today, stopping once a page's oldest
 * entry predates RAMADAN_1448's start, the diary itself runs out, or
 * RAMADAN_SUMMARY_MAX_PAGES is reached -- whichever comes first. The cap
 * exists so an account with years of history cannot turn opening Trends
 * into an unbounded fetch.
 */
async function fetchRamadanWindowLogs(): Promise<FoodLog[]> {
  const logs: FoodLog[] = [];
  let offset = 0;

  for (let page = 0; page < RAMADAN_SUMMARY_MAX_PAGES; page += 1) {
    const response = await api.get<LogPage>('/logs', { params: { limit: DIARY_PAGE, offset } });
    const data = response.data;
    logs.push(...data.items);
    offset += data.items.length;

    const oldest = data.items[data.items.length - 1];
    const pastRamadanStart = oldest ? new Date(oldest.created_at) < RAMADAN_1448.start : true;
    const exhausted = data.items.length < DIARY_PAGE || offset >= data.total;
    if (pastRamadanStart || exhausted) break;
  }

  return logs;
}

export function useRamadanSummary() {
  const { signedIn } = useAuth();
  const ramadan = useRamadan();

  const query = useQuery({
    queryKey: ['ramadan-summary'],
    enabled: signedIn && ramadan.loaded && ramadan.enabled,
    queryFn: fetchRamadanWindowLogs,
  });

  const summary = (() => {
    if (!query.data) return null;
    const now = new Date();
    const inRange = query.data.filter((log) => {
      const at = new Date(log.created_at);
      return at >= RAMADAN_1448.start && at <= now;
    });
    return summariseRamadanLogs(inRange, ramadan.city, ramadan.offsetMin);
  })();

  return { ...query, summary };
}
