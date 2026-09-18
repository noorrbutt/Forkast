import type { FriendScale, Goal, ServingSize, User } from './types';

/**
 * The account holder's name as one string, or null if there is no name to give.
 *
 * Null rather than a fallback to the email address, because the two callers
 * want different fallbacks: the profile header prints the address in the name's
 * place, and the avatar derives initials from it. Baking one of those in here
 * would force the other to undo it.
 *
 * Either half can be missing on its own. An account made through Google gets
 * whichever name claims that token carried, and a Google account with no family
 * name set is an ordinary thing rather than an error, so "Sara" is a perfectly
 * good answer and " Khan" is not.
 */
export function fullName(user: Pick<User, 'first_name' | 'last_name'>): string | null {
  const parts = [user.first_name, user.last_name].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

export function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Render a 0 to 1 fraction as a percentage.
 *
 * The backend always sends a fraction, so this does not guess. Guessing would
 * disagree with the callers that compare the raw value against a fraction
 * threshold, and two readings of one field in the same screen is how a display
 * bug hides.
 */
export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0%';
  return `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A bare calendar day, with no time and no zone: what the API sends for a date. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Read an API date without letting the runtime guess a timezone.
 *
 * `new Date('2026-09-17')` is specified to parse as UTC midnight, while
 * `new Date('2026-09-17T12:00:00')` parses as local. So a date only string
 * silently becomes the previous evening for anyone west of Greenwich, and every
 * weekday and every day number derived from it is then wrong by one. A slip
 * logged on Thursday the 17th reads as "Sep 16" in New York, and the column
 * under "Thu" gets labelled "Wed".
 *
 * The server sends these as a plain calendar day precisely because they have no
 * time in them, so the fix is to build the date from its parts and leave it in
 * the local zone. Anything carrying a time is left alone: those are real
 * instants and the runtime is right to convert them.
 */
function parseApiDate(value: string): Date {
  const parts = DATE_ONLY.exec(value);
  if (!parts) return new Date(value);
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

/** Short weekday for an ISO day string, falling back to the raw tail. */
export function shortDay(day: string): string {
  const parsed = parseApiDate(day);
  if (!Number.isNaN(parsed.getTime())) return DAY_NAMES[parsed.getDay()];
  return day.slice(-2);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = parseApiDate(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const SERVING_LABELS: Record<ServingSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

export const FRIEND_LABELS: Record<FriendScale, string> = {
  solo: 'Solo',
  small_group: 'Small group',
  squad: 'Squad',
};

/** The five points on the fun scale, in order. Declared once, used on both forms. */
export const FUN_LEVELS = [1, 2, 3, 4, 5];

/**
 * What the ends of the fun scale mean.
 *
 * The control was five bare numerals under the words "Fun scale", which asks
 * someone to rate a meal on a scale whose ends nobody has ever defined. Every
 * other choice on that form says what it means in words, and a label that says
 * what it means is the rule; a number on its own does not, however obvious the
 * direction feels to whoever wrote it.
 */
export const FUN_HINT = '1 was a meal, 5 was a night worth remembering.';

/**
 * The daily calorie target a goal proposes.
 *
 * A goal used to reach nothing but the plan prompt, so picking one changed no
 * number anybody ever saw and the whole control read as decoration. It now
 * proposes the one number the dashboard measures a day against, and then gets
 * out of the way: every screen that offers a goal also lets this be edited.
 *
 * Where the numbers come from. 2,000 kcal is the reference intake printed on
 * food labels and a fair opening guess for an adult of average size and
 * activity, so it is the honest default for holding steady. Half a kilo of fat
 * is roughly 3,500 kcal, so eating 500 a day under maintenance is about half a
 * kilo a week: brisk enough to show on a scale within a month, gentle enough
 * to keep up. Gaining is not the mirror image, because past a few hundred a
 * day a surplus mostly arrives as fat rather than as muscle, so bulking adds
 * 300 instead of 500.
 *
 * These are opening guesses, not prescriptions. Nobody's real maintenance is
 * knowable from a chip on a setup screen, which is exactly why the number
 * stays editable and why the copy says so. All three sit well inside the 800
 * to 10,000 the server will accept.
 */
const SUGGESTED_TARGETS: Record<Goal, number> = {
  cut: 1_500,
  maintain: 2_000,
  bulk: 2_300,
};

export function suggestedTarget(goal: Goal): number {
  return SUGGESTED_TARGETS[goal];
}

/**
 * Cut, maintain and bulk are gym words, and someone who has never set foot in
 * a gym cannot tell from them what the app is about to do. These say which way
 * the weight is meant to go, and they still read correctly on the plan screen,
 * which appends the word "plan" to whichever one is stored.
 */
export const GOAL_LABELS: Record<Goal, string> = {
  cut: 'Weight loss',
  maintain: 'Maintenance',
  bulk: 'Weight gain',
};

/**
 * What picking this goal actually does, in the order it happens: it suggests a
 * number, it says what the number means, and it hands the number over. Built
 * from suggestedTarget rather than typed out, so the copy cannot quietly drift
 * away from the figure the screens fill in.
 */
export const GOAL_BLURBS: Record<Goal, string> = {
  cut: `Suggests a daily target of ${formatNumber(suggestedTarget('cut'))} kcal, around half a kilo a week off. Yours to change.`,
  maintain: `Suggests a daily target of ${formatNumber(suggestedTarget('maintain'))} kcal, roughly an average adult day. Yours to change.`,
  bulk: `Suggests a daily target of ${formatNumber(suggestedTarget('bulk'))} kcal, a small surplus to build on. Yours to change.`,
};
