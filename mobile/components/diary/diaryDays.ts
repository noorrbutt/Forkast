import type { FoodLog } from '../../lib/types';

export type DiaryDay = {
  key: string;
  heading: string;
  total: number;
  meals: FoodLog[];
};

/**
 * Which local day a timestamp belongs to.
 *
 * Built from the local parts rather than from toISOString, which would file a
 * late dinner under tomorrow for anyone east of Greenwich and split one evening
 * across two headings.
 */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayHeading(date: Date, now: Date): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(yesterday)) return 'Yesterday';

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  };
  // The year only earns its place once the meal is not from this one.
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('en-US', options);
}

/**
 * The flat newest first list, cut into days.
 *
 * Encounter order is kept rather than sorted, so the server stays the one thing
 * deciding what order meals are read in.
 */
export function groupByDay(items: FoodLog[], now: Date): DiaryDay[] {
  const days: DiaryDay[] = [];
  const byKey = new Map<string, DiaryDay>();

  for (const log of items) {
    const parsed = new Date(log.created_at);
    const readable = !Number.isNaN(parsed.getTime());
    // A timestamp this cannot read still belongs somewhere, so it gets its own
    // group under whatever the server sent rather than being dropped.
    const key = readable ? dayKey(parsed) : `unparsed:${log.created_at}`;

    let day = byKey.get(key);
    if (!day) {
      day = {
        key,
        heading: readable ? dayHeading(parsed, now) : log.created_at,
        total: 0,
        meals: [],
      };
      byKey.set(key, day);
      days.push(day);
    }

    day.meals.push(log);
    day.total += log.estimated_calories;
  }

  return days;
}

/**
 * A day's meals, cut into runs of consecutive photoless meals and single
 * photo meals, in the order they happened.
 *
 * A photo card carries its own rounded corners and, on light, its own
 * shadow, which is the whole point of it. Sitting it inside ListGroup's
 * bordered, overflow-hidden box -- the compact row's surface -- would mean
 * nesting one card's chrome inside another's and clipping the photo card's
 * shadow at the group's edge. So only a run of compact rows gets a
 * ListGroup; a photo meal stands on its own between runs, which still
 * renders every meal in encounter order and still groups the ones that share
 * a surface, it just no longer forces every meal in a day onto one surface
 * regardless of what kind of row it is.
 */
export type MealSegment =
  | { kind: 'group'; items: FoodLog[] }
  | { kind: 'photo'; item: FoodLog };

export function segmentMeals(meals: FoodLog[]): MealSegment[] {
  const segments: MealSegment[] = [];
  for (const log of meals) {
    if (log.has_photo) {
      segments.push({ kind: 'photo', item: log });
      continue;
    }
    const current = segments[segments.length - 1];
    if (current?.kind === 'group') {
      current.items.push(log);
    } else {
      segments.push({ kind: 'group', items: [log] });
    }
  }
  return segments;
}
