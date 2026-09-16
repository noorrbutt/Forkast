import type { FriendScale, Goal, Namedish, ServingSize } from './types';

/** The backend may send a plain label or a small object for top_category and friends. */
export function labelOf(value: Namedish, fallback = 'Not enough data'): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (value && typeof value === 'object') {
    if (typeof value.name === 'string' && value.name.length > 0) return value.name;
    if (typeof value.slug === 'string' && value.slug.length > 0) return titleCase(value.slug);
  }
  return fallback;
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

export function formatMinutes(value: number | null | undefined): string {
  if (!value || Number.isNaN(value)) return '0m';
  const minutes = Math.round(value);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short weekday for an ISO day string, falling back to the raw tail. */
export function shortDay(day: string): string {
  const parsed = new Date(day);
  if (!Number.isNaN(parsed.getTime())) return DAY_NAMES[parsed.getDay()];
  return day.slice(-2);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
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

export const GOAL_LABELS: Record<Goal, string> = {
  cut: 'Cut',
  maintain: 'Maintain',
  bulk: 'Bulk',
};

export const GOAL_BLURBS: Record<Goal, string> = {
  cut: 'Lighter days, still room for the good stuff.',
  maintain: 'Hold steady and keep eating well.',
  bulk: 'Build up with bigger, denser plates.',
};
