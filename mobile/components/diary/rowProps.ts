import { SERVING_LABELS } from '../../lib/format';
import type { FoodLog, Uuid } from '../../lib/types';

/** The photo, square, large enough to recognise a dish and no larger. Used
 * only by the compact, photoless row (and its skeleton); a meal with a photo
 * gets the full width card instead. */
export const THUMB = 64;

export type MealRowProps = {
  log: FoodLog;
  /** Drops the divider, so the last row in a day does not draw a line to nothing. */
  last: boolean;
  /**
   * Both take the id rather than closing over it.
   *
   * The screen used to hand each row `() => router.push(...)` and
   * `() => logAgain(log.id)`, built fresh on every render, which meant a
   * memoised row would still see two new props every time and re-render
   * anyway. Taking the id lets the parent keep one stable function for the
   * whole list.
   */
  onOpen: (id: Uuid) => void;
  onRepeat: (id: Uuid) => void;
  /** The actual delete, no question asked first -- what the swipe and the
   * long-press menu both call, since a swipe or a trip through the menu is
   * already its own deliberate step. */
  onDelete: (id: Uuid) => void;
  /** What the standing footer button calls instead: the one-tap path, which
   * is why it asks first rather than deleting outright the way swipe and
   * the menu do. */
  onAskDelete: (id: Uuid) => void;
  /** Opens the non-gesture action menu (Log again / Delete) -- the accessible
   * equivalent of the swipe, reached by a long press or, for a screen reader,
   * the "Show actions" custom action. */
  onLongPress: (id: Uuid) => void;
  sending: boolean;
  confirmed: boolean;
  error: string | null;
};

/** Category, restaurant (or area) and serving, as one caption line. */
export function mealMeta(log: FoodLog): string {
  return [
    log.category?.name,
    log.restaurant?.name ?? log.area,
    SERVING_LABELS[log.serving_size],
  ]
    .filter(Boolean)
    .join(' · ');
}
