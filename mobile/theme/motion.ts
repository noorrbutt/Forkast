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
 */

import { Easing, ReduceMotion, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

/** Paths you walk constantly. Fast enough to never be in the way. */
export const quick: WithTimingConfig = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
};

/** Content arriving: a touch longer, still brisk. */
export const entrance: WithTimingConfig = {
  duration: 320,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
};

/** Moments that are supposed to land. */
export const expressive: WithTimingConfig = {
  duration: 620,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
};

/** A number counting up. Long enough to read, short enough not to stall. */
export const counter: WithTimingConfig = {
  duration: 700,
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

/** Something arriving that deserves a little bounce. */
export const bouncy: WithSpringConfig = {
  damping: 12,
  stiffness: 180,
  mass: 0.8,
  reduceMotion: ReduceMotion.System,
};

export const motion = {
  quick,
  entrance,
  expressive,
  counter,
  press,
  bouncy,
  /** How far content travels as it fades in. Small on purpose. */
  travel: 14,
  /** Gap between successive items in a staggered group. */
  stagger: 55,
  /** How far a pressable scales down when held. */
  pressScale: 0.965,
} as const;
