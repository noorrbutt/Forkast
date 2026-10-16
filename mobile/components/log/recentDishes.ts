import type { FoodLog } from '../../lib/types';

/**
 * Up to `limit` distinct dishes from the diary, newest first.
 *
 * "Distinct" is case-insensitive on the dish name: "Chicken Biryani" and
 * "chicken biryani" are the same thing said twice, and showing both wastes
 * two of the four slots on one dish. The newest occurrence wins, which is
 * what `logs` already being newest-first (GET /logs orders by created_at
 * desc) gives for free -- the first match for a given name encountered while
 * walking the list IS the newest one.
 */
export function recentDishes(logs: readonly FoodLog[], limit = 4): FoodLog[] {
  const seen = new Set<string>();
  const result: FoodLog[] = [];

  for (const log of logs) {
    const key = log.dish_name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(log);
    if (result.length >= limit) break;
  }

  return result;
}
