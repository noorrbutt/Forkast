/**
 * The progress bar, at the four readings a day can produce.
 *
 * Every assertion here is on the text that lands on screen rather than on the
 * presence of a node, because the interesting failures in this component are
 * all sentences: a bar that quietly caps at full still renders, and a day that
 * went over still has a progressbar in the tree. What tells the user they went
 * over is the wording, so the wording is what is checked.
 */

import { render } from '@testing-library/react-native';

import { Progress } from '../components/ui/Progress';

describe('with no target set', () => {
  it('reads out what is there and claims nothing about progress', () => {
    const { getByText, queryByText, queryByRole } = render(
      <Progress value={1400} max={null} label="Calories today" />
    );

    expect(getByText('1,400 kcal')).toBeTruthy();
    // No invented denominator, and nothing about what is left of a target that
    // does not exist.
    expect(queryByText(/\//)).toBeNull();
    expect(queryByText(/left/)).toBeNull();
    expect(queryByText(/Over by/)).toBeNull();
    expect(queryByRole('progressbar')).toBeNull();
  });

  it('still prints the caption it was given', () => {
    const { getByText } = render(
      <Progress value={1400} max={null} caption="No daily target set yet." />
    );

    expect(getByText('No daily target set yet.')).toBeTruthy();
  });
});

describe('under the target', () => {
  it('prints both numbers and what is left of the day', () => {
    const { getByText } = render(<Progress value={1400} max={1800} />);

    expect(getByText('1,400 / 1,800 kcal')).toBeTruthy();
    expect(getByText('400 kcal left')).toBeTruthy();
  });

  it('hands assistive tech the same reading, not just a percentage', () => {
    const { getByRole } = render(<Progress value={1400} max={1800} label="Calories today" />);

    const bar = getByRole('progressbar');

    expect(bar.props.accessibilityLabel).toBe('Calories today');
    expect(bar.props.accessibilityValue).toEqual({
      min: 0,
      max: 1800,
      now: 1400,
      text: '1,400 / 1,800 kcal. 400 kcal left.',
    });
  });

  it('counts a workout back into what is left', () => {
    // Net can land below zero when the burn outruns the food, and that is a day
    // with more than the whole target still available.
    const { getByText } = render(<Progress value={-100} max={1800} />);

    expect(getByText('-100 / 1,800 kcal')).toBeTruthy();
    expect(getByText('1,900 kcal left')).toBeTruthy();
  });
});

describe('exactly at the target', () => {
  it('says so rather than leaving a bare zero to be read as over', () => {
    const { getByText, queryByText } = render(<Progress value={1800} max={1800} />);

    expect(getByText('1,800 / 1,800 kcal')).toBeTruthy();
    expect(getByText('Right on target, 0 kcal left')).toBeTruthy();
    expect(queryByText(/Over by/)).toBeNull();
  });
});

describe('over the target', () => {
  it('says by how much, in words rather than in colour alone', () => {
    const { getByText, queryByText } = render(<Progress value={2000} max={1800} />);

    expect(getByText('2,000 / 1,800 kcal')).toBeTruthy();
    expect(getByText('Over by 200 kcal')).toBeTruthy();
    // "left" would be a lie once the day has gone past the target.
    expect(queryByText(/left/)).toBeNull();
  });

  it('keeps reporting the real number instead of capping at the target', () => {
    const { getByRole } = render(<Progress value={3000} max={1800} />);

    const bar = getByRole('progressbar');

    expect(bar.props.accessibilityValue).toEqual({
      min: 0,
      max: 1800,
      now: 3000,
      text: '3,000 / 1,800 kcal. Over by 1,200 kcal.',
    });
  });

  it('grows the overshoot with the overshoot, rather than sitting at full', () => {
    const { getByText } = render(<Progress value={1801} max={1800} />);

    // One calorie over has to read differently from a thousand over, which is
    // the whole reason the bar is not clamped.
    expect(getByText('Over by 1 kcal')).toBeTruthy();
  });
});

describe('the unit', () => {
  it('follows whatever the caller measures in', () => {
    const { getByText } = render(<Progress value={3} max={5} unit="meals" />);

    expect(getByText('3 / 5 meals')).toBeTruthy();
    expect(getByText('2 meals left')).toBeTruthy();
  });
});
