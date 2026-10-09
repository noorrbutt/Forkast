import { formatNumber, titleCase } from '../../lib/format';
import type { FoodLog, Plan, PlanMeal, Today } from '../../lib/types';
import { SLOT_LABELS, slotOf, type Slot } from './todayMeals';

/**
 * Home's third answer, "what should I do next", as exactly one suggestion.
 *
 * Chosen by state, most pressing first:
 *   1. Over target: a calm note, and nothing to press.
 *   2. Nothing logged by early afternoon: log the slot that is open now.
 *   3. A plan covers today: the planned meal for the next open slot.
 *   4. Otherwise: make a plan, which is where the AI plan lives on Home now
 *      instead of a list row at the foot of the scroll.
 */
export type NextStep =
  | { kind: 'over'; by: number }
  | { kind: 'log'; slot: Slot }
  | { kind: 'plan'; slotLabel: string; meal: PlanMeal }
  /** A plan covers today, but every slot it names is already eaten or past. */
  | { kind: 'plan-done' }
  | { kind: 'make-plan'; expired: boolean };

/** When a day with nothing logged starts to deserve a nudge. */
const AFTERNOON_HOUR = 13;

function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/**
 * Which of a plan's days is today, counting the day it was made as the first,
 * or null once the plan has run out. A three-day plan is not repeated on day
 * four: that would be inventing a fourth day nobody generated.
 */
export function planDayIndex(plan: Pick<Plan, 'created_at'>, now: Date): number | null {
  const made = new Date(plan.created_at);
  if (Number.isNaN(made.getTime())) return null;
  const index = localDayNumber(now) - localDayNumber(made);
  return index >= 0 ? index : null;
}

function matchesSlot(meal: PlanMeal, slot: Slot): boolean {
  return meal.slot.trim().toLowerCase() === slot;
}

export function chooseNextStep({
  today,
  meals,
  open,
  plan,
  now,
}: {
  today: Today | null;
  meals: readonly FoodLog[];
  open: readonly Slot[];
  plan: Plan | null;
  now: Date;
}): NextStep {
  if (today && today.remaining !== null && today.target !== null && today.target > 0) {
    const over = today.net - today.target;
    if (over > 0) return { kind: 'over', by: over };
  }

  const current = slotOf(now);
  if (meals.length === 0 && now.getHours() >= AFTERNOON_HOUR && current !== null) {
    return { kind: 'log', slot: current };
  }

  if (plan) {
    const index = planDayIndex(plan, now);
    const day = index === null ? undefined : plan.generated_plan.days[index];
    if (!day) return { kind: 'make-plan', expired: index !== null };

    // The next slot still open, then anything on the plan not yet eaten.
    const meal =
      open.map((slot) => day.meals.find((item) => matchesSlot(item, slot))).find(Boolean) ?? null;
    if (meal) {
      const slot = open.find((item) => matchesSlot(meal, item));
      return { kind: 'plan', slotLabel: slot ? SLOT_LABELS[slot] : titleCase(meal.slot), meal };
    }
    return { kind: 'plan-done' };
  }

  return { kind: 'make-plan', expired: false };
}

/** The one line a plan suggestion reads as: "Lunch, grilled salmon with quinoa, 600 kcal". */
export function planLine(step: Extract<NextStep, { kind: 'plan' }>): string {
  return `${step.slotLabel}, ${step.meal.suggestion}, ${formatNumber(step.meal.approx_calories)} kcal`;
}
