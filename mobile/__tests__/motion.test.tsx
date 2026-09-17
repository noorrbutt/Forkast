/**
 * The motion layer, which is now only its tokens.
 *
 * These pin down the relationships that encode the agreed feel: that the paths
 * you walk constantly are quicker than the moments meant to land, that nothing
 * everyday drags past a third of a second, and that every duration respects the
 * system's reduce motion setting.
 *
 * The counting number and the staggered entrance used to be tested here too.
 * Both components have been deleted: no screen rendered either of them, and the
 * staggered fade was the generic default the style guide bans outright, so the
 * tests were the only thing keeping them alive.
 */

import { motion } from '../theme/motion';

describe('motion tokens', () => {
  it('keeps the paths you walk constantly faster than the ones meant to land', () => {
    // This is the whole "somewhere between" decision in one assertion. If a
    // later change makes the log form as slow as a celebration, this fails.
    expect(motion.quick.duration!).toBeLessThan(motion.entrance.duration!);
    expect(motion.entrance.duration!).toBeLessThan(motion.expressive.duration!);
  });

  it('keeps everyday motion under a third of a second', () => {
    // Past roughly 300ms a transition stops reading as responsive.
    expect(motion.quick.duration!).toBeLessThanOrEqual(300);
  });

  it('travels a short distance, so content arrives rather than flies in', () => {
    expect(motion.travel).toBeGreaterThan(0);
    expect(motion.travel).toBeLessThanOrEqual(20);
  });

  it('scales a pressed control noticeably but not dramatically', () => {
    expect(motion.pressScale).toBeGreaterThan(0.9);
    expect(motion.pressScale).toBeLessThan(1);
  });

  it('staggers a list without making the last item wait', () => {
    // Eight items at this spacing still finish arriving inside half a second.
    expect(motion.stagger * 8).toBeLessThan(500);
  });

  it('respects the system reduce motion setting everywhere', () => {
    // Someone who has asked their phone to stop animating should not have to
    // ask this app separately.
    for (const token of [motion.quick, motion.entrance, motion.expressive, motion.counter]) {
      expect(token.reduceMotion).toBeDefined();
    }
    expect(motion.press.reduceMotion).toBeDefined();
    expect(motion.bouncy.reduceMotion).toBeDefined();
  });
});
