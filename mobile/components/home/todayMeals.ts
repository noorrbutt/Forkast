import type { FoodLog } from '../../lib/types';

/**
 * Today's meals, and which of the day's three slots they fill.
 *
 * The app has no meal-type field: a slot is read off the time a meal was
 * logged, with the same hour bands the server's reminder signal uses
 * (build_reminder_signal in backend/app/services/insights.py), so Home and a
 * reminder never disagree about whether lunch has happened.
 */

export type Slot = 'breakfast' | 'lunch' | 'dinner';

export const SLOTS: readonly Slot[] = ['breakfast', 'lunch', 'dinner'];

export const SLOT_LABELS: Record<Slot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

/** The slot a local time falls in, or null for the small hours (before 5am). */
export function slotOf(date: Date): Slot | null {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16) return 'dinner';
  return null;
}

/** The words a tile is announced with: the slot, or a plain name for 1am toast. */
export function slotLabelOf(log: Pick<FoodLog, 'created_at'>): string {
  const slot = slotOf(new Date(log.created_at));
  return slot ? SLOT_LABELS[slot] : 'Late night';
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * The meals logged today, in the order they were eaten.
 *
 * The logs list arrives newest first; a day reads left to right from
 * breakfast, so this reverses it. A meal still being saved has no id to open
 * yet and is left out until it lands.
 */
export function todaysMeals(logs: readonly FoodLog[], now: Date): FoodLog[] {
  return logs
    .filter((log) => !log.pending)
    .filter((log) => {
      const at = new Date(log.created_at);
      return !Number.isNaN(at.getTime()) && sameLocalDay(at, now);
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/** The slots nothing has been logged in yet today, in the day's order. */
export function openSlots(meals: readonly FoodLog[]): Slot[] {
  const filled = new Set(meals.map((log) => slotOf(new Date(log.created_at))));
  return SLOTS.filter((slot) => !filled.has(slot));
}
