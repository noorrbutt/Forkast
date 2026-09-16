/**
 * The motion layer: tokens, the counting number, and the staggered entrance.
 *
 * Reanimated is mocked here, so these do not prove a spring settles or that a
 * number visibly ticks. They prove the pieces render, carry the right values,
 * and stay accessible while they are moving, and they pin down the token
 * relationships that encode the agreed feel.
 */

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Appear } from '../components/ui/Appear';
import { CountUp } from '../components/ui/CountUp';
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

describe('CountUp', () => {
  it('renders without needing the animation to have run', () => {
    const { toJSON } = render(<CountUp value={1840} />);
    expect(toJSON()).toBeTruthy();
  });

  it('exposes the final value to screen readers immediately', () => {
    // The visible text animates, so assistive tech must not be made to wait for
    // it, nor read out every intermediate number.
    const { getByLabelText } = render(<CountUp value={1840} />);
    expect(getByLabelText('1,840')).toBeTruthy();
  });

  it('includes the suffix in the accessible label', () => {
    const { getByLabelText } = render(<CountUp value={512} suffix=" kcal" />);
    expect(getByLabelText('512 kcal')).toBeTruthy();
  });

  it('handles zero, which is what a new account sees', () => {
    const { getByLabelText } = render(<CountUp value={0} />);
    expect(getByLabelText('0')).toBeTruthy();
  });

  it('is not editable, since it is a label that happens to animate', () => {
    const { UNSAFE_getByType } = render(<CountUp value={7} />);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TextInput } = require('react-native');
    expect(UNSAFE_getByType(TextInput).props.editable).toBe(false);
  });
});

describe('Appear', () => {
  it('renders its children', () => {
    const { getByText } = render(
      <Appear>
        <Text>Total calories</Text>
      </Appear>,
    );
    expect(getByText('Total calories')).toBeTruthy();
  });

  it('renders the same content whatever its position in the group', () => {
    const { getByText } = render(
      <Appear index={4}>
        <Text>Fourth card</Text>
      </Appear>,
    );
    expect(getByText('Fourth card')).toBeTruthy();
  });
});
