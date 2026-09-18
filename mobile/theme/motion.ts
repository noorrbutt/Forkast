/**
 * Motion tokens.
 *
 * The rule this encodes: restrained on anything you touch constantly, more
 * expressive on the moments meant to land. Logging a meal happens hundreds of
 * times, so the form and the tabs stay tight. Saving one happens once per meal
 * and is worth celebrating, so it gets room.
 *
 * Every screen reads from here rather than hardcoding a duration, for the same
 * reason colours live in tokens.ts: changing the feel of the app should be one
 * file, not forty.
 *
 * Only what the app actually renders. This was a vocabulary of nine and six of
 * them had no caller: `entrance`, `travel` and `stagger` existed for a staggered
 * fade on mount, which section 11 bans by name and which was deleted along with
 * the component that did it, and `expressive`, `counter` and `bouncy` were never
 * reached at all. A motion language nothing speaks is not a language.
 */

import { Easing, ReduceMotion, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

/** Paths you walk constantly. Fast enough to never be in the way. */
export const quick: WithTimingConfig = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
};

/** Under the thumb. Stiff and barely overshooting, so it feels like a button. */
export const press: WithSpringConfig = {
  damping: 18,
  stiffness: 320,
  mass: 0.6,
  reduceMotion: ReduceMotion.System,
};

export const motion = {
  quick,
  press,
  /** How far a pressable scales down when held. */
  pressScale: 0.965,
} as const;
