import { useWindowDimensions } from 'react-native';

/**
 * Breakpoints, and what they answer.
 *
 * Everything in this app was designed for one column on a phone, and every
 * screen already caps its content at `layout.contentWidth` /
 * `layout.formWidth` so a tablet or a browser window never stretches a form
 * edge to edge -- that part predates this file. What was missing is a
 * shared answer to "is there enough width to show two things side by side
 * instead of one thing stacked on another", which a handful of screens need
 * and none of them should each invent their own number for.
 *
 * `compact` is a phone, portrait or not: one column, full width up to the
 * content cap. `medium` is a small tablet in portrait or a phone turned
 * sideways: enough room to place two narrow things beside each other, not
 * enough to run two full-width columns. `expanded` is a tablet in portrait
 * or landscape, or a wide desktop browser window: enough for a genuine
 * two-column layout, each column still individually capped so neither one
 * becomes an unreadably wide measure on its own.
 */
export const BREAKPOINTS = {
  medium: 600,
  expanded: 840,
} as const;

export type Breakpoint = 'compact' | 'medium' | 'expanded';

export type Layout = {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  /** True at `medium` and `expanded`. The common case: "is there room to stop stacking". */
  isAtLeastMedium: boolean;
  /** True only at `expanded`, the one breakpoint wide enough for two full content columns. */
  isExpanded: boolean;
};

function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINTS.expanded) return 'expanded';
  if (width >= BREAKPOINTS.medium) return 'medium';
  return 'compact';
}

/**
 * Where this render is on the compact/medium/expanded scale, read from the
 * window rather than the device: a phone rotated into landscape and a small
 * tablet in portrait can land on the same breakpoint, which is the point --
 * a screen that reads this should not also need to ask which one it is.
 */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const breakpoint = breakpointFor(width);
  return {
    width,
    height,
    breakpoint,
    isAtLeastMedium: breakpoint !== 'compact',
    isExpanded: breakpoint === 'expanded',
  };
}
