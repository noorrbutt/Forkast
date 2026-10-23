import type { FoodLog } from '../../lib/types';

/**
 * Today's meals, and which of the day's slots they fill.
 *
 * The app has no meal-type field: a slot is read off the time a meal was
 * logged, with the same hour bands the server's reminder signal uses
 * (build_reminder_signal in backend/app/services/insights.py), so Home and a
 * reminder never disagree about whether lunch has happened.
 *
 * In Ramadan mode the three clock-hour slots are swapped for three fasting
 * slots keyed off that day's own sunrise and sunset rather than fixed hours,
 * since "lunch" has no meaning on a fasting day. `slotOf` and `activeSlots`
 * take an optional fasting window for this; passing none keeps every existing
 * caller byte-identical to standard mode.
 */

export type StandardSlot = 'breakfast' | 'lunch' | 'dinner';
export type RamadanSlot = 'sehri' | 'iftar' | 'late';
export type Slot = StandardSlot | RamadanSlot;

export const SLOTS: readonly StandardSlot[] = ['breakfast', 'lunch', 'dinner'];
const RAMADAN_SLOTS: readonly RamadanSlot[] = ['sehri', 'iftar', 'late'];

export const SLOT_LABELS: Record<Slot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  sehri: 'Sehri',
  iftar: 'Iftar',
  late: 'Late night',
};

/** A day's fasting window, as lib/ramadan.ts's `fastingWindow` returns it. */
export type FastingWindow = { fajr: Date; maghrib: Date };

/** The hours before fajr that count as the sehri slot. */
const SEHRI_LEAD_MIN = 90;
/** The window around maghrib that counts as the iftar slot. */
const IFTAR_LEAD_MIN = 30;
const IFTAR_TRAIL_MIN = 90;

/** The slots a day offers: the standard three, or Ramadan mode's three. */
export function activeSlots(window: FastingWindow | null): readonly Slot[] {
  return window ? RAMADAN_SLOTS : SLOTS;
}

/**
 * The slot a local time falls in, or null when nothing is open yet.
 *
 * With no fasting window this is standard mode's fixed hour bands, null for
 * the small hours before 5am. With one, sehri is the stretch right before
 * fajr, iftar spans maghrib, and late covers the rest of the night; the
 * fasting hours in between have no open slot, same as the small hours do in
 * standard mode.
 */
export function slotOf(date: Date, window: FastingWindow | null = null): Slot | null {
  if (!window) {
    const hour = date.getHours();
    if (hour >= 5 && hour < 11) return 'breakfast';
    if (hour >= 11 && hour < 16) return 'lunch';
    if (hour >= 16) return 'dinner';
    return null;
  }

  const sehriStart = new Date(window.fajr.getTime() - SEHRI_LEAD_MIN * 60_000);
  const iftarStart = new Date(window.maghrib.getTime() - IFTAR_LEAD_MIN * 60_000);
  const iftarEnd = new Date(window.maghrib.getTime() + IFTAR_TRAIL_MIN * 60_000);

  if (date >= sehriStart && date < window.fajr) return 'sehri';
  if (date >= iftarStart && date < iftarEnd) return 'iftar';
  if (date >= iftarEnd || date < sehriStart) return 'late';
  // Between fajr and the iftar window: fasting, nothing to log.
  return null;
}

/** The words a tile is announced with: the slot, or a plain name for 1am toast. */
export function slotLabelOf(log: Pick<FoodLog, 'created_at'>, window: FastingWindow | null = null): string {
  const slot = slotOf(new Date(log.created_at), window);
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

/**
 * The slots nothing has been logged in yet today and that can still be.
 *
 * A slot whose hours have passed is left out. A meal's slot is read off the
 * time it is logged, so "Log breakfast" tapped at 8pm would file the meal as
 * dinner; offering it would promise something the save cannot keep. Before
 * 5am no slot has started yet, so all three are open.
 */
/**
 * Where "nothing open yet" (slotOf returning null) sits in the slot order.
 *
 * In standard mode null only ever means "before 5am", so every slot is still
 * ahead. In Ramadan mode it also means "fasting, between fajr and the iftar
 * window", where sehri has already passed and only iftar and late are still
 * ahead -- the same null answer means two different things depending on
 * which side of fajr `now` is on.
 */
function fromIndex(now: Date, window: FastingWindow | null): number {
  if (window && now >= window.fajr) return 1;
  return 0;
}

export function openSlots(
  meals: readonly FoodLog[],
  now: Date,
  window: FastingWindow | null = null,
): Slot[] {
  const slots = activeSlots(window);
  const filled = new Set(meals.map((log) => slotOf(new Date(log.created_at), window)));
  const current = slotOf(now, window);
  const from = current === null ? fromIndex(now, window) : slots.indexOf(current);
  return slots.filter((slot, index) => index >= from && !filled.has(slot));
}
