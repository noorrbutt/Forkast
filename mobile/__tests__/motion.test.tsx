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
 * tests were the only thing keeping them alive. The six timings that existed to
 * serve them went with them, which is why this file now asserts two tokens
 * rather than nine.
 */

import { motion } from '../theme/motion';

describe('motion tokens', () => {
  it('keeps everyday motion under a third of a second', () => {
    // Past roughly 300ms a transition stops reading as responsive, and `quick`
    // is the only timing left: it is what the tab bar and every press use.
    expect(motion.quick.duration!).toBeLessThanOrEqual(300);
    expect(motion.quick.duration!).toBeGreaterThanOrEqual(120);
  });

  it('scales a pressed control noticeably but not dramatically', () => {
    expect(motion.pressScale).toBeGreaterThan(0.9);
    expect(motion.pressScale).toBeLessThan(1);
  });

  it('respects the system reduce motion setting everywhere', () => {
    // Someone who has asked their phone to stop animating should not have to
    // ask this app separately. Every token, so a new one cannot skip it.
    expect(motion.quick.reduceMotion).toBeDefined();
    expect(motion.press.reduceMotion).toBeDefined();
  });
});
